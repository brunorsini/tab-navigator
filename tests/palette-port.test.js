import test from 'node:test';
import assert from 'node:assert/strict';
import { palettePort } from '../extension/lib/palette-port.js';
const event = () => ({
  listeners: [],
  addListener(fn) {
    this.listeners.push(fn);
  },
});
function fixture() {
  const ports = [];
  let consumed = 0;
  const runtime = {
    get lastError() {
      consumed++;
      return { message: 'Receiving end does not exist.' };
    },
    connect() {
      const port = {
        onMessage: event(),
        onDisconnect: event(),
        sent: [],
        dead: false,
        postMessage(value) {
          if (this.dead) throw Error('Attempting to use a disconnected port object');
          this.sent.push(value);
        },
      };
      ports.push(port);
      return port;
    },
  };
  return { runtime, ports, consumed: () => consumed };
}
test('worker disconnection is consumed and reconnects only when a new preview needs it', () => {
  const f = fixture(),
    received = [],
    client = palettePort(f.runtime, (message) => received.push(message));
  f.ports[0].dead = true;
  f.ports[0].onDisconnect.listeners[0]();
  assert.equal(f.consumed(), 1);
  assert.equal(f.ports.length, 1, 'no reconnect loop or keepalive');
  assert.equal(client.send({ type: 'preview-seen', token: 'new' }), true);
  assert.equal(f.ports.length, 2);
  assert.equal(f.ports[1].sent[0].token, 'new');
  f.ports[1].onMessage.listeners[0]({ type: 'preview-ended' });
  assert.equal(received[0].type, 'preview-ended');
});
test('a disconnect race cannot throw from the popup event handler', () => {
  const f = fixture(),
    client = palettePort(f.runtime, () => {});
  f.ports[0].dead = true;
  assert.equal(client.send({ type: 'preview-seen' }), true);
  assert.equal(f.ports.length, 2);
  f.ports[0].onDisconnect.listeners[0]();
  assert.equal(client.send({ type: 'preview-seen' }), true);
  assert.equal(f.ports.length, 2, 'late disconnect must not discard the new connection');
});
test('extension reload or connection refusal fails without escaping into the UI', () => {
  const client = palettePort(
    {
      connect() {
        throw Error('Extension context invalidated');
      },
    },
    () => {},
  );
  assert.equal(client.send({ type: 'preview-seen' }), false);
});
