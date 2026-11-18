import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { defaultScriptRules, newScriptCode, type ScriptRule } from '../lib/js-rules';
import { deleteScriptRule, saveScriptRule, useScriptRules } from '../lib/use-script-rules';
import { call } from '../lib/api';
import { tr } from '../i18n';
import { ConfirmDialog } from './ConfirmDialog';
import { CustomRuleEditor } from './CustomRuleEditor';

export function RuleManager(){
  const {rules,ready,error,reload}=useScriptRules();
  const [editing,setEditing]=useState<ScriptRule|null>(null),[deleting,setDeleting]=useState<ScriptRule|null>(null),[busy,setBusy]=useState(false),[operationError,setOperationError]=useState('');
  const [restoring,setRestoring]=useState<ScriptRule[]|null>(null);
  const backup=async()=>{setBusy(true);setOperationError('');try{await call('backup_rules',{rules});}catch(error){setOperationError(String(error));}finally{setBusy(false);}};
  const chooseRestore=async()=>{setBusy(true);setOperationError('');try{setRestoring(await call<ScriptRule[]|null>('choose_rules_backup'));}catch(error){setOperationError(String(error));}finally{setBusy(false);}};
  const restore=async()=>{if(!restoring||busy)return;setBusy(true);try{await call('restore_rules',{rules:restoring});setRestoring(null);}catch(error){setOperationError(String(error));}finally{setBusy(false);}};
  const builtinIds=useMemo(()=>new Set(defaultScriptRules().map(rule=>rule.id)),[]);
  const toggle=async(rule:ScriptRule,enabled:boolean)=>{if(busy)return;setBusy(true);setOperationError('');try{await saveScriptRule({...rule,enabled});}catch(error){setOperationError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const remove=async()=>{if(!deleting||busy)return;setBusy(true);setOperationError('');try{await deleteScriptRule(deleting.id);setDeleting(null);}catch(error){setOperationError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  return <section className="rule-manager" aria-label={tr('快捷处理规则')}>
    <div className="rule-manager-heading"><button type="button" className="rule-manager-create" disabled={!ready||busy} onClick={()=>setEditing({id:`custom:${crypto.randomUUID()}`,name:'',kind:'js',enabled:true,code:newScriptCode})}><Plus size={15}/>{tr('新建规则')}</button><button type="button" disabled={!ready||busy} onClick={()=>void backup()}>{tr('备份规则')}</button><button type="button" disabled={busy} onClick={()=>void chooseRestore()}>{tr('恢复规则')}</button></div>
    {(operationError||error)&&<div className="rule-manager-error"><p role="alert">{tr(operationError||error)}</p>{error&&<button type="button" onClick={()=>void reload()}>{tr('重新读取')}</button>}</div>}
    {!ready&&!error&&<p className="rule-manager-loading">{tr('读取规则中…')}</p>}
    <div role="list" className="rule-manager-list">{rules.map(rule=><div role="listitem" className="rule-manager-row" key={rule.id}>
      <div className="rule-manager-description"><span>{tr(rule.name)}</span><small>{tr(builtinIds.has(rule.id)?'默认规则':'自定义规则')} · {tr(({text:'文本',image:'图片',files:'文件'})[rule.target??'text'])}</small></div>
      <div className="rule-manager-actions"><input type="checkbox" role="switch" aria-label={`${tr('启用规则')}：${tr(rule.name)}`} checked={rule.enabled} disabled={!ready||busy} onChange={event=>void toggle(rule,event.target.checked)}/><button type="button" title={tr('编辑规则')} aria-label={`${tr('编辑规则')}：${tr(rule.name)}`} disabled={!ready||busy} onClick={()=>setEditing(rule)}><Pencil size={15}/></button>{!builtinIds.has(rule.id)&&<button type="button" title={tr('删除规则')} aria-label={`${tr('删除规则')}：${tr(rule.name)}`} disabled={!ready||busy} onClick={()=>setDeleting(rule)}><Trash2 size={15}/></button>}</div>
    </div>)}</div>
    {restoring&&<ConfirmDialog title={tr('恢复规则')} description={tr('将覆盖当前全部规则，无法撤销。剪贴板记录不受影响。')+(operationError?` ${tr(operationError)}`:'')} confirmLabel={tr('恢复规则')} busy={busy} onCancel={()=>setRestoring(null)} onConfirm={()=>void restore()}/>}
    {editing&&<CustomRuleEditor key={editing.id} rule={editing} source={{text:''}} onClose={()=>setEditing(null)} onSave={saveScriptRule} onDelete={async()=>{await deleteScriptRule(editing.id);}}/>}
    {deleting&&<ConfirmDialog title={`${tr('删除规则')}：${tr(deleting.name)}`} description={tr('删除这条规则？不会删除剪贴板记录。')} confirmLabel={tr('删除规则')} busy={busy} onCancel={()=>setDeleting(null)} onConfirm={()=>void remove()}/>}
  </section>;
}
