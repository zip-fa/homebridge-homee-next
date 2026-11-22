import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { WebSocketServer, type WebSocket } from 'ws';

import { garageDoor } from '../mapping/fixtures.test-helper.js';

import { HomeeClient } from './client.js';

const USER = 'user';
const PASSWORD = 'secret';

describe('HomeeClient', () => {
  let server: Server;
  let sockets: WebSocketServer;
  let host: string;
  const received: string[] = [];
  let cube: WebSocket | undefined;

  before(async () => {
    const expected = `Basic ${Buffer.from(`${USER}:${createHash('sha512').update(PASSWORD).digest('hex')}`).toString('base64')}`;

    server = createServer((request, response) => {
      if (
        request.url === '/access_token' &&
        request.headers.authorization === expected
      ) {
        response.end('access_token=tok123&user_id=1&device_id=1&expires=3600');
      } else {
        response.writeHead(401).end();
      }
    });
    sockets = new WebSocketServer({ server, handleProtocols: () => 'v2' });
    sockets.on('connection', (ws, request) => {
      assert.match(request.url ?? '', /access_token=tok123/);
      cube = ws;
      ws.on('message', (data) => {
        const command = (data as Buffer).toString();

        received.push(command);

        if (command === 'GET:all') {
          ws.send(
            JSON.stringify({
              all: {
                nodes: [garageDoor(1, 100)],
                groups: [],
                relationships: [],
                settings: { version: 'test' },
              },
            }),
          );
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    sockets.close();
    server.close();
  });

  // The client always targets :7681, so point it at the mock by overriding the URL.
  const clientFor = (password: string) => {
    const client = new HomeeClient({
      host: '127.0.0.1',
      username: USER,
      password,
      reconnectMinMs: 50,
    });

    Object.defineProperty(client, 'httpUrl', { get: () => `http://${host}` });

    return client;
  };

  it('authenticates, loads the snapshot, applies pushes and sends commands', async () => {
    const client = clientFor(PASSWORD);

    client.start();
    await once(client, 'snapshot');

    assert.equal(client.status, 'connected');
    assert.equal(client.nodes.get(1)?.profile, 2012);

    const pushed = once(client, 'attribute');

    cube!.send(
      JSON.stringify({
        attribute: { ...garageDoor(3, 60).attributes[1], node_id: 1 },
      }),
    );
    await pushed;
    assert.equal(
      client.nodes.get(1)?.attributes.find((a) => a.id === 22)?.current_value,
      3,
    );

    client.setValue(1, 22, 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(received.includes('PUT:/nodes/1/attributes/22?target_value=0'));
    client.stop();
  });

  it('stops retrying on rejected credentials', async () => {
    const client = clientFor('wrong');

    client.start();
    await new Promise<void>((resolve) =>
      client.on('status', (s) => s === 'auth-failed' && resolve()),
    );
    assert.match(client.lastError ?? '', /rejected/);
    client.stop();
  });

  it('refuses commands while disconnected', () => {
    assert.throws(() => clientFor(PASSWORD).setValue(1, 2, 3), /not connected/);
  });
});
