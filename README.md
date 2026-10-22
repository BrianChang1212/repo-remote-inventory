# Repo Remote Inventory

![Repo Remote Inventory extension icon](resources/extension-icon.png)

Inspect local Git working trees and remote branch status from a graphite-and-green VS Code sidebar and a dashboard tab. Automatic refresh is enabled by default. Switch between automatic and manual refresh from either view; the choice is saved in VS Code's global settings.

## Usage

1. Install the extension and ensure `git` is available on your `PATH`.
2. Open a local folder and select **Repo Inventory** in the Activity Bar.
3. Read the status summary and expand a repository card to see its comparison target, branch, SHA, ahead/behind counts, working-tree changes, and check time.
4. Use **Refresh all** in the sidebar to refresh every repository, or **Refresh repository** inside an expanded card to refresh one.
5. Use the sidebar's **Auto refresh** control to enable or disable online refresh when the view opens. Select **Dashboard** to see status counts, a chart, and an expandable repository list in an editor tab. Each dashboard row has its own refresh button. Select a chart bar to filter the list, or clear the filter to show every repository.

## Refresh modes and saved results

Automatic mode refreshes when the sidebar or dashboard opens. Switching from manual to automatic mode starts a refresh immediately. If a refresh is already running, both views share that operation. Manual mode performs online queries only when you use a refresh command.

The extension saves the last results for each scan scope locally, so manual mode can show them after VS Code restarts. Refresh keeps those results visible while online checks run in the background. Each row stays stale until its new check completes; the dashboard labels mixed old and new results as a snapshot. A saved result is not proof of the current remote state. The chart keeps remote synchronization status separate from stale results and uncommitted working-tree changes. During a full scan, individual refresh requests receive the next available scan slot without duplicating an in-flight check.

By default, the extension recursively discovers Git roots at any depth under the current VS Code folder. This includes nested projects and worktrees represented by a `.git` file. Discovery does not follow symlinks or junctions and does not enter `.git` directories. `node_modules` and `.venv` are excluded by default; configure `repoRemoteInventory.excludePaths` to add directory names or paths relative to the scan root. Initial discovery can take time for large folders. Unreadable subdirectories produce warnings, and results cover only the readable paths.

If no folder is open, run **Repo Remote Inventory: Choose Scan Directory**. An empty `repoRemoteInventory.rootPath` uses the current VS Code folder; a relative value is resolved from that folder. The selected root is also the base for relative paths in a repository list.

## Repository list

Set `repoRemoteInventory.listFile` to a JSON file, or run **Repo Remote Inventory: Choose Repository List**. When a list is configured, only its entries are scanned. If the file is missing or invalid, the view reports an error and does not fall back to recursive discovery. The extension accepts the existing `repo_paths.json` format:

```json
{
  "schema_version": 1,
  "expected_repo_count": 2,
  "repos": [
    { "path": ".", "group": "governance", "remote": "https://example.com/team/root.git" },
    { "path": "projects/app", "group": "project" }
  ]
}
```

`path` is relative to the scan root; `.` means the root itself. `group` is used only for categorization. If `remote` is provided, the extension checks whether the `origin` URL matches it. A mismatch with `expected_repo_count` produces a warning. Do not include credentials or access tokens in the list.

## Status meanings

The extension compares the current branch with its upstream when available. Otherwise, it compares the same-named branch on `origin`. The view shows the actual comparison target. Each refresh uses `git ls-remote` to read the online SHA; it does not run `fetch`, `pull`, or `push`, or change Git configuration. Working-tree change counts come from `git status --porcelain` and are shown separately from commit synchronization.

| Status | Meaning |
|---|---|
| `IN_SYNC` | Local HEAD matches the remote branch SHA; uncommitted changes may still exist. |
| `AHEAD` / `BEHIND` / `DIVERGED` | The remote commit is available locally, so the commit direction and counts can be determined. |
| `DIFFERS_UNFETCHED` | The SHAs differ, but the remote commit is not available locally; ahead/behind cannot be determined. |
| `NO_REMOTE` / `REMOTE_BRANCH_MISSING` / `REMOTE_MISMATCH` | The remote configuration or branch does not match expectations. |
| `REMOTE_UNREACHABLE` / `LOCAL_ERROR` | The remote query or local Git read failed. |
| `MISSING_PATH` / `NOT_A_REPO` | A list path is missing or is not a Git root. |

If a refresh fails after a successful result, the extension preserves the previous data and marks it `STALE`, with the failure reason and last successful check time. Treat stale data as historical, not as the current remote state. If Git warns while reading the working tree, the change count is shown as `dirty unknown`, not as clean.

## Settings and platforms

| Setting | Default | Purpose |
|---|---|---|
| `autoRefreshOnOpen` | `true` | Refresh online when the sidebar or dashboard opens. The visible mode controls update this global setting. |
| `listFile` | Empty string | Path to a compatible `repo_paths.json` list. |
| `rootPath` | Empty string | Scan root; an empty value uses the current folder. |
| `excludePaths` | `node_modules`, `.venv` | Directories excluded during recursive discovery. |
| `maxParallel` | `8` | Maximum simultaneous repository queries. |
| `timeoutSeconds` | `20` | Timeout for each remote query. |

The current supported platform is desktop VS Code on local Windows, with Git on `PATH`. macOS, Linux, WSL/SSH workspaces, and VS Code for the Web are not supported yet. The extension is disabled in untrusted workspaces to avoid automatically running Git with workspace-provided configuration.

## Development and verification

```text
npm ci
npm test
npm run package:verify
```

Tests use temporary Git repositories and a local bare remote. `package:verify` creates a VSIX and checks its contents. These checks do not replace Marketplace installation or hands-on verification on every supported platform.
