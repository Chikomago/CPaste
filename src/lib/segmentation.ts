export type TextToken = { text: string; start: number; end: number };
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

export function segmentText(text: string): TextToken[] {
  return Array.from(segmenter.segment(text), part => ({ text: part.segment, start: part.index, end: part.index + part.segment.length })).filter(token => token.text.trim());
}

export function searchTerms(query: string): string[] {
  const chunks = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return [...new Set(chunks.flatMap(chunk => /\p{Script=Han}/u.test(chunk) ? segmentText(chunk).map(token => token.text).filter(text => /[\p{L}\p{N}]/u.test(text)) : [chunk]))];
}

export function matchesSearch(text: string, query: string, terms: string[]): boolean {
  const needle = query.normalize('NFKC').trim().toLocaleLowerCase();
  return !needle || text.includes(needle) || (terms.length > 0 && terms.every(term => text.includes(term)));
}

export function joinDictionaryTokens(source: string, words: string[], selected: Set<number>): string {
  if (!selected.size) return '';
  if (words.length > 0 && words.every((_, index) => selected.has(index))) return source;
  let cursor = 0;
  let previous: { word: string; end: number } | null = null;
  let output = '';
  words.forEach((word, index) => {
    const start = source.indexOf(word, cursor);
    const end = start < 0 ? cursor : start + word.length;
    cursor = end;
    if (!selected.has(index)) return;
    if (previous) {
      const gap = start >= previous.end ? source.slice(previous.end, start) : null;
      if (gap !== null && /^\s*$/.test(gap)) output += gap;
      else if (/[A-Za-z0-9]$/.test(previous.word) && /^[A-Za-z0-9]/.test(word)) output += ' ';
    }
    output += word;
    previous = { word, end };
  });
  return output;
}
