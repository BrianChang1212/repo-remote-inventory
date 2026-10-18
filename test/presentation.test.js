const test = require('node:test');
const assert = require('node:assert/strict');
const { sortedRows, rowDescription, rowDetails, summary } = require('../source/presentation');

test('problems, dirty repositories, and clean repositories are ordered clearly', () => {
  const rows = [
    { path: 'clean', status: 'IN_SYNC', dirty: 0 },
    { path: 'dirty', status: 'IN_SYNC', dirty: 2 },
    { path: 'problem', status: 'DIFFERS_UNFETCHED', dirty: 0 },
  ];
  assert.deepEqual(sortedRows(rows).map(row => row.path), ['problem', 'dirty', 'clean']);
  assert.equal(summary(rows), '3 repositories · 1 needs attention · 1 dirty');
});

test('stale results show the failure and the last successful timestamp', () => {
  const row = {
    path: '/repo', label: 'repo', status: 'IN_SYNC', dirty: 1, stale: true,
    lastSuccessAt: '2026-10-18T08:00:00Z', refreshError: 'REMOTE_UNREACHABLE: timed out',
  };
  assert.match(rowDescription(row), /STALE/);
  assert.match(rowDetails(row).join('\n'), /Last successful check/);
  assert.match(rowDetails(row).join('\n'), /timed out/);
});

test('unknown working tree status is not presented as clean', () => {
  const row = { path: '/repo', status: 'IN_SYNC', dirty: null, worktreeWarning: 'Working tree count is incomplete' };
  assert.match(rowDescription(row), /dirty unknown/);
  assert.match(rowDetails(row).join('\n'), /incomplete/);
  assert.match(summary([row]), /1 dirty unknown/);
});
