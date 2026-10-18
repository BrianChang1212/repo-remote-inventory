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

function summary(rows) {
  const attention = rows.filter(row => row.stale || row.worktreeWarning || row.status !== 'IN_SYNC').length;
  const dirty = rows.filter(row => row.dirty > 0).length;
  const unknown = rows.filter(row => row.worktreeWarning).length;
  return `${rows.length} repositories · ${attention} needs attention · ${dirty} dirty${unknown ? ` · ${unknown} dirty unknown` : ''}`;
}

module.exports = { sortedRows, rowDescription, rowDetails, summary };
