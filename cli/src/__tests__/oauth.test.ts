import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startCallbackServer } from '../oauth';

test('startCallbackServer accepts callback on a fixed port', async () => {
  const state = 'test-state';
  const { port, result } = startCallbackServer(state, 5_000, 45201);
  const listenPort = await port;
  assert.equal(listenPort, 45201);

  await new Promise<void>((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${listenPort}/callback?code=test-code&state=${state}`, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
  });

  const code = await result;
  assert.equal(code, 'test-code');
});