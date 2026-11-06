const { englishT } = require('./l10n');

function priority(row) {
  if (row.stale) return 0;
  if (row.worktreeWarning) return 0;
  if (row.status !== 'IN_SYNC') return 1;
  if (row.dirty > 0) return 2;
  return 3;
}

function sortedRows(rows) {
  return [...rows].sort((a, b) => priority(a) - priority(b) || String(a.label || a.path).localeCompare(String(b.label || b.path)));
}

function rowDescription(row) {
  const parts = [row.stale ? `STALE · ${row.status}` : row.status];
  if (row.worktreeWarning) parts.push('dirty unknown');
  else if (row.dirty) parts.push(`${row.dirty} dirty`);
  if (row.ahead || row.behind) parts.push(`↑${row.ahead || 0} ↓${row.behind || 0}`);
  return parts.join(' · ');
}

function rowDetails(row) {
  const details = [
    `Status: ${row.status}`,
    `Path: ${row.path}`,
    `Branch: ${row.branch || '—'}`,
    `Compared with: ${row.compareTarget || '—'}`,
    `Working tree entries: ${row.worktreeWarning ? 'unknown' : row.dirty || 0}`,
    `Ahead: ${row.ahead || 0}`,
    `Behind: ${row.behind || 0}`,
    `Local SHA: ${row.localSha || '—'}`,
    `Remote SHA: ${row.remoteSha || '—'}`,
    `Last commit: ${row.lastCommit || '—'}`,
    `Last successful check: ${row.lastSuccessAt || row.checkedAt || '—'}`,
  ];
  if (row.stale) details.push(`Refresh failed: ${row.refreshError || row.note || row.status}`);
  else if (row.note) details.push(`Note: ${row.note}`);
  if (row.worktreeWarning) details.push(`Worktree warning: ${row.worktreeWarning}`);
  return details;
}

function repositoryCounts(rows) {
  const current = rows.filter(row => !row.stale && row.status && row.status !== 'PENDING');
  return {
    total: rows.length,
    current: current.length,
    attention: current.length ? current.filter(row => row.worktreeWarning || row.status !== 'IN_SYNC').length : null,
    unconfirmed: rows.length - current.length,
  };
}

function repositoryMatches(row, query, selected) {
  const needle = query.trim().toLowerCase().replaceAll(String.fromCharCode(92), '/');
  const path = String(row.path || '').replaceAll(String.fromCharCode(92), '/');
  const label = row.label && row.label !== '.' ? String(row.label) : path;
  const name = label.replaceAll(String.fromCharCode(92), '/').split('/').at(-1);
  const matches = (needle.includes('/') ? path : name).toLowerCase().includes(needle);
  const attention = row.worktreeWarning || (row.status && row.status !== 'IN_SYNC' && row.status !== 'PENDING');
  return matches && (selected === 'all' || (selected === 'sync' ? row.status === 'IN_SYNC' : attention));
}

function summary(rows, t = englishT) {
  const counts = repositoryCounts(rows);
  const attention = counts.attention ?? '—';
  const dirty = rows.filter(row => row.dirty > 0).length;
  const unknown = rows.filter(row => row.worktreeWarning).length;
  const result = unknown
    ? t('{0} repositories · {1} needs attention · {2} dirty · {3} dirty unknown', counts.total, attention, dirty, unknown)
    : t('{0} repositories · {1} needs attention · {2} dirty', counts.total, attention, dirty);
  return counts.unconfirmed
    ? result + ' · ' + t('{0} unconfirmed; current attention count is incomplete.', counts.unconfirmed)
    : result;
}

module.exports = { sortedRows, rowDescription, rowDetails, summary, repositoryCounts, repositoryMatches };
