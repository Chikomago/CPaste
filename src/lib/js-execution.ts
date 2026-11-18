import { call } from './api';
import type { ScriptRule } from './js-rules';
import type { ToolDocument } from './text-tools';
export async function applyScriptRule(rule:ScriptRule,source:ToolDocument,validateOnly=false,clipId?:number){
  if(rule.target==='image'||rule.target==='files'){let testContext=null;if(!validateOnly&&clipId==null){try{testContext=JSON.parse(source.text);}catch{throw Error('测试数据需为 JSON 对象');}if(!testContext||typeof testContext!=='object'||Array.isArray(testContext))throw Error('测试数据需为 JSON 对象');}const result=await call<{text:string}>('execute_media_rule',{id:clipId??null,target:rule.target,code:rule.code,params:null,testContext,validateOnly,dryRun:true});return {text:result.text};}
  const input={...source};
  if(!validateOnly&&['plain','to-markdown','to-rich','strip-markdown'].includes(rule.id))Object.assign(input,{converted:await (await import('./format-conversions')).convertFormat(rule.id,source)});
  return (await import('./js-runner')).runScript(rule.code,input,validateOnly,clipId);
}
