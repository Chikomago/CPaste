import { call } from './api';

export const dictionarySegments = (text: string) => call<string[]>('segment_text', { text });

export async function dictionarySearchTerms(query: string): Promise<string[]> {
  const chunks = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const groups = await Promise.all(chunks.map(chunk => /\p{Script=Han}/u.test(chunk) ? dictionarySegments(chunk) : Promise.resolve([chunk])));
  return [...new Set(groups.flatMap((tokens, index) => /\p{Script=Han}/u.test(chunks[index]) ? tokens.filter(token => /[\p{L}\p{N}]/u.test(token)) : tokens))];
}
