import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';

import { LOCAL_PORT } from './client.js';

const VIRTUAL_INTERFACE =
  /^(lo|utun|tun|tap|wg|docker|veth|br-|bridge|vmnet|vboxnet)/i;
const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function localSubnets(): string[] {
  const subnets = new Set<string>();

  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const { family, internal, address } of addresses ?? []) {
      if (family === 'IPv4' && !internal && PRIVATE_IPV4.test(address)) {
        subnets.add(address.split('.').slice(0, 3).join('.'));
      }
    }
  }

  return [...subnets];
}

function isPortOpen(host: string, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: LOCAL_PORT, timeout });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };

    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function isHomee(host: string, timeout: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${LOCAL_PORT}/`, {
      signal: AbortSignal.timeout(timeout),
    });

    return /homee/i.test(response.headers.get('server') ?? '');
  } catch {
    return false;
  }
}

/** Finds homee cubes by scanning every local /24 for port 7681 and checking the `Server` header. */
export async function discoverCubes({
  subnets = localSubnets(),
  timeout = 1200,
  concurrency = 128,
} = {}): Promise<string[]> {
  const hosts = subnets.flatMap((subnet) =>
    Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`),
  );
  const open: string[] = [];
  let next = 0;

  const worker = async () => {
    while (next < hosts.length) {
      const host = hosts[next++]!;

      if (await isPortOpen(host, timeout)) open.push(host);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, hosts.length) }, worker),
  );

  const verdicts = await Promise.all(
    open.map((host) => isHomee(host, timeout * 2)),
  );

  return open.filter((_, i) => verdicts[i]);
}
