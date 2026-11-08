import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { call } from '../lib/api';
import { formatBytes } from '../lib/clips';
import { tr } from '../i18n';

type DictionaryInfo = { word_count: number; bytes: number };
export function DictionaryEditor({ value, onSave }: { value: string; onSave: (words: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<DictionaryInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    let active = true;
    const refresh = () => { void call<DictionaryInfo>('get_dictionary_info').then(info => { if (active) setInfo(info); }).catch(error => { if (active) setError(String(error)); }); };
    refresh();
    const listener = listen('dictionary-changed', refresh);
    return () => { active = false; void listener.then(unlisten => unlisten()); };
  }, []);
  const importWords = async () => {
    setBusy(true); setError('');
    try { const next = await call<DictionaryInfo | null>('import_dictionary'); if (next !== null) setInfo(next); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const save = async () => { setBusy(true); setError(''); try { await onSave(draft); } catch (error) { setError(String(error)); } finally { setBusy(false); } };
  return <div className="dictionary-editor"><p className="settings-help">{tr('支持 .txt 和 .dict 导入')}</p>{info && <p className="dictionary-info">{tr('已导入词典')} · {info.word_count.toLocaleString()} {tr('个词条')} · {formatBytes(info.bytes)}</p>}<textarea aria-label={tr('自定义词条')} value={draft} disabled={busy} spellCheck={false} onChange={event => { setDraft(event.target.value); setError(''); }}/>{error && <p className="clip-edit-error" role="alert">{tr(error)}</p>}<div className="dictionary-actions"><button type="button" disabled={busy} onClick={() => void importWords()}>{tr(busy ? '正在处理词典…' : '导入词典')}</button><button type="button" disabled={busy || draft === value} onClick={() => void save()}>{tr('保存词典')}</button></div></div>;
}
