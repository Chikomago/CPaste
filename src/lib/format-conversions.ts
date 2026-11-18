import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import DOMPurify from 'dompurify';
import type { ToolDocument } from './text-tools';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
// A template document has no browsing context: parsing and conversion never load
// remote images or execute copied markup. No converted HTML is mounted in the UI.
function inertHtml(html: string) {
  const template = document.createElement('template');
  const root = template.content.ownerDocument.createElement('div');
  root.innerHTML = html;
  root.querySelectorAll<HTMLElement>('[style]').forEach(node => {
    const style = node.getAttribute('style') ?? '';
    const tags = [/(?:^|;)\s*font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style) ? 'strong' : '', /(?:^|;)\s*font-style\s*:\s*italic/i.test(style) ? 'em' : '', /text-decoration[^;]*line-through/i.test(style) ? 'del' : '', /text-decoration[^;]*underline/i.test(style) ? 'u' : ''].filter(Boolean);
    for (const tag of tags) { const wrapper = root.ownerDocument.createElement(tag); while (node.firstChild) wrapper.appendChild(node.firstChild); node.appendChild(wrapper); }
  });
  DOMPurify.sanitize(root, { IN_PLACE: true, USE_PROFILES: { html: true }, FORBID_TAGS: ['style','script','iframe','object','embed','audio','video','source'], FORBID_ATTR: ['style'] });
  return root;
}
export function rtfToHtml(rtf: string) {
  type Style = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; skip: boolean; uc: number; encoding: string };
  let state: Style = { bold: false, italic: false, underline: false, strike: false, skip: false, uc: 1, encoding: 'windows-1252' };
  const stack: Style[] = []; let output = '', text = '', fallback = 0; let bytes: number[] = [];
  const flushBytes = () => { if (bytes.length) { try { text += new TextDecoder(state.encoding).decode(new Uint8Array(bytes)); } catch { text += new TextDecoder('windows-1252').decode(new Uint8Array(bytes)); } bytes = []; } };
  const flush = () => {
    flushBytes();
    if (text && !state.skip) { let value = escapeHtml(text); if (state.bold) value = `<strong>${value}</strong>`; if (state.italic) value = `<em>${value}</em>`; if (state.underline) value = `<u>${value}</u>`; if (state.strike) value = `<del>${value}</del>`; output += value; }
    text = '';
  };
  for (let i = 0; i < rtf.length;) {
    const char = rtf[i++];
    if (char === '{') { flush(); stack.push({ ...state }); continue; }
    if (char === '}') { flush(); state = stack.pop() ?? state; continue; }
    if (char !== '\\') { if (!/[\r\n]/.test(char)) { flushBytes(); if (fallback > 0) fallback--; else text += char; } continue; }
    const symbol = rtf[i];
    if (symbol === '*' ) { flush(); state.skip = true; i++; continue; }
    if (symbol === '\\' || symbol === '{' || symbol === '}') { i++; flushBytes(); if (fallback > 0) fallback--; else text += symbol; continue; }
    if (symbol === "'") { const code = parseInt(rtf.slice(i + 1, i + 3), 16); i += 3; if (fallback > 0) fallback--; else if (!Number.isNaN(code)) bytes.push(code); continue; }
    const control = rtf.slice(i).match(/^([a-z]+)(-?\d+)? ?/i);
    if (!control) { if (symbol === '~') text += '\u00a0'; i++; continue; }
    flushBytes();
    i += control[0].length; const word = control[1].toLowerCase(), n = control[2] === undefined ? undefined : Number(control[2]);
    if (/^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|filetbl|generator|fldinst|datastore|themedata|colorschememapping|listtable|listoverridetable)$/.test(word)) { flush(); state.skip = true; continue; }
    if (word === 'bin') { i += Math.max(0, n ?? 0); continue; }
    if (word === 'ansicpg') { state.encoding = ({936:'gbk',950:'big5',932:'shift_jis',949:'euc-kr',65001:'utf-8'} as Record<number,string>)[n ?? 1252] ?? `windows-${n ?? 1252}`; continue; }
    if (word === 'uc') { state.uc = Math.max(0, n ?? 1); continue; }
    if (word === 'u') { if (!state.skip) text += String.fromCharCode((n ?? 0) & 0xffff); fallback = state.uc; continue; }
    if (state.skip) continue;
    if (['b','i','ul','strike','ulnone','plain'].includes(word)) {
      flush(); if (word === 'b') state.bold = n !== 0; if (word === 'i') state.italic = n !== 0; if (word === 'ul') state.underline = n !== 0; if (word === 'ulnone') state.underline = false; if (word === 'strike') state.strike = n !== 0;
      if (word === 'plain') state = { ...state, bold: false, italic: false, underline: false, strike: false };
    } else if (word === 'par' || word === 'line') { flush(); output += '<br>'; }
    else if (word === 'tab') text += '\t';
    else if (word === 'emdash') text += '—'; else if (word === 'endash') text += '–';
  }
  flush(); return `<div>${output}</div>`;
}
function plainFromHtml(root: HTMLElement) {
  root.querySelectorAll('img').forEach(node => node.replaceWith(node.getAttribute('alt') ?? ''));
  root.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  root.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,pre,blockquote,tr').forEach(node => node.append('\n'));
  root.querySelectorAll('td,th').forEach(node => node.append('\t'));
  return (root.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}
export async function convertFormat(id: string, value: ToolDocument): Promise<ToolDocument> {
  const source = value.html || (value.rtf ? rtfToHtml(value.rtf) : null);
  if (id === 'plain') return { text: value.text || (source ? plainFromHtml(inertHtml(source)) : '') };
  if (id === 'to-markdown') {
    if (!source) return { text: value.text };
    const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
    service.use(gfm);
    service.addRule('strikethrough', { filter: ['del','s'], replacement: content => `~~${content}~~` });
    return { text: service.turndown(inertHtml(source)) };
  }
  const root = inertHtml(marked.parse(value.text, { async: false }) as string);
  if (id === 'to-rich') return { text: value.text, html: root.innerHTML };
  if (id === 'strip-markdown') return { text: plainFromHtml(root) };
  throw Error('未知文字工具');
}
