import {useCallback,useEffect,useRef,useState} from 'react';
import {listen} from '@tauri-apps/api/event';
import {call} from '../lib/api';
import {formatBytes} from '../lib/clips';
import {tr} from '../i18n';
import {ConfirmDialog} from './ConfirmDialog';

type Kind='database'|'originals'|'thumbnails'|'icons';
type Item={kind:Kind;bytes:number;included:boolean};
type Report={total:number;items:Item[]};
const labels:Record<Kind,{label:string;help:string}>={
 database:{label:'历史数据',help:'回收空闲空间，不删除记录'},
 originals:{label:'图片原图',help:'清理会删除图片记录'},
 thumbnails:{label:'缩略图缓存',help:'清理后按需重新生成'},
 icons:{label:'应用图标缓存',help:'按需从本机应用重新读取'},
};
export function StorageUsage({onTotal,onClearHistory,clearing=false}:{onTotal:(bytes:number)=>void;onClearHistory:()=>void;clearing?:boolean}){
 const [report,setReport]=useState<Report|null>(null),[selected,setSelected]=useState<Kind|null>(null),[busy,setBusy]=useState<Kind|null>(null),[error,setError]=useState(''),[status,setStatus]=useState('');
 const version=useRef(0);
 const apply=useCallback((value:Report)=>{setReport(value);onTotal(value.total);},[onTotal]);
 const refresh=useCallback(async()=>{const request=++version.current;try{const value=await call<Report>('get_storage_breakdown');if(request===version.current)apply(value);}catch(error){if(request===version.current)setError(String(error));}},[apply]);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(),150);};
  void refresh();const events=Promise.all(['clips-changed','storage-changed','dictionary-changed','rules-changed'].map(event=>listen(event,schedule)));
  return()=>{version.current++;clearTimeout(timer);void events.then(unlisteners=>unlisteners.forEach(off=>off()));};
 },[refresh]);
 const clear=async(kind:Kind)=>{
  if(busy)return;const before=report?.items.find(item=>item.kind===kind)?.bytes??0;
  setBusy(kind);setError('');setStatus('');version.current++;
  try{const value=await call<Report>('clear_storage_category',{kind});version.current++;apply(value);setSelected(null);if(kind==='database'&&(value.items.find(item=>item.kind===kind)?.bytes??0)>=before)setStatus(tr('没有可释放的空间'));}
  catch(error){setError(String(error));}finally{setBusy(null);}
 };
 const choose=(kind:Kind)=>{setError('');setStatus('');if(kind==='originals')setSelected(kind);else void clear(kind);};
 const rows=(included:boolean)=>report?.items.filter(item=>item.included===included).map(item=><div className="setting-row storage-usage-row" key={item.kind}>
  <div><strong>{tr(labels[item.kind].label)}</strong><small>{tr(labels[item.kind].help)}</small></div>
  <div className="storage-usage-actions"><span>{formatBytes(item.bytes)}</span><button type="button" className="clear-history-button" aria-label={`${tr(item.kind==='database'?'整理':'清理')}：${tr(labels[item.kind].label)}`} disabled={busy!==null||item.bytes===0} onClick={()=>choose(item.kind)}>{tr(item.kind==='database'?'整理':'清理')}</button>{item.kind==='database'&&<button type="button" className="clear-history-button" disabled={busy!==null||clearing} onClick={onClearHistory}>{tr('清空所有记录')}</button>}</div>
 </div>);
 return <section className="storage-usage" aria-label={tr('占用明细')}>
  <h2>{tr('占用明细')}</h2>
  {report?rows(true):<p className="settings-help">{tr('正在统计占用…')}</p>}
  {error&&<p className="storage-usage-error" role="alert">{tr(error)}</p>}{status&&<p className="settings-help" role="status">{status}</p>}
  {selected&&<ConfirmDialog title={`${tr('清理')}：${tr(labels[selected].label)}`} description={tr('将删除全部图片记录，含置顶和收藏，无法恢复。其他类型不受影响。')+(error?` ${tr(error)}`:'')} confirmLabel={tr('清理')} busy={busy!==null} onCancel={()=>{setSelected(null);setError('');}} onConfirm={()=>void clear(selected)}/>}
 </section>;
}
