const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeResult, scanTargets } = require('../source/inventory');

test('retains the last successful data and marks a failed refresh as stale', () => {
  const old = { path: '/one', status: 'IN_SYNC', localSha: 'abcd1234', checkedAt: '2026-01-01T00:00:00Z', stale: false };
  const failed = { path: '/one', status: 'REMOTE_UNREACHABLE', note: 'Remote query timed out', checkedAt: '2026-01-02T00:00:00Z' };
  const merged = mergeResult(old, failed);
  assert.equal(merged.status, 'IN_SYNC');
  assert.equal(merged.localSha, 'abcd1234');
  assert.equal(merged.stale, true);
  assert.equal(merged.lastSuccessAt, old.checkedAt);
  assert.match(merged.refreshError, /timed out/);
  assert.equal(merged.lastAttemptAt, failed.checkedAt);
});

test('single-repository scan updates only that row', async () => {
  const targets = [{ path: '/one' }, { path: '/two' }];
  const previous = [{ path: '/one', status: 'IN_SYNC' }, { path: '/two', status: 'AHEAD', checkedAt: 'yesterday' }];
  const called = [];
  const rows = await scanTargets(targets, {
    previous,
    onlyPath: '/one',
    inspect: async target => { called.push(target.path); return { path: target.path, status: 'BEHIND' }; },
  });
  assert.deepEqual(called, ['/one']);
  assert.deepEqual(rows.map(row => row.status), ['BEHIND', 'AHEAD']);
  assert.equal(rows[1].checkedAt, 'yesterday');
});
