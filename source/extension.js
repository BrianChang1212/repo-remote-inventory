const path = require('node:path');
const { loadRepositoryList } = require('./config');
const { discoverRepositories } = require('./discovery');
const { scanTargets } = require('./inventory');
const { sortedRows, rowDescription, rowDetails, summary } = require('./presentation');

class InventoryProvider {
  constructor(vscode) {
    this.vscode = vscode;
    this.rows = [];
    this.changes = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changes.event;
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

  getChildren(element) {
    if (!element) return sortedRows(this.rows).map(row => ({ kind: 'repository', row, path: row.path }));
    if (element.kind === 'repository') return rowDetails(element.row).map(detail => ({ kind: 'detail', label: detail }));
    return [];
  }

  getTreeItem(element) {
    const { vscode } = this;
    if (element.kind === 'detail') return new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    const row = element.row;
    const item = new vscode.TreeItem(row.label || row.path, vscode.TreeItemCollapsibleState.Collapsed);
    item.description = rowDescription(row);
    item.tooltip = rowDetails(row).join('\n');
    item.contextValue = 'repository';
    const icon = row.stale ? 'clock' : row.worktreeWarning ? 'warning' : row.status === 'IN_SYNC' ? 'check' : row.status === 'PENDING' ? 'sync' : 'warning';
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
}

async function defaultResolveTargets(vscode) {
  const config = vscode.workspace.getConfiguration('repoRemoteInventory');
  const configuredRoot = String(config.get('rootPath', '') || '').trim();
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!configuredRoot && folder && folder.uri.scheme !== 'file') throw new Error('Remote workspaces are not supported in this release. Choose a local scan directory.');
  const root = configuredRoot
    ? path.isAbsolute(configuredRoot) ? path.resolve(configuredRoot)
      : folder?.uri.scheme === 'file' ? path.resolve(folder.uri.fsPath, configuredRoot) : null
    : folder?.uri.fsPath;
  if (!root) throw new Error('Open a local folder or choose a scan directory.');
  const configuredList = String(config.get('listFile', '') || '').trim();
  if (configuredList) {
    const list = path.isAbsolute(configuredList) ? configuredList : path.resolve(root, configuredList);
    return loadRepositoryList(list, root);
  }
  const excludes = config.get('excludePaths', ['node_modules', '.venv']);
  if (!Array.isArray(excludes) || excludes.some(value => typeof value !== 'string')) throw new Error('excludePaths must be an array of strings');
  const warnings = [];
  const targets = await discoverRepositories(root, { excludes, onWarning: message => {
    if (warnings.length < 20) warnings.push(message);
  } });
  return { targets, warnings };
}

function start(vscode, context, dependencies = {}) {
  const provider = new InventoryProvider(vscode);
  const treeView = vscode.window.createTreeView('repoRemoteInventory.repositories', { treeDataProvider: provider });
  context.subscriptions.push(treeView, provider.changes);
  let targets = [];
  let warnings = [];
  let running = null;
  treeView.message = 'Open this view to check repository status.';

  function refresh(onlyPath) {
    if (running) return running;
    running = (async () => {
      try {
        if (!onlyPath || targets.length === 0) {
          treeView.message = 'Finding repositories…';
          const resolved = await (dependencies.resolveTargets || (() => defaultResolveTargets(vscode)))();
          targets = resolved.targets;
          warnings = resolved.warnings || [];
          const old = new Map(provider.rows.map(row => [row.path, row]));
          provider.setRows(targets.map(target => old.get(target.path) || {
            ...target, status: 'PENDING', stale: true,
          }));
          if (!targets.length) {
            treeView.message = 'No Git repositories found. Choose a scan directory or repository list.';
            return;
          }
          if (warnings.length) treeView.message = warnings.join(' ');
        }
        const config = vscode.workspace.getConfiguration('repoRemoteInventory');
        const result = await (dependencies.scanTargets || scanTargets)(targets, {
          previous: provider.rows,
          onlyPath,
          maxParallel: config.get('maxParallel', 8),
          timeoutMs: config.get('timeoutSeconds', 20) * 1000,
          onProgress({ finished, total, row }) {
            provider.updateRow(row);
            treeView.message = `Checking remotes ${finished}/${total}…`;
          },
        });
        provider.setRows(result);
        treeView.message = `${summary(result)} · checked ${new Date().toLocaleString()}${warnings.length ? ` · ${warnings.join(' ')}` : ''}`;
      } catch (error) {
        const message = error?.message || String(error);
        provider.markStale(message);
        treeView.message = `Refresh failed: ${message}`;
        await vscode.window.showErrorMessage(`Repo Remote Inventory: ${message}`);
      }
    })().finally(() => { running = null; });
    return running;
  }

  const config = () => vscode.workspace.getConfiguration('repoRemoteInventory');
  context.subscriptions.push(
    treeView.onDidChangeVisibility(({ visible }) => {
      if (visible && config().get('autoRefreshOnOpen', true)) void refresh();
    }),
    vscode.commands.registerCommand('repoRemoteInventory.refreshAll', () => refresh()),
    vscode.commands.registerCommand('repoRemoteInventory.refreshRepository', item => refresh(item?.path)),
    vscode.commands.registerCommand('repoRemoteInventory.chooseRoot', async () => {
      const selection = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
      if (!selection?.length) return;
      await config().update('rootPath', selection[0].fsPath, vscode.ConfigurationTarget.Global);
      await refresh();
    }),
    vscode.commands.registerCommand('repoRemoteInventory.chooseList', async () => {
      const selection = await vscode.window.showOpenDialog({ canSelectFolders: false, canSelectFiles: true, canSelectMany: false, filters: { JSON: ['json'] } });
      if (!selection?.length) return;
      await config().update('listFile', selection[0].fsPath, vscode.ConfigurationTarget.Global);
      await refresh();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('repoRemoteInventory') && treeView.visible && config().get('autoRefreshOnOpen', true)) void refresh();
    }),
  );
  if (treeView.visible && config().get('autoRefreshOnOpen', true)) void refresh();
  return { refreshAll: () => refresh(), whenIdle: () => running || Promise.resolve(), provider };
}

function activate(context) { return start(require('vscode'), context); }
function deactivate() {}

module.exports = { activate, deactivate, start, InventoryProvider, defaultResolveTargets };
