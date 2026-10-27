// Render-time translation of refreshError/note text (ui-style-and-l10n.md §2.3, Q36=A).
// Stored rows keep the English text written by git-state.js and inventory.js; webviews receive this
// host-translated table and look the text up. Anything not in the table (git stderr, exception
// messages, already translated host errors) is shown unchanged. Status codes stay untranslated.

// Keys must equal git-state.js NOTE_TEMPLATES plus inventory.js REFRESH_FAILED (tested).
// Each value is a literal translation call so the l10n completeness test sees it.
function noteStrings(t) {
  return {
    format: t('{0}: {1}'),
    sentences: {
      'Configured path does not exist': t('Configured path does not exist'),
      'No .git entry at this path': t('No .git entry at this path'),
      'Git rejected this repository because of ownership': t('Git rejected this repository because of ownership'),
      'Git cannot read this repository (exit {0})': t('Git cannot read this repository (exit {0})'),
      'Path is not this Git repository root': t('Path is not this Git repository root'),
      'Expected origin is not configured': t('Expected origin is not configured'),
      'origin URL differs from the repository list': t('origin URL differs from the repository list'),
      'Remote {0} is not configured': t('Remote {0} is not configured'),
      'HEAD has no commit': t('HEAD has no commit'),
      'Cannot read working tree status': t('Cannot read working tree status'),
      'No current branch to compare': t('No current branch to compare'),
      'Remote query timed out': t('Remote query timed out'),
      '{0} does not exist': t('{0} does not exist'),
      'Remote query failed (Git exit {0})': t('Remote query failed (Git exit {0})'),
      'Uncommitted changes present': t('Uncommitted changes present'),
      'Remote commit is not present locally': t('Remote commit is not present locally'),
      'Cannot compare commit history': t('Cannot compare commit history'),
      'Invalid commit comparison': t('Invalid commit comparison'),
      'Refresh failed': t('Refresh failed'),
    },
  };
}

// Self-contained so it can be injected into webview scripts via toString().
// Accepts a known sentence, a known template ({n} matches one token without spaces), or
// "STATUS: <known sentence>" as composed by inventory.js; otherwise returns the text as-is.
function translateNote(text, notes) {
  const value = String(text ?? '');
  const fill = (message, args) => message.replace(/\{(\d+)\}/g, (slot, index) => (args[index] === undefined ? slot : args[index]));
  const sentence = english => {
    if (Object.prototype.hasOwnProperty.call(notes.sentences, english)) return notes.sentences[english];
    for (const template of Object.keys(notes.sentences)) {
      if (!/\{\d+\}/.test(template)) continue;
      const order = [];
      const pattern = template.split(/(\{\d+\})/).map(part => {
        const slot = part.match(/^\{(\d+)\}$/);
        if (slot) { order.push(Number(slot[1])); return '(\\S+)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      const match = english.match(new RegExp('^' + pattern + '$'));
      if (!match) continue;
      const args = [];
      order.forEach((index, position) => { args[index] = match[position + 1]; });
      return fill(notes.sentences[template], args);
    }
    return null;
  };
  const whole = sentence(value);
  if (whole !== null) return whole;
  const composed = value.match(/^([A-Z][A-Z_]*): ([\s\S]+)$/);
  const note = composed ? sentence(composed[2]) : null;
  return note === null ? value : fill(notes.format, [composed[1], note]);
}

module.exports = { noteStrings, translateNote };
