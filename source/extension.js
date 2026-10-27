const path = require('node:path');
const { loadRepositoryList } = require('./config');
const { discoverRepositories } = require('./discovery');
const { scanTargets } = require('./inventory');
const { sortedRows, summary } = require('./presentation');
const { dashboardHtml: buildDashboardHtml } = require('./dashboard');
const { sidebarHtml: buildSidebarHtml } = require('./sidebar');
const { translator, formatDateTime } = require('./l10n');

class InventoryProvider {
  constructor(vscode) {
    this.vscode = vscode;
    this.rows = [];
    this.changes = new vscode.EventEmitter();
  }

  setRows(rows) {
    this.rows = rows;
    this.changes.fire();
  }

  updateRow(row) {
    const index = this.rows.findIndex(item => item.path === row.path);
    if (index >= 0) this.rows[index] = row;
    else this.rows.push(row);
    this.changes.fire();
  }

  markStale(error) {
    this.rows = this.rows.map(row => ({
      ...row, stale: true, lastSuccessAt: row.lastSuccessAt || row.checkedAt,
      lastAttemptAt: new Date().toISOString(), refreshError: error,
    }));
    this.changes.fire();
  }

}

async function defaultResolveTargets(vscode) {
  const t = translator(vscode);
  const config = vscode.workspace.getConfiguration('repoRemoteInventory');
  const configuredRoot = String(config.get('rootPath', '') || '').trim();
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!configuredRoot && folder && folder.uri.scheme !== 'file') throw new Error(t('Remote workspaces are not supported in this release. Choose a local scan directory.'));
  const root = configuredRoot
    ? path.isAbsolute(configuredRoot) ? path.resolve(configuredRoot)
      : folder?.uri.scheme === 'file' ? path.resolve(folder.uri.fsPath, configuredRoot) : null
    : folder?.uri.fsPath;
  if (!root) throw new Error(t('Open a local folder or choose a scan directory.'));
  const configuredList = String(config.get('listFile', '') || '').trim();
  if (configuredList) {
    const list = path.isAbsolute(configuredList) ? configuredList : path.resolve(root, configuredList);
    return loadRepositoryList(list, root, t);
  }
  const excludes = config.get('excludePaths', ['node_modules', '.venv']);
  if (!Array.isArray(excludes) || excludes.some(value => typeof value !== 'string')) throw new Error(t('excludePaths must be an array of strings'));
  const warnings = [];
  const targets = await discoverRepositories(root, { excludes, t, onWarning: message => {
    if (warnings.length < 20) warnings.push(message);
  } });
  return { targets, warnings };
}

function start(vscode, context, dependencies = {}) {
  const t = translator(vscode);
  const webviewOptions = { t, language: vscode.env?.language };
  const provider = new InventoryProvider(vscode);
  const sidebarState = { visible: false, message: t('Open this view to check repository status.') };
  let sidebar;
  let sidebarReady = false;
  context.subscriptions.push(provider.changes);
  let targets = [];
  let warnings = [];
  let running = null;
  let activeOnlyPath;
  let pendingAll = false;
  const priority = [];
  const completedInRun = new Set();
  const followup = new Set();
  let dashboard;
  let dashboardReady = false;
  let renderTimer;
  let autoMode = configValue(vscode, 'autoRefreshOnOpen', true);
  let scopeGeneration = 0;
  let ignoreNextModeConfigEvent = false;
  let ignoreNextScopeConfigEvent = false;
  const state = context.globalState || { get: () => undefined, update: async () => {} };
  function scopeKey() {
    const config = vscode.workspace.getConfiguration('repoRemoteInventory');
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';
    const configuredRoot = String(config.get('rootPath', '') || '').trim();
    if (!configuredRoot && !folder) return null;
    if (configuredRoot && !folder && !path.isAbsolute(configuredRoot)) return null;
    const root = configuredRoot ? path.resolve(folder, configuredRoot) : path.resolve(folder);
    const configuredList = String(config.get('listFile', '') || '').trim();
    const list = configuredList ? path.resolve(root, configuredList) : '';
    const excludes = JSON.stringify(config.get('excludePaths', ['node_modules', '.venv']));
    return `repoRemoteInventory.results.${require('node:crypto').createHash('sha256').update(`${root}\0${list}\0${excludes}`).digest('hex')}`;
  }
  function renderDashboard() {
    if (dashboard && dashboardReady) dashboard.webview.postMessage({ type: 'rows', rows: provider.rows, checkedAt: provider.rows.reduce((latest, row) => {
      const timestamp = row.lastSuccessAt || row.checkedAt || '';
      return timestamp > latest ? timestamp : latest;
    }, '') });
  }
  function renderSidebar() {
    if (sidebar && sidebarReady) sidebar.webview.postMessage({
      type: 'state', rows: sortedRows(provider.rows), autoMode, message: sidebarState.message,
    });
  }
  function flushRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = undefined;
    renderDashboard();
    renderSidebar();
  }
  function scheduleRender() {
    if (!renderTimer) renderTimer = setTimeout(flushRender, 100);
  }
  function setSidebarMessage(message) {
    sidebarState.message = message;
    renderSidebar();
  }
  function setAutoMode(value) {
    autoMode = value;
    if (vscode.commands.executeCommand) void vscode.commands.executeCommand('setContext', 'repoRemoteInventory.autoMode', value);
    if (dashboard && dashboardReady) dashboard.webview.postMessage({ type: 'mode', autoMode });
    renderSidebar();
  }
  let activeScopeKey = scopeKey();
  function restoreScope(key, generation = scopeGeneration) {
    return Promise.resolve(key ? state.get(key, []) : []).then(rows => {
      if (generation !== scopeGeneration || key !== activeScopeKey) return;
      if (Array.isArray(rows) && rows.length) {
        provider.setRows(rows.map(row => ({ ...row, stale: true, persisted: true })));
        const lastSuccess = provider.rows.reduce((latest, row) => {
          const timestamp = row.lastSuccessAt || row.checkedAt || '';
          return timestamp > latest ? timestamp : latest;
        }, '');
        setSidebarMessage(t('Cached results from {0}; stale until refreshed.', lastSuccess ? formatDateTime(lastSuccess) : t('unknown')));
      } else {
        setSidebarMessage(t('No saved results for this scan scope. Refresh to check repositories.'));
      }
      renderDashboard();
      renderSidebar();
    }).catch(() => {});
  }
  function reloadScope(shouldAutoRefresh = false) {
    const nextScopeKey = scopeKey();
    if (nextScopeKey === activeScopeKey) return restorePromise;
    const previousRun = running;
    activeScopeKey = nextScopeKey;
    scopeGeneration++;
    targets = [];
    priority.length = 0;
    followup.clear();
    pendingAll = false;
    provider.setRows([]);
    setSidebarMessage(t('Loading cached results for the selected scan scope...'));
    const generation = scopeGeneration;
    restorePromise = restoreScope(activeScopeKey, generation).then(async () => {
      if (generation !== scopeGeneration || !shouldAutoRefresh) return;
      await Promise.resolve(previousRun);
      if (generation === scopeGeneration) void refresh();
    });
    return restorePromise;
  }
  let restorePromise = restoreScope(activeScopeKey);
  setSidebarMessage(t('Open this view to check repository status.'));

  function refresh(onlyPath, queueAll = false) {
    if (running) {
      if (!onlyPath && queueAll && activeOnlyPath) pendingAll = true;
      else if (provider.rows.some(row => row.path === onlyPath)) {
        if (activeOnlyPath && activeOnlyPath !== onlyPath) followup.add(onlyPath);
        if (completedInRun.has(onlyPath)) followup.add(onlyPath);
        else if (!activeOnlyPath && !priority.includes(onlyPath)) priority.push(onlyPath);
      }
      return running;
    }
    activeOnlyPath = onlyPath;
    completedInRun.clear();
    const requestScope = scopeKey();
    const requestGeneration = scopeGeneration;
    running = (async () => {
      try {
        await restorePromise;
        if (!onlyPath || targets.length === 0) {
          setSidebarMessage(t('Finding repositories...'));
          const resolved = await (dependencies.resolveTargets || (() => defaultResolveTargets(vscode)))();
          if (requestGeneration !== scopeGeneration) return;
          targets = resolved.targets;
          warnings = resolved.warnings || [];
          if (!provider.rows.length && requestScope) provider.setRows((await state.get(requestScope, []) || []).map(row => ({ ...row, stale: true, persisted: true })));
          const old = new Map(provider.rows.map(row => [row.path, row]));
          provider.setRows(targets.map(target => old.has(target.path)
            ? { ...old.get(target.path), stale: true }
            : { ...target, status: 'PENDING', stale: true }));
          if (!targets.length) {
            setSidebarMessage(t('No Git repositories found. Choose a scan directory or repository list.'));
            return;
          }
          if (warnings.length) setSidebarMessage(warnings.join(' '));
        }
        const config = vscode.workspace.getConfiguration('repoRemoteInventory');
        const scanTargetsForScope = [...targets];
        const result = await (dependencies.scanTargets || scanTargets)(scanTargetsForScope, {
          previous: provider.rows,
          onlyPath,
          priority,
          t,
          maxParallel: config.get('maxParallel', 8),
          timeoutMs: config.get('timeoutSeconds', 20) * 1000,
          onProgress({ finished, total, row }) {
            if (requestGeneration === scopeGeneration) {
              sidebarState.message = t('Checking remotes {0}/{1}...', finished, total);
              completedInRun.add(row.path);
              provider.updateRow(row);
            }
          },
        });
        if (requestScope) await state.update(requestScope, result);
        if (requestGeneration === scopeGeneration) {
          provider.setRows(result);
          flushRender();
          const checked = formatDateTime(new Date());
          setSidebarMessage(warnings.length
            ? t('{0} · checked {1} · {2}', summary(result, t), checked, warnings.join(' '))
            : t('{0} · checked {1}', summary(result, t), checked));
        }
      } catch (error) {
        const message = error?.message || String(error);
        if (requestGeneration === scopeGeneration) {
          provider.markStale(message);
          if (requestScope) await state.update(requestScope, provider.rows);
          flushRender();
          setSidebarMessage(t('Refresh failed: {0}', message));
        }
        if (requestGeneration === scopeGeneration) await vscode.window.showErrorMessage(t('Repo Remote Inventory: {0}', message));
      }
    })().finally(() => {
      running = null;
      activeOnlyPath = undefined;
      priority.length = 0;
      const pending = [...followup];
      followup.clear();
      const runAll = pendingAll;
      pendingAll = false;
      if (runAll || pending.length) void (async () => {
        if (runAll) await refresh();
        else for (const selected of pending) await refresh(selected);
      })();
    });
    return running;
  }

  const config = () => vscode.workspace.getConfiguration('repoRemoteInventory');
  setAutoMode(autoMode);
  context.subscriptions.push(provider.changes.event(scheduleRender), { dispose() { if (renderTimer) clearTimeout(renderTimer); } });
  function openDashboard() {
    if (!dashboard) {
      dashboard = vscode.window.createWebviewPanel('repoRemoteInventory.dashboard', t('Repository Inventory'), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
      dashboardReady = false;
      dashboard.webview.html = buildDashboardHtml(dashboard.webview, autoMode, webviewOptions);
      dashboard.onDidDispose(() => { dashboard = undefined; dashboardReady = false; });
      context.subscriptions.push(dashboard.onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.visible && autoMode) void refresh();
      }));
      dashboard.webview.onDidReceiveMessage(message => {
        if (message.command === 'ready') { dashboardReady = true; renderDashboard(); }
        else if (message.command === 'refresh') void refresh(undefined, true);
        else if (message.command === 'refreshRepository' && provider.rows.some(row => row.path === message.path)) void refresh(message.path);
        else if (message.command === 'toggleAuto') void vscode.commands.executeCommand(autoMode ? 'repoRemoteInventory.toggleAutoRefresh' : 'repoRemoteInventory.enableAutoRefresh');
      });
    }
    renderDashboard();
    dashboard.reveal(vscode.ViewColumn.Active);
    if (autoMode) void refresh();
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('repoRemoteInventory.refreshAll', () => refresh(undefined, true)),
    vscode.commands.registerCommand('repoRemoteInventory.toggleAutoRefresh', async () => {
      const next = !autoMode;
      ignoreNextModeConfigEvent = true;
      await config().update('autoRefreshOnOpen', next, vscode.ConfigurationTarget.Global);
      setAutoMode(next);
      if (next) void refresh();
    }),
    vscode.commands.registerCommand('repoRemoteInventory.enableAutoRefresh', async () => {
      ignoreNextModeConfigEvent = true;
      await config().update('autoRefreshOnOpen', true, vscode.ConfigurationTarget.Global);
      setAutoMode(true);
      void refresh();
    }),
    vscode.commands.registerCommand('repoRemoteInventory.openDashboard', openDashboard),
    vscode.commands.registerCommand('repoRemoteInventory.dashboardRefresh', () => refresh(undefined, true)),
    vscode.commands.registerCommand('repoRemoteInventory.refreshRepository', item => refresh(item?.path)),
    vscode.commands.registerCommand('repoRemoteInventory.chooseRoot', async () => {
      const selection = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
      if (!selection?.length) return;
      ignoreNextScopeConfigEvent = true;
      await config().update('rootPath', selection[0].fsPath, vscode.ConfigurationTarget.Global);
      await reloadScope(false);
      await Promise.resolve(running);
      await restorePromise;
      await refresh();
    }),
    vscode.commands.registerCommand('repoRemoteInventory.chooseList', async () => {
      const selection = await vscode.window.showOpenDialog({ canSelectFolders: false, canSelectFiles: true, canSelectMany: false, filters: { JSON: ['json'] } });
      if (!selection?.length) return;
      ignoreNextScopeConfigEvent = true;
      await config().update('listFile', selection[0].fsPath, vscode.ConfigurationTarget.Global);
      await reloadScope(false);
      await Promise.resolve(running);
      await restorePromise;
      await refresh();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('repoRemoteInventory.rootPath') || event.affectsConfiguration('repoRemoteInventory.listFile') || event.affectsConfiguration('repoRemoteInventory.excludePaths')) {
        const shouldAutoRefresh = autoMode && (sidebarState.visible || dashboard) && !ignoreNextScopeConfigEvent;
        if (ignoreNextScopeConfigEvent) ignoreNextScopeConfigEvent = false;
        void reloadScope(shouldAutoRefresh);
        return;
      }
      if (event.affectsConfiguration('repoRemoteInventory.autoRefreshOnOpen')) {
        setAutoMode(config().get('autoRefreshOnOpen', true));
        if (ignoreNextModeConfigEvent) ignoreNextModeConfigEvent = false;
        else if (autoMode && (sidebarState.visible || dashboard)) void refresh();
      }
    }),
  );
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('repoRemoteInventory.repositories', {
    resolveWebviewView(view) {
      sidebar = view;
      sidebarReady = false;
      sidebarState.visible = view.visible;
      view.webview.options = { enableScripts: true };
      view.webview.html = buildSidebarHtml(view.webview, autoMode, webviewOptions);
      context.subscriptions.push(view.onDidChangeVisibility(() => {
        sidebarState.visible = view.visible;
        if (view.visible && autoMode) void refresh();
      }));
      context.subscriptions.push(view.webview.onDidReceiveMessage(message => {
        if (message.command === 'ready') { sidebarReady = true; renderSidebar(); }
        else if (message.command === 'refresh') void refresh(undefined, true);
        else if (message.command === 'refreshRepository' && provider.rows.some(row => row.path === message.path)) void refresh(message.path);
        else if (message.command === 'toggleAuto') void vscode.commands.executeCommand('repoRemoteInventory.toggleAutoRefresh');
        else if (message.command === 'openDashboard') openDashboard();
      }));
      if (view.onDidDispose) context.subscriptions.push(view.onDidDispose(() => {
        if (sidebar === view) { sidebar = undefined; sidebarReady = false; sidebarState.visible = false; }
      }));
      renderSidebar();
      if (view.visible && autoMode) void refresh();
    },
  }));
  return { refreshAll: () => refresh(undefined, true), whenIdle: () => running || restorePromise, provider, openDashboard };
}

function configValue(vscode, key, fallback) { return vscode.workspace.getConfiguration('repoRemoteInventory').get(key, fallback); }

function activate(context) { return start(require('vscode'), context); }
function deactivate() {}

module.exports = { activate, deactivate, start, InventoryProvider, defaultResolveTargets };
