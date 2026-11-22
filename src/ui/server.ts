#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { HomeeClient } from '../homee/client.js';
import { discoverCubes } from '../homee/discovery.js';
import { attributeName, profileName } from '../homee/enums.js';
import type { HomeeNode } from '../homee/types.js';
import { decode } from '../homee/util.js';
import {
  describeNode,
  nodeName,
  snapshot,
  stopWrites,
  type AttributeWrite,
} from '../mapping/index.js';

const { values: args } = parseArgs({
  options: {
    host: { type: 'string' },
    username: { type: 'string' },
    'username-file': { type: 'string' },
    'password-file': { type: 'string' },
    port: { type: 'string', default: '8099' },
    listen: { type: 'string', default: '127.0.0.1' },
  },
});

const PUBLIC_DIR = fileURLToPath(new URL('../../ui/', import.meta.url));
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const LOG_SIZE = 200;

interface LogEntry {
  at: number;
  level: 'info' | 'warn' | 'error' | 'command' | 'event';
  message: string;
}

const log: LogEntry[] = [];
const record = (level: LogEntry['level'], message: string) => {
  log.push({ at: Date.now(), level, message });

  if (log.length > LOG_SIZE) log.shift();
};

let client: HomeeClient | undefined;

async function readSecret(path: string | undefined) {
  return path ? (await readFile(path, 'utf8')).trim() : undefined;
}

function connect(host: string, username: string, password: string) {
  client?.stop();
  client = new HomeeClient({
    host,
    username,
    password,
    deviceName: 'homee-test-ui',
    logger: {
      debug() {},
      info: (m) => record('info', m),
      warn: (m) => record('warn', m),
      error: (m) => record('error', m),
    },
  });
  client.on('status', (status) => record('info', `status: ${status}`));
  client.on('error', (error) => record('error', error.message));
  client.on('snapshot', () =>
    record('info', `snapshot: ${client!.nodes.size} nodes`),
  );
  client.on('attribute', (attribute, node) => {
    const who = node ? nodeName(node) : `node #${attribute.node_id}`;

    record(
      'event',
      `${who}: ${attributeName(attribute.type)} = ${attribute.current_value} (target ${attribute.target_value})`,
    );
  });
  client.start();
}

function nodeView(node: HomeeNode) {
  const spec = describeNode(node);

  return {
    id: node.id,
    name: nodeName(node),
    note: decode(node.note),
    profile: node.profile,
    profileName: profileName(node.profile),
    state: node.state,
    attributes: node.attributes.map((a) => ({
      id: a.id,
      type: a.type,
      name: attributeName(a.type),
      current: a.current_value,
      target: a.target_value,
      min: a.minimum,
      max: a.maximum,
      unit: decode(a.unit),
      editable: Boolean(a.editable),
    })),
    homekit: spec && {
      kind: spec.kind,
      info: spec.info,
      services: snapshot(spec, node),
    },
  };
}

function state() {
  return {
    configured: Boolean(client),
    host: client?.host,
    status: client?.status ?? 'idle',
    lastError: client?.lastError,
    lastSnapshotAt: client?.lastSnapshotAt,
    cube: client?.settings && {
      version: client.settings.version,
      name: decode(client.settings.homee_name),
    },
    nodes: client
      ? [...client.nodes.values()].sort((a, b) => a.id - b.id).map(nodeView)
      : [],
    log: log.slice(-80),
  };
}

function perform(nodeId: number, writes: AttributeWrite[], reason: string) {
  if (!client) throw new HttpError(409, 'not connected');
  for (const { attributeId, value } of writes) {
    record(
      'command',
      `${reason}: node #${nodeId} attribute ${attributeId} = ${value}`,
    );
    client.setValue(nodeId, attributeId, value);
  }

  return { sent: writes };
}

function homekitWrite(
  nodeId: number,
  body: { service?: number; characteristic?: string; value?: number | boolean },
) {
  const node = client?.nodes.get(nodeId);

  if (!node) throw new HttpError(404, 'unknown node');
  const spec = describeNode(node);
  const characteristic = spec?.services[
    body.service ?? 0
  ]?.characteristics.find((c) => c.type === body.characteristic);

  if (!characteristic?.write || body.value === undefined)
    throw new HttpError(400, 'characteristic is not writable');

  return perform(
    nodeId,
    characteristic.write(body.value, node),
    `HomeKit ${body.characteristic}=${String(body.value)}`,
  );
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(chunk as Buffer);

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as Record<
      string,
      unknown
    >;
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<unknown> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const key = `${request.method} ${url.pathname}`;
  const nodeAction = /^POST \/api\/nodes\/(\d+)\/(homekit|stop)$/.exec(key);

  if (key === 'GET /api/state') return state();

  if (key === 'GET /api/discover') return { hosts: await discoverCubes() };

  if (key === 'POST /api/connect') {
    const body = await readJson(request);
    const host = text(body.host).trim();
    const username =
      text(body.username) ||
      args.username ||
      (await readSecret(args['username-file']));
    const password =
      text(body.password) || (await readSecret(args['password-file']));

    if (!host || !username || !password)
      throw new HttpError(400, 'host, username and password are required');
    connect(host, username, password);

    return { ok: true };
  }

  if (key === 'POST /api/disconnect') {
    client?.stop();

    return { ok: true };
  }

  if (nodeAction) {
    const nodeId = Number(nodeAction[1]);

    if (nodeAction[2] === 'stop') {
      const node = client?.nodes.get(nodeId);

      if (!node) throw new HttpError(404, 'unknown node');

      return perform(nodeId, stopWrites(node), 'stop');
    }

    return homekitWrite(nodeId, await readJson(request));
  }

  if (request.method === 'GET' && !url.pathname.startsWith('/api/'))
    return serveStatic(url.pathname, response);
  throw new HttpError(404, 'not found');
}

async function serveStatic(pathname: string, response: ServerResponse) {
  const file = normalize(
    join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname),
  );

  if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(403, 'forbidden');
  const content = await readFile(file).catch(() => {
    throw new HttpError(404, 'not found');
  });

  response
    .writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    })
    .end(content);

  return undefined;
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  try {
    const result = await route(request, response);

    if (result === undefined) return;
    response
      .writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      })
      .end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;

    response
      .writeHead(status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: (error as Error).message }));
  }
}

async function autoConnect() {
  const username = args.username ?? (await readSecret(args['username-file']));
  const password = await readSecret(args['password-file']);

  if (args.host && username && password) connect(args.host, username, password);
}

const server = createServer(
  (request, response) => void handle(request, response),
);

server.listen(Number(args.port), args.listen, () => {
  console.log(`homee test UI: http://${args.listen}:${args.port}`);

  if (args.listen !== '127.0.0.1' && args.listen !== 'localhost') {
    console.warn(
      'warning: the UI has no login and can move your gates – only expose it on a trusted network',
    );
  }

  autoConnect().catch((error: Error) => record('error', error.message));
});

process.on('SIGINT', () => {
  client?.stop();
  server.close();
  process.exit(0);
});
