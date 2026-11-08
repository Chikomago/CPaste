import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { call } from '../lib/api';
import { formatBytes } from '../lib/clips';
import { tr, trNotice } from '../i18n';
import { Setting, Toggle } from './SettingsControls';

type DictionaryInfo = { word_count: number; bytes: number };
export function DictionaryDownload({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  const [info, setInfo] = useState<DictionaryInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => { void call<DictionaryInfo>('get_downloaded_dictionary_info').then(value => { if (active) setInfo(value); }).catch(error => { if (active) setError(String(error)); }); };
    refresh();
    const listeners = Promise.all([
      listen('dictionary-changed', refresh),
      listen<{ received: number; total: number }>('dictionary-download-progress', event => { if (active) setPercent(Math.min(100, Math.floor(event.payload.received * 100 / event.payload.total))); }),
    ]);
    return () => { active = false; void listeners.then(unlisten => unlisten.forEach(fn => fn())); };
  }, []);
  const download = async () => {
    if (busy) return;
    setBusy(true); setPercent(0); setError('');
    try { setInfo(await call<DictionaryInfo>('download_dictionary')); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const installed = Boolean(info?.word_count);
  return <><Setting label={tr('通用词典')}><div className="dictionary-download-control"><span>{installed ? `${tr('已下载')} · ${formatBytes(info!.bytes)}` : `${tr('未下载')} · ${tr('约 5 MB')}`}</span><button type="button" disabled={busy} onClick={() => void download()}>{busy ? percent === 100 ? tr('正在校验…') : `${tr('下载中…')} ${percent}%` : tr(installed ? '重新下载' : '下载词典')}</button></div></Setting>{installed && <Toggle label={tr('使用通用词典')} checked={enabled} onChange={onChange}/>} {error && <p className="clip-edit-error" role="alert">{trNotice(error)}</p>}</>;
}
