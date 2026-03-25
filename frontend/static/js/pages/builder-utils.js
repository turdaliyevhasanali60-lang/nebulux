/**
 * builder-utils.js — FE-1: standalone utility functions extracted from builder.js
 *
 * Pure functions with zero dependencies on state, DOM, or any external API.
 * Imported by builder.js which uses them inside the main IIFE via closure.
 */

/** Returns a Promise that resolves after `ms` milliseconds. */
export function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** HTML-escape arbitrary text for safe injection into innerHTML. */
export function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

/** Syntax-highlight an HTML string with span.token-* classes. */
export function highlightHTML(code) {
  let h = escapeHtml(code);
  h = h.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '\x01COMM\x02$1\x01/COMM\x02');
  h = h.replace(/="([^"]*)"/g, '\x01STROPEN\x02"$1"\x01STRCLOSE\x02');
  h = h.replace(/\s([\w-]+)(?==)/g, ' \x01ATTROPEN\x02$1\x01ATTRCLOSE\x02');
  h = h.replace(/(&lt;\/?)([\w]+)/g, '$1\x01TAGOPEN\x02$2\x01TAGCLOSE\x02');
  h = h.replace(/\/&gt;/g, '\x01TAGOPEN\x02/&gt;\x01TAGCLOSE\x02');
  h = h.replace(/&gt;/g, '\x01TAGOPEN\x02&gt;\x01TAGCLOSE\x02');
  return h
    .replace(/\x01COMM\x02/g, '<span class="token-comment">').replace(/\x01\/COMM\x02/g, '</span>')
    .replace(/\x01STROPEN\x02/g, '=<span class="token-string">').replace(/\x01STRCLOSE\x02/g, '</span>')
    .replace(/\x01ATTROPEN\x02/g, '<span class="token-attr-name">').replace(/\x01ATTRCLOSE\x02/g, '</span>')
    .replace(/\x01TAGOPEN\x02/g, '<span class="token-tag">').replace(/\x01TAGCLOSE\x02/g, '</span>');
}

/** Syntax-highlight a CSS string with span.token-* classes. */
export function highlightCSS(code) {
  let h = escapeHtml(code);
  h = h.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="token-comment">$1</span>');
  h = h.replace(/([a-z-]+):/gi, '<span class="token-property">$1</span>:');
  h = h.replace(/:\s*([^;{]+)/g, ': <span class="token-string">$1</span>');
  return h;
}

/** Re-indent an HTML string with 2-space indentation. */
export function prettifyHTML(html) {
  let pretty = html
    .replace(/>\s*</g, '>\n<')
    .replace(/>\s*([^<\s])/g, '>\n$1')
    .replace(/([^>])\s*</g, '$1\n<');
  let depth = 0;
  const voidTags = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  return pretty.split('\n').map(line => {
    const t = line.trim();
    if (!t) return '';
    const isClose = /^<\//.test(t);
    const isSelf = /\/>$/.test(t) || voidTags.test((t.match(/^<(\w+)/) || [])[1] || '');
    if (isClose) depth = Math.max(0, depth - 1);
    const out = '  '.repeat(depth) + t;
    if (!isClose && !isSelf && /^<\w/.test(t)) depth++;
    return out;
  }).filter(Boolean).join('\n');
}

/** Format a CSS string with consistent spacing/newlines. */
export function prettifyCSS(css) {
  return css
    .replace(/\s*\{\s*/g, ' {\n  ')
    .replace(/;\s*/g, ';\n  ')
    .replace(/\s*\}\s*/g, '\n}\n')
    .replace(/\n {2}(\s*\n)/g, '\n$1')
    .trim();
}

/**
 * Prettify then syntax-highlight code, returning a string of
 * `<span class="code-line">…</span>` elements for line-numbered display.
 */
export function formatCodeWithLineNumbers(code, type = 'html') {
  const pretty = type === 'css' ? prettifyCSS(code) : prettifyHTML(code);
  const highlighted = (type === 'css' ? highlightCSS : highlightHTML)(pretty);
  return highlighted
    .split('\n')
    .filter(l => l.trim())
    .map(l => `<span class="code-line">${l}</span>`)
    .join('');
}

/**
 * Extract the text content of the first `<style>` block in an HTML string.
 * Returns an empty string if no style block is found.
 */
export function extractCSS(html) {
  const m = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  return m ? m[1].trim() : '';
}
