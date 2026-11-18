import type { ToolDocument } from './text-tools';
export type RegexRule = { pattern: string; flags: string; mode: 'extract' | 'replace'; replacement: string };
export function validateRegexRule(rule:RegexRule):RegExp {
  if (!rule.pattern) throw Error('请输入正则表达式');
  if (rule.pattern.length > 512 || !/^[gimsu]*$/.test(rule.flags) || new Set(rule.flags).size !== rule.flags.length) throw Error('检查正则表达式和修饰符');
  try { return new RegExp(rule.pattern,rule.flags); } catch { throw Error('检查正则表达式和修饰符'); }
}
export function transformRegex(text: string, rule: RegexRule): ToolDocument {
  const regex=validateRegexRule(rule);
  const result = rule.mode === 'replace' ? text.replace(regex,rule.replacement) : (text.match(regex.global ? regex : new RegExp(regex.source,regex.flags+'g')) ?? []).filter(Boolean).join('\n');
  if (!result.trim()) throw Error('处理结果为空，原内容未修改');
  return {text:result};
}
