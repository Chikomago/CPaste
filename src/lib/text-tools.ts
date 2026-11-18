import { stripLineNumbers } from './line-numbers';
export { stripLineNumbers } from './line-numbers';
export type ToolDocument = { text: string; html?: string | null; rtf?: string | null };
export type TextTool = { id: string; label: string; group: string; apply: (text: string) => string };

export function cleanLinks(text: string) {
  return text.replace(/h[\p{Script=Han}]*t[\p{Script=Han}]*t[\p{Script=Han}]*p[\p{Script=Han}]*s?[\p{Script=Han}]*:\/\/[^\s<>"']+/giu, value => value.replace(/\p{Script=Han}/gu,''));
}
export function extractLinks(text: string) {
  return (text.match(/[A-Za-z0-9:/?#\[\]@!$&'()*+,;=._~%+\-]+/g) ?? []).filter(part => {
    if (/^(?:https?|ftp):\/\/[A-Za-z0-9]/i.test(part)) return true;
    if (/(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?=[:/?#)]|$)/.test(part)) return true;
    if (/^[?&#][A-Za-z0-9._~-]+(?:=|$)/.test(part)) return true;
    // A partial path needs a slash and a letter; numbered lists, dates,
    // decimal values and standalone English words are not links.
    return part.includes('/') && /[A-Za-z]/.test(part) && !part.includes('://');
  }).join('\n');
}
export function toList(text: string, ordered: boolean) {
  let index = 0;
  return text.split(/\r?\n/).map(line => {
    if (!line.trim()) return '';
    const content = line.trim().replace(/^(?:[-*+]\s+|\d+[.)、]\s+)/,'');
    return (ordered ? String(++index) + '. ' : '- ') + content;
  }).join('\n');
}
function protectCodeAndLinks(text: string, change: (text: string) => string) {
  const kept: string[] = [];
  const value = text.replace(/```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s<>"']+/gu, part => `\uE000${kept.push(part) - 1}\uE001`);
  return change(value).replace(/\uE000(\d+)\uE001/g, (_, id) => kept[Number(id)]);
}
export const spaceChineseEnglish = (text: string) => protectCodeAndLinks(text, value => value.replace(/(\p{Script=Han})([A-Za-z0-9])/gu, '$1 $2').replace(/([A-Za-z0-9])(\p{Script=Han})/gu, '$1 $2'));
export const fullwidthPunctuation = (text: string) => protectCodeAndLinks(text, value => value.split('\n').map(line => /\p{Script=Han}/u.test(line) ? line.replace(/"([^"\n]*)"/g, '“$1”').replace(/(\p{Script=Han})\.{3,}/gu, '$1……') : line).join('\n').replace(/[,:;!?().]/g, (char, offset: number, source: string) => {
  const before = source.slice(0, offset).trimEnd().at(-1) ?? '';
  const after = source.slice(offset + 1).trimStart()[0] ?? '';
  if (char === '.' && (source[offset - 1] === '.' || source[offset + 1] === '.')) return char;
  if (!/\p{Script=Han}/u.test(before + after)) return char;
  return ({ ',': '，', ':': '：', ';': '；', '!': '！', '?': '？', '(': '（', ')': '）', '.': '。' } as Record<string,string>)[char];
}));
export const halfwidthPunctuation = (text: string) => protectCodeAndLinks(text, value => value.replace(/[，。：；！？（）“”‘’]/g, char => ({ '，': ',', '。': '.', '：': ':', '；': ';', '！': '!', '？': '?', '（': '(', '）': ')', '“': '"', '”': '"', '‘': "'", '’': "'" } as Record<string,string>)[char]));
export function togglePunctuation(text: string) {
  return protectCodeAndLinks(text, value => {
    if (/[！-／：-＠［-｀｛-～。，“”‘’]/u.test(value)) {
      return halfwidthPunctuation(value).replace(/[！-／：-＠［-｀｛-～]/gu, char => String.fromCharCode(char.charCodeAt(0)-0xfee0));
    }
    // Decimal numbers and version strings keep their dots.
    return value.replace(/\d+(?:\.\d+)+|[!-/:-@\[-`{-~]/g, part => part.length>1 ? part : part==='.' ? '。' : String.fromCharCode(part.charCodeAt(0)+0xfee0));
  });
}
export function autoLineBreaks(text: string) {
  const sentences = new Intl.Segmenter('zh-CN',{granularity:'sentence'});
  const words = new Intl.Segmenter('zh-CN',{granularity:'word'});
  return protectCodeAndLinks(text, value => value.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    // Sentence segmentation treats the dot in "1.正文" as a sentence ending.
    // Attach standalone list markers to their following sentence before wrapping.
    const segments:string[]=[];
    let prefix='';
    for (const {segment} of sentences.segment(line)) {
      if (/^\s*\d{1,6}[.．)\]、]\s*$/u.test(segment)) { prefix+=segment; continue; }
      segments.push(prefix+segment);prefix='';
    }
    if(prefix)segments.push(prefix);
    return segments.map(segment => {
      if ([...segment].length<=80) return segment.trimEnd();
      const tokens = segment.split(/(\uE000\d+\uE001)/g).flatMap(part => /^\uE000\d+\uE001$/.test(part) ? [part] : [...words.segment(part)].map(item=>item.segment));
      const lines:string[]=[];let current='';let length=0;
      for (const token of tokens) {
        if (length>=60 && !/^[\s，,。.!！？?；;：:、”’）)\]}]/u.test(token)) { lines.push(current.trimEnd());current='';length=0; }
        if (!current && !token.trim()) continue;
        current+=token;length += [...token].length;
        if (length>=36 && /[，,；;、]$/.test(token)) { lines.push(current.trimEnd());current='';length=0; }
      }
      if(current)lines.push(current.trimEnd());
      return lines.join('\n');
    }).join('\n');
  }).join('\n'));
}
export const clearInvisible = (text: string) => text.replace(/[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '').replace(/(?<!\p{Extended_Pictographic})\u200D(?!\p{Extended_Pictographic})/gu, '');
export const textTools: TextTool[] = [
  { id: 'trim', label: '去首尾空白', group: '清理', apply: text => text.trim() },
  { id: 'blank-lines', label: '合并空行', group: '清理', apply: text => text.replace(/\r\n/g, '\n').replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, '\n\n') },
  { id: 'one-line', label: '移除换行', group: '清理', apply: text => text.replace(/\r\n|[\r\n\u2028\u2029]/g,'') },
  { id: 'line-numbers', label: '移除行号', group: '清理', apply: stripLineNumbers },
  { id: 'auto-lines', label: '自动分行', group: '排版', apply: autoLineBreaks },
  { id: 'spacing', label: '中英文间加空格', group: '排版', apply: spaceChineseEnglish },
  { id: 'toggle-width', label: '半角全角互转', group: '排版', apply: togglePunctuation },
  { id: 'ordered-list', label: '有序列表', group: '列表', apply: text => toList(text,true) },
  { id: 'unordered-list', label: '无序列表', group: '列表', apply: text => toList(text,false) },
  { id: 'clean-links', label: '净化链接', group: '链接', apply: cleanLinks },
  { id: 'extract-links', label: '提取链接', group: '链接', apply: extractLinks },
];
export function applicableTools(text: string) {
  return textTools.filter(tool => {
    if (tool.id === 'auto-lines') {
      let possible=false;
      protectCodeAndLinks(text,value=>{possible=value.split(/\r?\n/).some(line=>line.length>80 || /[。！？][”’」』）)]*\S|[.!?]\s+\S/u.test(line));return value;});
      return possible;
    }
    return tool.apply(text) !== text && (tool.id !== 'extract-links' || extractLinks(text) !== '');
  });
}
export function applyTextTool(id: string, value: ToolDocument): ToolDocument {
  const tool = textTools.find(tool => tool.id === id);
  if (!tool) throw Error('未知文字工具');
  return { text: tool.apply(value.text) };
}
