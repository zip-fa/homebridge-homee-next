import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { HomeeClient } from '../homee/client.js';
import type { HomeeNode } from '../homee/types.js';
import { decode } from '../homee/util.js';
import { describeNode, nodeName } from '../mapping/index.js';

import { type AccessoryContext, HomeeAccessory } from './accessory.js';

export const PLUGIN_NAME = 'homebridge-homee-next';
export const PLATFORM_NAME = 'HomeeNext';

export interface HomeeNextConfig extends PlatformConfig {
  host: string;
  username: string;
  password: string;
  /** Only expose nodes in this homee group (case-insensitive). */
  group?: string;
  exclude?: number[];
  deviceName?: string;
}

export class HomeePlatform implements DynamicPlatformPlugin {
  public readonly client: HomeeClient;
  private readonly config: HomeeNextConfig;
  private readonly cached = new Map<
    string,
    PlatformAccessory<AccessoryContext>
  >();
  private readonly active = new Map<number, HomeeAccessory>();

  constructor(
    public readonly log: Logging,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.config = config as HomeeNextConfig;
    for (const key of ['host', 'username', 'password'] as const) {
      if (!this.config[key])
        throw new Error(`homee: "${key}" is missing in the platform config`);
    }

    this.client = new HomeeClient({
      host: this.config.host,
      username: this.config.username,
      password: this.config.password,
      deviceName: this.config.deviceName ?? 'homebridge',
      logger: log,
    });

    this.client.on('error', (error) => log.warn(`homee: ${error.message}`));
    this.client.on('status', (status) => {
      log.debug(`homee status: ${status}`);

      if (status === 'auth-failed')
        log.error(
          'homee rejected the credentials – fix the config and restart Homebridge',
        );
    });
    this.client.on('snapshot', () => this.sync());
    this.client.on('node', (node) =>
      this.active.has(node.id)
        ? this.active.get(node.id)!.refresh()
        : this.sync(),
    );
    this.client.on('attribute', (attribute) =>
      this.active.get(attribute.node_id)?.refresh(),
    );

    api.on('didFinishLaunching', () => this.client.start());
    api.on('shutdown', () => this.client.stop());
  }

  /** Called by Homebridge for every accessory restored from its cache, before didFinishLaunching. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(
      accessory.UUID,
      accessory as PlatformAccessory<AccessoryContext>,
    );
  }

  private sync(): void {
    const nodes = this.selectNodes();

    if (!nodes) return;
    const seen = new Set<string>();
    const added: PlatformAccessory[] = [];

    for (const node of nodes) {
      const spec = describeNode(node);

      if (!spec) {
        this.log.debug(
          `skipping unsupported node #${node.id} "${nodeName(node)}" (profile ${node.profile})`,
        );
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${node.id}`);

      seen.add(uuid);

      const existing = this.active.get(node.id);

      if (existing) {
        existing.apply(spec);
        existing.refresh();
        continue;
      }

      let accessory = this.cached.get(uuid);

      if (!accessory) {
        accessory = new this.api.platformAccessory<AccessoryContext>(
          nodeName(node),
          uuid,
        );
        accessory.context.nodeId = node.id;
        this.cached.set(uuid, accessory);
        added.push(accessory);
      }

      const handler = new HomeeAccessory(this, accessory, spec);

      this.active.set(node.id, handler);
      handler.refresh();
      this.log.info(
        `${added.includes(accessory) ? 'adding' : 'restoring'} ${spec.kind} "${nodeName(node)}" (node #${node.id})`,
      );
    }

    if (added.length)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, added);

    // Only reached after a full snapshot from the cube, so a missing node really is gone.
    const stale = [...this.cached.values()].filter(
      (accessory) => !seen.has(accessory.UUID),
    );

    for (const accessory of stale) {
      this.log.info(
        `removing "${accessory.displayName}" – no longer exposed by homee`,
      );
      this.cached.delete(accessory.UUID);
      this.active.delete(accessory.context.nodeId);
    }

    if (stale.length)
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
  }

  private selectNodes(): HomeeNode[] | undefined {
    const excluded = new Set(this.config.exclude ?? []);
    let nodes = [...this.client.nodes.values()].filter(
      (node) => !excluded.has(node.id),
    );

    if (this.config.group) {
      const wanted = this.config.group.toLowerCase();
      const group = this.client.groups.find(
        (g) => decode(g.name).toLowerCase() === wanted,
      );

      if (!group) {
        // Exposing everything (or nothing) here would wipe HomeKit automations; keep the cache as is.
        this.log.error(
          `homee group "${this.config.group}" not found – not touching accessories`,
        );

        return undefined;
      }

      const members = new Set(
        this.client.relationships
          .filter((r) => r.group_id === group.id)
          .map((r) => r.node_id),
      );

      nodes = nodes.filter((node) => members.has(node.id));
    }

    return nodes;
  }
}
