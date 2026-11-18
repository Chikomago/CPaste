import {useEffect,useState} from 'react';
import {useScriptRules} from '../lib/use-script-rules';
import type {ScriptRule} from '../lib/js-rules';
import {Undo2,Redo2} from 'lucide-react';
import {call} from '../lib/api';
import {tr} from '../i18n';
import {toolHistoryAction} from '../lib/history-shortcuts';
import type {Clip} from '../types';

type Operation={action:string;token?:number};
type ImageHistory={past:number[];future:number[]};
const histories=new Map<number,ImageHistory>();
function history(id:number){return histories.get(id)??{past:[],future:[]};}
function remember(id:number,value:ImageHistory){histories.delete(id);histories.set(id,value);while(histories.size>20)histories.delete(histories.keys().next().value!);window.dispatchEvent(new window.Event('media-tool-history'));}
export async function mediaHistoryAction(id:number,action:'undo'|'redo'){
 const current=history(id),token=(action==='undo'?current.past:current.future).at(-1);if(token==null)return;
 await call('image_history',{id,action,token});
 remember(id,action==='undo'?{past:current.past.slice(0,-1),future:[...current.future,token]}:{past:[...current.past,token],future:current.future.slice(0,-1)});
}
export async function applyMediaScript(clip:Clip,rule:ScriptRule){
 const result=await call<{token:number|null}>('execute_media_rule',{id:clip.id,target:rule.target,code:rule.code,params:null,testContext:null,validateOnly:false,dryRun:false});
 if(result.token!=null){const current=history(clip.id);remember(clip.id,{past:[...current.past.slice(-19),result.token],future:[]});}
}
export function MediaQuickTools({clip,busy,onBusy,onError}:{clip:Clip;busy:boolean;onBusy:(value:boolean)=>void;onError:(message:string)=>void}){
 const {rules,ready,error}=useScriptRules();
 const available=rules.filter(rule=>rule.enabled&&rule.target===clip.kind);
 const [past,setPast]=useState<number[]>(()=>history(clip.id).past),[future,setFuture]=useState<number[]>(()=>history(clip.id).future),[working,setWorking]=useState(false);
 const run=async(operation:Operation,rule?:ScriptRule)=>{if(working||busy)return;setWorking(true);onBusy(true);try{const result=rule?await call<{token:number|null;path:string|null}>('execute_media_rule',{id:clip.id,target:rule.target,code:rule.code,params:null,testContext:null,validateOnly:false,dryRun:false}):await call<{token:number|null;path:string|null}>('image_history',{id:clip.id,action:operation.action,token:operation.token});if(rule?.target==='files')onError(tr(rule.id==='files:names'?'已复制文件名':'已复制'));if(result.token!=null){const current=history(clip.id);remember(clip.id,operation.action==='undo'?{past:current.past.slice(0,-1),future:[...current.future,result.token]}:operation.action==='redo'?{past:[...current.past,result.token],future:current.future.slice(0,-1)}:{past:[...current.past.slice(-19),result.token],future:[]});}}catch(error){onError(String(error));}finally{setWorking(false);onBusy(false);}};
 useEffect(()=>{const sync=()=>{setPast(history(clip.id).past);setFuture(history(clip.id).future);};window.addEventListener('media-tool-history',sync);return()=>window.removeEventListener('media-tool-history',sync);},[clip.id]);
 useEffect(()=>{if(clip.kind!=='image')return;const listener=(event:KeyboardEvent)=>{if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)return;const action=toolHistoryAction(event);if(!action)return;event.preventDefault();event.stopImmediatePropagation();const token=action==='undo'?past.at(-1):future.at(-1);if(token!=null)void run({action,token});};window.addEventListener('keydown',listener,true);return()=>window.removeEventListener('keydown',listener,true);},[past,future,busy,working,clip.id]);
 return <div className="media-quick-tools">
 {clip.kind==='image'&&<div className="media-tool-history"><button type="button" title={tr('撤销')} aria-label={tr('撤销')} disabled={busy||!past.length} onClick={()=>void run({action:'undo',token:past.at(-1)})}><Undo2 size={14}/></button><button type="button" title={tr('重做')} aria-label={tr('重做')} disabled={busy||!future.length} onClick={()=>void run({action:'redo',token:future.at(-1)})}><Redo2 size={14}/></button></div>}
 {error&&<p role="alert">{tr(error)}</p>}
 {ready&&!available.length&&<p>{tr('在设置中启用快捷处理规则')}</p>}
 {available.map(rule=><button type="button" key={rule.id} disabled={!ready||busy||working||clip.sensitive_masked} onClick={()=>void run({action:'script'},rule)}>{tr(rule.name)}</button>)}
 </div>;
}
