import type { ScriptRule } from '../src/lib/js-rules';
export function mockRuleIpc(initial:ScriptRule[]=[],other?:(command:string,args:any)=>any){
  const callbacks=new Map<number,(event:any)=>void>(),listeners=new Map<number,{event:string;callback:number}>();let sequence=0;let rules=[...initial];
  const calls:{command:string;args:any}[]=[];
  const emit=(payload:any,event='rules-changed')=>{for(const [id,listener]of listeners)if(listener.event===event)callbacks.get(listener.callback)?.({id,event,payload});};
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_event:string,id:number)=>{const listener=listeners.get(id);if(listener)callbacks.delete(listener.callback);listeners.delete(id);}};
  (window as any).__TAURI_INTERNALS__={convertFileSrc:(path:string)=>'asset://localhost/'+encodeURIComponent(path),metadata:{currentWindow:{label:'settings'},currentWebview:{label:'settings'}},transformCallback:(callback:(event:any)=>void)=>{const id=++sequence;callbacks.set(id,callback);return id;},unregisterCallback:(id:number)=>callbacks.delete(id),invoke:async(command:string,args:any={})=>{
    calls.push({command,args});
    if(command==='plugin:event|listen'){const id=++sequence;listeners.set(id,{event:args.event,callback:args.handler});return id;}
    if(command==='plugin:event|unlisten')return;
    if(command==='get_js_rules')return rules;
    if(command==='save_js_rule'){rules=[...rules.filter(rule=>rule.id!==args.rule.id),args.rule];emit({rule:args.rule});return;}
    if(command==='delete_js_rule'){rules=rules.filter(rule=>rule.id!==args.id);emit({deleted_id:args.id});return;}
    return other?.(command,args);
  }};
  return {calls,emit,listeners,get rules(){return rules;}};
}
