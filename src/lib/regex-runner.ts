import type { ToolDocument } from './text-tools';
import type { RegexRule } from './regex-transform';
import { builtinScriptCode } from './builtin-scripts.generated';
import { runScript } from './js-runner';
export function runRegex(source:ToolDocument,rule:RegexRule,clipId?:number){return runScript(builtinScriptCode.__regex,{...source,regexRule:rule},false,clipId);}
export function runAutoLines(source:ToolDocument,clipId?:number){return runScript(builtinScriptCode['auto-lines'],source,false,clipId);}
