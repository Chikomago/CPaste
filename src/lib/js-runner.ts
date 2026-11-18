import { call } from './api';
import type { ToolDocument } from './text-tools';
import type { RegexRule } from './regex-transform';
export type ScriptInput = ToolDocument & { converted?:ToolDocument; regexRule?:RegexRule };
export function runScript(code:string,input:ScriptInput,validateOnly=false,id?:number):Promise<ToolDocument>{
  return call<ToolDocument>('execute_js_rule',{id:id??null,code,converted:input.converted??null,regexRule:input.regexRule??null,testInput:id==null&&!validateOnly?{text:input.text,html:input.html??null,rtf:input.rtf??null}:null,validateOnly});
}
