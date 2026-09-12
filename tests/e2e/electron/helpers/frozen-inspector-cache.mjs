import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const FROZEN_NETWORK_LIMITS = Object.freeze({
  maxTotalBufferSize: 65536, maxResourceBufferSize: 8192, maxPostDataSize: 1024,
});

// Playwright has no public option for its own Inspector response-body cache.
// This version-pinned test-only adapter preserves Network events, but not bodies.
// Never substitute a new CDP session: it would leave the owner's cache intact.
export async function boundFrozenInspectorCache(page, version = require('playwright-core/package.json').version) {
  assert.equal(version, '1.62.1', 'FROZEN_INSPECTOR_ADAPTER_VERSION');
  assert.equal(typeof page?._connection?.toImpl, 'function', 'FROZEN_INSPECTOR_ADAPTER_UNAVAILABLE');
  const manager = page._connection.toImpl(page)?.delegate?._networkManager;
  assert.ok(manager?._sessions instanceof Map, 'FROZEN_INSPECTOR_SESSION_MAP');
  const clients = [...manager._sessions.keys()];
  assert.ok(clients.length > 0, 'FROZEN_INSPECTOR_EMPTY_SESSIONS');
  for (const client of clients) {
    assert.equal(typeof client.send, 'function', 'FROZEN_INSPECTOR_SESSION_SEND');
    await client.send('Network.disable');
    await client.send('Network.enable', { ...FROZEN_NETWORK_LIMITS });
  }
  return {
    evidence: { adapterVersion: version, sessionCount: clients.length, limits: FROZEN_NETWORK_LIMITS, networkEvents: true, responseBodyEvidence: false },
    verify() {
      assert.deepEqual([...manager._sessions.keys()], clients, 'FROZEN_INSPECTOR_SESSION_CHANGED');
    },
  };
}
