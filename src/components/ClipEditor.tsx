import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Clip } from '../types';
import type { ToolDocument } from '../lib/text-tools';
import { call } from '../lib/api';
import { tr } from '../i18n';

type Props = { clip: Clip; embedded?: boolean; active?: boolean; busy: boolean; onCancel: () => void; onSave: (content: string, formats?: ToolDocument) => Promise<void>; onBeginInput?: () => void };
export function ClipEditor({ clip, embedded = false, active = true, busy, onCancel, onSave, onBeginInput }: Props) {
  const [value,setValue]=useState<ToolDocument>({text:clip.plain_text});
  const [error,setError]=useState('');
  const input=useRef<HTMLTextAreaElement>(null), changed=useRef(false), saving=useRef(false);
  useEffect(()=>{let live=true;if(clip.kind==='rich')void call<ToolDocument>('get_transform_source',{id:clip.id}).then(source=>{if(live && !changed.current && source?.text!==undefined)setValue(source);}).catch(()=>{});return()=>{live=false;};},[clip.id]);
  useEffect(()=>{if(active)input.current?.focus({preventScroll:true});},[active]);
  const save=async()=>{if(busy || saving.current)return;if(!value.text.trim()){setError(tr('内容不能为空'));return;}saving.current=true;try{setError('');await onSave(value.text,value);}catch(error){setError(String(error));}finally{saving.current=false;}};
  return <div className={embedded?'sidebar-editor':'clip-edit-dialog'} role={embedded?'region':'dialog'} aria-modal={embedded?undefined:true} aria-label={tr('编辑内容')} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!busy){event.preventDefault();onCancel();}else if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();void save();}}}>
    <header className={embedded?'sidebar-work-header':undefined}>{embedded&&<button type="button" aria-label={tr('返回详情')} title={tr('返回详情')} disabled={busy} onMouseDown={e=>e.preventDefault()} onClick={onCancel}><ArrowLeft size={15}/></button>}<h2>{tr('编辑内容')}</h2></header>
    {clip.kind==='rich'&&!value.html&&!value.rtf&&<p className="clip-edit-help">{tr('保存后转为纯文本，原格式会丢失。')}</p>}
    <textarea ref={input} autoFocus aria-label={tr('记录内容')} disabled={busy} value={value.text} onChange={e=>{changed.current=true;setValue({text:e.target.value});setError('');}} onMouseDown={onBeginInput}/>
    {error&&<p className="clip-edit-error" role="alert">{tr(error)}</p>}
    <div className="clip-edit-actions"><button type="button" disabled={busy} onClick={onCancel}>{tr('取消')}</button><button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{tr('保存')}</button></div>
  </div>;
}
