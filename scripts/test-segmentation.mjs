import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/segmentation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
const api = {};
new Function('exports', outputText)(api);
const { segmentText, searchTerms, matchesSearch, joinDictionaryTokens } = api;
const match = (text, query) => matchesSearch(text.normalize('NFKC').toLocaleLowerCase(), query, searchTerms(query));

test('selected dictionary words preserve source order and English spacing', () => {
  assert.equal(joinDictionaryTokens('alpha beta gamma', ['alpha', 'beta', 'gamma'], new Set([2, 0])), 'alpha gamma');
  assert.equal(joinDictionaryTokens('你好，剪贴板世界', ['你好', '，', '剪贴板', '世界'], new Set([2, 0])), '你好剪贴板');
  assert.equal(joinDictionaryTokens('same skip same', ['same', 'skip', 'same'], new Set([2])), 'same');
});
test('selecting all preserves whitespace, punctuation and emoji exactly', () => {
  const source = '  你好，world!\n📋 内容  ';
  const words = ['你好', '，', 'world', '!', '📋', '内容'];
  assert.equal(joinDictionaryTokens(source, words, new Set(words.map((_, index) => index))), source);
  assert.equal(joinDictionaryTokens(source, words, new Set()), '');
});

test('multiple Chinese keywords match across gaps and in any order', () => {
  assert.equal(match('今天下午举行项目会议', '会议 下午'), true);
  assert.equal(match('今天下午举行项目会议', '会议 明天'), false);
});
test('English matching ignores case and normalizes full-width input', () => {
  assert.equal(match('Hello clipboard world', 'ＷＯＲＬＤ hello'), true);
  assert.equal(match('Hello clipboard world', 'world missing'), false);
});
test('code punctuation and punctuation-only searches are not discarded', () => {
  assert.equal(match('C compiler notes', 'C++'), false);
  assert.equal(match('C++ compiler notes', 'C++ notes'), true);
  assert.equal(match('ordinary text', '***'), false);
  assert.equal(match('ordinary text', '  '), true);
});
test('word tokens preserve source offsets for Chinese and emoji', () => {
  const source = '  你好，world!\n复制 📋 内容  ';
  for (const token of segmentText(source)) {
    assert.equal(source.slice(token.start, token.end), token.text);
    assert.ok(token.text.trim());
  }
});
test('dictionary search uses the backend dictionary and preserves code terms', async () => {
  const source = readFileSync(new URL('../src/lib/dictionary.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const dictionary = {};
  const calls = [];
  new Function('exports', 'require', outputText)(dictionary, path => {
    assert.equal(path, './api');
    return { call: async (name, args) => { calls.push([name, args.text]); return [args.text]; } };
  });
  assert.deepEqual(await dictionary.dictionarySearchTerms('量子剪贴板星云 C++'), ['量子剪贴板星云', 'c++']);
  assert.deepEqual(calls, [['segment_text', '量子剪贴板星云']]);
});
