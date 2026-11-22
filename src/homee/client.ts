import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import WebSocket from 'ws';

import type {
  HomeeAttribute,
  HomeeGroup,
  HomeeNode,
  HomeeRelationship,
  HomeeSettings,
} from './types.js';

export const LOCAL_PORT = 7681;
const CLOUD_ID = /^[0-9A-F]{12}$/i;

export type ClientStatus =
  | 'idle'
  | 'authenticating'
  | 'connecting'
  | 'connected'
  | 'waiting'
  | 'auth-failed'
  | 'stopped';

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface HomeeClientOptions {
  host: string;
  username: string;
  password: string;
  /** Shown in the homee app's device list. Keep it stable, every new one registers another device. */
  deviceName?: string;
  logger?: Logger;
  timeoutMs?: number;
  heartbeatMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

type Events = {
  status: [status: ClientStatus];
  snapshot: [];
  node: [node: HomeeNode];
  attribute: [attribute: HomeeAttribute, node: HomeeNode | undefined];
  error: [error: Error];
};

export class HomeeAuthError extends Error {
  public override name = 'HomeeAuthError';
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * homee speaks a WebSocket protocol: the cube pushes every attribute change, commands are plain
 * strings like `PUT:/nodes/1/attributes/22?target_value=0`. HTTP is only used to obtain a token.
 */
export class HomeeClient extends EventEmitter<Events> {
  public readonly host: string;
  public readonly nodes = new Map<number, HomeeNode>();
  public groups: HomeeGroup[] = [];
  public relationships: HomeeRelationship[] = [];
  public settings: HomeeSettings = {};
  public status: ClientStatus = 'idle';
  public lastError: string | undefined;
  public lastSnapshotAt: number | undefined;

  private readonly username: string;
  private readonly passwordHash: string;
  private readonly deviceName: string;
  private readonly log: Logger;
  private readonly timeoutMs: number;
  private readonly heartbeatMs: number;
  private readonly reconnectMinMs: number;
  private readonly reconnectMaxMs: number;

  private token: { value: string; expiresAt: number } | undefined;
  private ws: WebSocket | undefined;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private stopped = true;

  constructor(options: HomeeClientOptions) {
    super();
    this.host = options.host.trim();
    this.username = options.username;
    this.passwordHash = createHash('sha512')
      .update(options.password)
      .digest('hex');
    this.deviceName = options.deviceName ?? 'homebridge';
    this.log = options.logger ?? silent;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.heartbeatMs = options.heartbeatMs ?? 30_000;
    this.reconnectMinMs = options.reconnectMinMs ?? 2_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 60_000;
    // An unhandled 'error' event would crash Homebridge; errors are also surfaced via lastError.
    this.on('error', () => {});
  }

  get httpUrl(): string {
    return CLOUD_ID.test(this.host)
      ? `https://${this.host}.hom.ee`
      : `http://${this.host}:${LOCAL_PORT}`;
  }

  get connected(): boolean {
    return this.status === 'connected';
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    this.ws?.close(1000);
    this.ws = undefined;
    this.setStatus('stopped');
  }

  setValue(nodeId: number, attributeId: number, value: number): void {
    if (![nodeId, attributeId, value].every(Number.isFinite)) {
      throw new TypeError(
        `invalid setValue(${nodeId}, ${attributeId}, ${value})`,
      );
    }

    this.send(
      `PUT:/nodes/${nodeId}/attributes/${attributeId}?target_value=${value}`,
    );
  }

  send(command: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN)
      throw new Error('not connected to homee');
    this.log.debug(`homee > ${command}`);
    this.ws.send(command);
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    try {
      const token = await this.authenticate();

      this.openSocket(token);
    } catch (error) {
      this.fail(error as Error);

      if (error instanceof HomeeAuthError) {
        this.setStatus('auth-failed');

        return;
      }

      this.scheduleReconnect();
    }
  }

  private async authenticate(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > Date.now())
      return this.token.value;

    this.setStatus('authenticating');
    const credentials = Buffer.from(
      `${this.username}:${this.passwordHash}`,
    ).toString('base64');
    const response = await fetch(`${this.httpUrl}/access_token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        device_name: this.deviceName,
        device_hardware_id: this.deviceName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-'),
        device_os: '5', // CADeviceOSLinux
        device_type: '0', // CADeviceTypeNone
        device_app: '1', // CADeviceAppHomee
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error: Error) => {
      const cause =
        (error.cause as { code?: string } | undefined)?.code ?? error.message;

      throw new Error(`cannot reach homee at ${this.httpUrl} (${cause})`);
    });

    if (response.status === 401 || response.status === 403) {
      throw new HomeeAuthError('homee rejected the username or password');
    }

    if (!response.ok)
      throw new Error(
        `homee returned HTTP ${response.status} for /access_token`,
      );

    const params = new URLSearchParams(await response.text());
    const value = params.get('access_token');

    if (!value) throw new Error('homee did not return an access token');
    const expiresIn = Number(params.get('expires')) || 3600;

    this.token = { value, expiresAt: Date.now() + expiresIn * 1000 };

    return value;
  }

  private openSocket(token: string): void {
    this.setStatus('connecting');
    const wsUrl = this.httpUrl.replace(/^http/, 'ws');
    const ws = new WebSocket(
      `${wsUrl}/connection?access_token=${encodeURIComponent(token)}`,
      'v2',
      {
        handshakeTimeout: this.timeoutMs,
      },
    );

    this.ws = ws;
    let alive = true;
    let refused = false;

    ws.on('open', () => {
      this.attempt = 0;
      this.lastError = undefined;
      this.setStatus('connected');
      this.log.info(`connected to homee at ${this.httpUrl}`);
      ws.send('GET:all');

      this.heartbeatTimer = setInterval(() => {
        if (!alive) {
          this.log.warn('homee heartbeat lost, reconnecting');
          ws.terminate();

          return;
        }

        alive = false;
        ws.ping();
      }, this.heartbeatMs);
    });

    ws.on('pong', () => (alive = true));

    ws.on('message', (data) => {
      alive = true;
      try {
        this.handleMessage(
          JSON.parse((data as Buffer).toString()) as Record<string, unknown>,
        );
      } catch (error) {
        this.log.debug(
          `ignoring unparsable homee message: ${(error as Error).message}`,
        );
      }
    });

    ws.on('unexpected-response', (_request, response) => {
      // 401 here means the token was revoked, e.g. the device was removed in the homee app.
      if (response.statusCode === 401) this.token = undefined;
      refused = true;
      this.fail(
        new Error(`homee refused the WebSocket (HTTP ${response.statusCode})`),
      );
      ws.terminate();
    });

    ws.on('error', (error) => {
      if (!refused) this.fail(error);
    });

    ws.on('close', () => {
      clearInterval(this.heartbeatTimer);

      if (this.ws === ws) this.ws = undefined;

      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private handleMessage(message: Record<string, unknown>): void {
    const [type] = Object.keys(message);

    if (!type) return;
    const payload = message[type];

    switch (type) {
      case 'all': {
        const all = payload as {
          nodes: HomeeNode[];
          groups: HomeeGroup[];
          relationships: HomeeRelationship[];
          settings: HomeeSettings;
        };

        this.nodes.clear();
        for (const node of all.nodes ?? []) this.nodes.set(node.id, node);
        this.groups = all.groups ?? [];
        this.relationships = all.relationships ?? [];
        this.settings = all.settings ?? {};
        this.lastSnapshotAt = Date.now();
        this.emit('snapshot');
        break;
      }

      case 'node': {
        const node = payload as HomeeNode;

        this.nodes.set(node.id, node);
        this.emit('node', node);
        break;
      }

      case 'attribute':
        this.applyAttribute(payload as HomeeAttribute);
        break;
      case 'groups':
        this.groups = payload as HomeeGroup[];
        break;
      case 'relationships':
        this.relationships = payload as HomeeRelationship[];
        break;
      case 'warning':
      case 'error':
        this.log.warn(`homee ${type}: ${JSON.stringify(payload)}`);
        break;
    }
  }

  private applyAttribute(attribute: HomeeAttribute): void {
    const node = this.nodes.get(attribute.node_id);

    if (node) {
      const index = node.attributes.findIndex((a) => a.id === attribute.id);

      if (index >= 0)
        node.attributes[index] = { ...node.attributes[index], ...attribute };
      else node.attributes.push(attribute);
    }

    this.emit('attribute', attribute, node);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const backoff = Math.min(
      this.reconnectMaxMs,
      this.reconnectMinMs * 2 ** this.attempt++,
    );
    const delay = Math.round(backoff * (0.8 + Math.random() * 0.4));

    this.setStatus('waiting');
    this.log.debug(`reconnecting to homee in ${delay} ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.open();
    }, delay);
  }

  private fail(error: Error): void {
    this.lastError = error.message;
    this.emit('error', error);
  }

  private setStatus(status: ClientStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }
}
