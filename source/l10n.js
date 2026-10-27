// Translation entry point (ui-style-and-l10n.md §2.3). Pure helpers only: no require('vscode') here,
// so modules that do not depend on vscode can still be tested in Node.

// Replaces {0}, {1}, ... with positional arguments; unknown placeholders stay as-is.
function format(message, args) {
  return String(message).replace(/\{(\d+)\}/g, (match, index) => (args[index] === undefined ? match : String(args[index])));
}

// Default English translator for callers without vscode.
const englishT = (message, ...args) => format(message, args);

// Extension-layer translator: vscode.l10n.t when available (falls back to English for old test fakes).
function translator(vscode) {
  return vscode?.l10n?.t ? (message, ...args) => vscode.l10n.t(message, ...args) : englishT;
}

function htmlLang(language) {
  return String(language || '').toLowerCase() === 'zh-tw' ? 'zh-Hant' : 'en';
}

// Numeric MM-DD HH:mm in local time; identical in every display language (§2.4).
// Self-contained so it can also be injected into webview scripts via toString().
function formatDateTime(value) {
  if (value === undefined || value === null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = number => String(number).padStart(2, '0');
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

// Serializes a host-translated string table for a <script> block without allowing </script> breakout.
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

module.exports = { format, englishT, translator, htmlLang, formatDateTime, scriptJson };
