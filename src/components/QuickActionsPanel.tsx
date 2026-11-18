import { useEffect, useRef, useState } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import type { Clip } from '../types';
import type { ToolDocument } from '../lib/text-tools';
import { call } from '../lib/api';
import { tr } from '../i18n';
import { QuickTextTools } from './QuickTextTools';
import type { RegexRule } from '../lib/regex-transform';
import { toolHistoryAction } from '../lib/history-shortcuts';
import type { ScriptRule } from '../lib/js-rules';
import { useScriptRules } from '../lib/use-script-rules';

type Props = { clip: Clip; active?: boolean; busy: boolean; canUndo: boolean; canRedo?: boolean; onClose: () => void; onApply: (id: string, source: ToolDocument, rule?: RegexRule, script?:ScriptRule) => Promise<ToolDocument>; onUndo: () => Promise<ToolDocument | void>; onRedo?: () => Promise<ToolDocument | void> };
export function QuickActionsPanel({ clip, active = true, busy, canUndo, canRedo = false, onClose, onApply, onUndo, onRedo }: Props) {
  const panel = useRef<HTMLElement>(null);
  useEffect(()=>{if(active)panel.current?.focus({preventScroll:true});},[active]);
  const [source,setSource] = useState<ToolDocument | null>(null);
  const [error,setError] = useState('');
  const [working,setWorking] = useState(false);
  const {rules:scripts,ready:rulesReady,error:rulesError}=useScriptRules();
  useEffect(() => { let live=true; setSource(null); void call<ToolDocument>('get_transform_source',{id:clip.id}).then(value=>{if(live)setSource(value);}).catch(error=>{if(live)setError(error instanceof Error?error.message:String(error));}); return ()=>{live=false;}; },[clip.id]);
  const run = async (id?: string, redo = false) => {
    if (busy || working || !source) return;
    setWorking(true);setError('');
    try { if(id) setSource(await onApply(id,source,undefined,scripts.find(script=>script.id===id))); else { const restored=await (redo ? onRedo?.() : onUndo());if(restored)setSource(restored); } }
    catch(error){setError(error instanceof Error?error.message:String(error));}finally{setWorking(false);}
  };
  return <section ref={panel} tabIndex={-1} className="quick-actions-panel" role="region" aria-label={tr('快捷处理')} onKeyDown={event=>{if(event.target instanceof HTMLInputElement){event.stopPropagation();return;}const action=toolHistoryAction(event);if(action){event.preventDefault();event.stopPropagation();if(action==='redo'?canRedo:canUndo)void run(undefined,action==='redo');}else if(event.key==='Escape'&&!busy&&!working){event.preventDefault();event.stopPropagation();onClose();}}}>
    <header className="sidebar-work-header"><h2>{tr('快捷处理')}</h2><button className="quick-actions-undo" type="button" title={tr('撤销上一步处理')} aria-label={tr('撤销上一步处理')} disabled={busy || working || !canUndo} onMouseDown={e=>e.preventDefault()} onClick={()=>void run()}><Undo2 size={15}/></button><button type="button" title={tr('重做上一步处理')} aria-label={tr('重做上一步处理')} disabled={busy || working || !canRedo} onMouseDown={e=>e.preventDefault()} onClick={()=>void run(undefined,true)}><Redo2 size={15}/></button></header>
    <div className="quick-actions-body"><QuickTextTools rules={scripts.filter(rule=>rule.enabled&&(rule.target??'text')==='text')} disabled={busy || working || !source || !rulesReady} onApply={id=>void run(id)}/>

      {rulesReady&&!scripts.some(rule=>rule.enabled&&(rule.target??'text')==='text')&&<p className="clip-details-empty">{tr('在设置中启用快捷处理规则')}</p>}
      {(error||rulesError)&&<p className="clip-edit-error" role="alert">{tr(error||rulesError)}</p>}</div>
  </section>;
}
