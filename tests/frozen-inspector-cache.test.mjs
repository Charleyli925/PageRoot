import test from 'node:test';
import assert from 'node:assert/strict';
import { boundFrozenInspectorCache, FROZEN_NETWORK_LIMITS } from './e2e/electron/helpers/frozen-inspector-cache.mjs';
function fixture(send = async (...args) => calls.push(args)) {
  const client = { send }, sessions = new Map([[client, {}]]);
  const page = { _connection: { toImpl: () => ({ delegate: { _networkManager: { _sessions: sessions } } }) } };
  return { page, sessions };
}
let calls;
test('bounds the existing Inspector owner and preserves Network events', async () => {
  calls = []; const f = fixture(); const result = await boundFrozenInspectorCache(f.page, '1.62.1');
  assert.deepEqual(calls, [['Network.disable'], ['Network.enable', FROZEN_NETWORK_LIMITS]]);
  assert.equal(result.evidence.responseBodyEvidence, false); result.verify();
  f.sessions.set({ send() {} }, {});
  assert.throws(() => result.verify(), /SESSION_CHANGED/);
});
test('unknown versions, missing owners, empty sessions and failed commands cannot pass', async () => {
  await assert.rejects(boundFrozenInspectorCache(fixture().page, 'future'), /ADAPTER_VERSION/);
  await assert.rejects(boundFrozenInspectorCache({}, '1.62.1'), /ADAPTER_UNAVAILABLE/);
  const empty = fixture(); empty.sessions.clear();
  await assert.rejects(boundFrozenInspectorCache(empty.page, '1.62.1'), /EMPTY_SESSIONS/);
  await assert.rejects(boundFrozenInspectorCache(fixture(async () => { throw new Error('CDP_REJECTED'); }).page, '1.62.1'), /CDP_REJECTED/);
});
