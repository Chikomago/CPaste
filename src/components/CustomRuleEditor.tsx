import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ScriptRule } from '../lib/js-rules';
import { defaultScriptRules, newRuleCode } from '../lib/js-rules';
import type { ToolDocument } from '../lib/text-tools';
import {RuleEditorSplit} from './RuleEditorSplit';
import { tr } from '../i18n';

type Props={clipId?:number;rule:ScriptRule;source:ToolDocument;onClose:()=>void;onSave:(rule:ScriptRule)=>Promise<void>;onDelete:()=>Promise<void>};
export function CustomRuleEditor({clipId,rule,source,onClose,onSave,onDelete}:Props){
  const [draft,setDraft]=useState(rule),[busy,setBusy]=useState(false),[error,setError]=useState(''),[output,setOutput]=useState<string|null>(null),[confirm,setConfirm]=useState<'reset'|'delete'|null>(null);
  const sample=(target:string)=>target==='image'?JSON.stringify({width:2,height:2,data:[255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]},null,2):target==='files'?JSON.stringify({files:[{name:'example.txt',path:'/example.txt'}]},null,2):source.text;
  const [testText,setTestText]=useState(sample(rule.target??'text'));
  const effectiveSource=clipId==null?{text:testText}:source;
  const input=useRef<HTMLTextAreaElement>(null);const original=defaultScriptRules().find(item=>item.id===rule.id);const overlay=useRef<HTMLDivElement>(null);
  const target=draft.target??'text',media=target!=='text';
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;input.current?.focus();return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
  const save=async()=>{if(busy)return;if(!draft.name.trim()){setError(tr('请输入规则名称'));return;}setBusy(true);setError('');try{await (await import('../lib/js-execution')).applyScriptRule(draft,source,true,clipId);await onSave({...draft,name:draft.name.trim()});onClose();}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const test=async()=>{if(busy)return;if(clipId==null&&!testText.trim()){setError(tr(media?'测试数据需为 JSON 对象':'请输入测试文本'));return;}setBusy(true);setError('');setOutput(null);try{setOutput((await (await import('../lib/js-execution')).applyScriptRule(draft,effectiveSource,false,clipId)).text);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  return createPortal(<div ref={overlay} className="js-rule-editor-backdrop" onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!busy){event.preventDefault();if(confirm)setConfirm(null);else onClose();}else if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();void save();}else if(event.key==='Tab'){const items=[...overlay.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary,[role=separator]')];const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}}>
    <section className="js-rule-editor" role="dialog" aria-modal="true" aria-label={tr('编辑规则')}><header><h2>{tr('编辑规则')}</h2><label className="js-rule-enabled"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>{tr('启用')}</label></header>
      <label className="js-rule-name">{tr('规则名称')}<input aria-label={tr('规则名称')} maxLength={64} value={draft.name} disabled={busy} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <div className="custom-rule-kind" role="group" aria-label={tr('适用类型')}>{(['text','image','files'] as const).map(type=><button type="button" key={type} disabled={busy} aria-pressed={target===type} onClick={()=>{setDraft({...draft,target:type,kind:'js',code:newRuleCode(type)});setTestText(sample(type));setError('');setOutput(null);}}>{tr({text:'文本',image:'图片',files:'文件'}[type])}</button>)}</div>
      <p>{tr(target==='image'?'输入为像素数据，返回处理后的像素数据。':target==='files'?'files 包含文件名和路径，返回要复制的文本。':'定义 transform(text)，返回字符串或含 text 的对象。')}</p>
      <RuleEditorSplit testColumns={clipId==null?2:1} code={<textarea ref={input} aria-label={tr('JavaScript 代码')} spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={busy} value={draft.code} onChange={e=>{setDraft({...draft,code:e.target.value});setOutput(null);setError('');}}/>} test={<>{clipId==null&&<label className="custom-rule-test">{tr(media?'测试数据（JSON）':'测试文本')}<textarea aria-label={tr(media?'测试数据（JSON）':'测试文本')} placeholder={tr(media?'输入测试数据，试运行不修改记录或文件':'输入文本，试运行不会修改历史记录')} value={testText} disabled={busy} onChange={event=>{setTestText(event.target.value);setOutput(null);setError('');}}/></label>}<div className="rule-test-result"><span>{tr('运行结果')}</span>{output!==null?<pre className="js-rule-test-output" aria-label={tr('试运行结果')}>{output.slice(0,10000)}</pre>:<p className="rule-test-placeholder">{tr('点击试运行查看结果')}</p>}</div></>}/>
      {error&&<p role="alert" className="clip-edit-error">{tr(error)}</p>}
      {confirm&&<div className="js-rule-confirm"><p>{tr(confirm==='reset'?'恢复默认规则？当前修改会丢失。':'删除这条规则？不会删除剪贴板记录。')}</p><button disabled={busy} onClick={()=>setConfirm(null)}>{tr('取消')}</button><button disabled={busy} onClick={async()=>{if(confirm==='reset'&&original){setDraft(original);setOutput(null);setError('');setConfirm(null);}else{setBusy(true);try{await onDelete();onClose();}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}}}}>{tr(confirm==='reset'?'恢复默认':'删除规则')}</button></div>}
      <footer><button type="button" disabled={busy} onClick={()=>setConfirm(original?'reset':'delete')}>{tr(original?'恢复默认':'删除规则')}</button><button type="button" disabled={busy} onClick={()=>void test()}>{tr('试运行')}</button><span/><button type="button" disabled={busy} onClick={onClose}>{tr('取消')}</button><button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{tr('保存规则')}</button></footer>
    </section>
  </div>,document.body);
}
