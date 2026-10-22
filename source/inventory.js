const { inspectRepository } = require('./git-state');

const FAILURE_STATUSES = new Set(['REMOTE_UNREACHABLE', 'LOCAL_ERROR', 'MISSING_PATH', 'NOT_A_REPO']);

function mergeResult(previous, fresh) {
  if (!FAILURE_STATUSES.has(fresh.status)) {
    return { ...fresh, stale: false, lastSuccessAt: fresh.checkedAt, refreshError: '' };
  }
  if (!previous || FAILURE_STATUSES.has(previous.status)) {
    return { ...fresh, stale: true, lastAttemptAt: fresh.checkedAt, refreshError: fresh.note || fresh.status };
  }
  return {
    ...previous,
    stale: true,
    lastSuccessAt: previous.lastSuccessAt || previous.checkedAt,
    lastAttemptAt: fresh.checkedAt,
    refreshError: `${fresh.status}: ${fresh.note || 'Refresh failed'}`,
  };
}

async function scanTargets(targets, options = {}) {
  const previous = new Map((options.previous || []).map(row => [row.path, row]));
  const inspect = options.inspect || inspectRepository;
  const selected = options.onlyPath ? targets.filter(target => target.path === options.onlyPath) : targets;
  if (options.onlyPath && selected.length === 0) throw new Error('Selected repository is no longer in the scan list');
  const results = new Map();
  let next = 0;
  let finished = 0;
  const concurrency = Math.max(1, Math.min(options.maxParallel || 8, selected.length || 1));
  async function worker() {
    while (next < selected.length) {
      while (options.priority?.length) {
        const requested = options.priority.shift();
        const index = selected.findIndex((target, position) => position >= next && target.path === requested);
        if (index >= next) {
          [selected[next], selected[index]] = [selected[index], selected[next]];
          break;
        }
      }
      const target = selected[next++];
      let fresh;
      try { fresh = await inspect(target, { timeoutMs: options.timeoutMs, signal: options.signal }); }
      catch (error) {
        fresh = { path: target.path, label: target.label, status: 'LOCAL_ERROR', note: error.message, checkedAt: new Date().toISOString() };
      }
      const row = mergeResult(previous.get(target.path), fresh);
      results.set(target.path, row);
      finished++;
      options.onProgress?.({ finished, total: selected.length, row });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return targets.map(target => results.get(target.path) || previous.get(target.path) || {
    path: target.path, label: target.label, group: target.group || '', status: 'PENDING', stale: true,
  });
}

module.exports = { mergeResult, scanTargets, FAILURE_STATUSES };
