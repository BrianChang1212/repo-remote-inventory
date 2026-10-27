# Changelog

## 0.3.1

- Show refresh notes written by this extension (for example `Remote query timed out`) in Traditional Chinese for `zh-tw` in the sidebar and dashboard; the dashboard now shows the refresh note too. Cached data stays English, status codes and Git output stay untranslated.

## 0.3.0

- Follow the VS Code theme: sidebar and dashboard use theme colors with separate dark, light, and high contrast accents; glow and grid appear only in dark themes.
- Follow the VS Code display language: commands, settings, notifications, and webview text show Traditional Chinese for `zh-tw` and English otherwise. Git output stays untranslated.
- Show times as `MM-DD HH:mm` in both languages.

## 0.2.1

- Restyle the dashboard to match the NVIDIA-inspired sidebar and use expandable repository cards with visible per-repository refresh buttons.
- Keep cached rows visible during background refresh and mark each row stale until its new result arrives.
- Prioritize deduplicated per-repository requests during a full scan and batch webview updates to keep the interface responsive.

## 0.2.0

- Replace the native repository tree with an expandable graphite-and-green sidebar webview inspired by Task Reports.
- Show status totals, a visible global automatic-refresh switch, manual and per-repository refresh, and a dashboard shortcut in the sidebar.
- Add a dashboard editor tab with status bars, repository details, and chart filtering.
- Add visible automatic/manual refresh controls in the sidebar and dashboard, backed by a global setting.
- Restore saved results by scan scope across VS Code sessions and mark historical data clearly.

## 0.1.0

- Add a general-purpose VS Code sidebar for inspecting local Git repositories and remote status.
- Support repository lists and recursive discovery, auto-refresh on open, and manual refresh for all or one repository.
- Show the upstream comparison target, working-tree changes, commit direction, and stale results.
