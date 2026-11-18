import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { call } from './api';
import { defaultScriptRules, mergeScriptRules, type ScriptRule } from './js-rules';
export type RuleChange={rule?:ScriptRule;deleted_id?:string;reset?:boolean};
export function applyRuleChange(rules:ScriptRule[],change:RuleChange){
  if(change.rule)return rules.some(rule=>rule.id===change.rule!.id)?rules.map(rule=>rule.id===change.rule!.id?change.rule!:rule):[...rules,change.rule];
  if(change.deleted_id)return rules.filter(rule=>rule.id!==change.deleted_id);
  return rules;
}
export function useScriptRules(){
  const [overrides,setOverrides]=useState<ScriptRule[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('');
  const version=useRef(0),loaded=useRef(false);
  const reload=async()=>{const request=++version.current;try{const rules=await call<ScriptRule[]>('get_js_rules');if(request!==version.current)return;setOverrides(Array.isArray(rules)?rules:[]);loaded.current=true;setReady(true);setError('');}catch(error){if(request===version.current)setError(error instanceof Error?error.message:String(error));}};
  const reloadRef=useRef(reload);reloadRef.current=reload;
  useEffect(()=>{
    let disposed=false;
    const subscription=listen<RuleChange>('rules-changed',event=>{if(disposed)return;if(!loaded.current||!event.payload||event.payload.reset){void reloadRef.current();return;}version.current++;setOverrides(rules=>applyRuleChange(rules,event.payload));});
    void subscription.then(()=>{if(!disposed)void reloadRef.current();}).catch(async error=>{if(disposed)return;await reloadRef.current();if(!disposed)setError(error instanceof Error?error.message:String(error));});
    return()=>{disposed=true;version.current++;void subscription.then(unlisten=>unlisten()).catch(()=>{});};
  },[]);
  const rules=useMemo(()=>mergeScriptRules(overrides),[overrides]);
  return {rules,ready,error,reload};
}
export async function saveScriptRule(rule:ScriptRule){
  const original=defaultScriptRules().find(item=>item.id===rule.id);
  if(original&&original.code===rule.code&&(original.target??'text')===(rule.target??'text')&&original.name===rule.name&&rule.enabled)await call('delete_js_rule',{id:rule.id});
  else await call('save_js_rule',{rule});
}
export async function deleteScriptRule(id:string){await call('delete_js_rule',{id});}
