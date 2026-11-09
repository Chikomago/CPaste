import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { ExternalLink } from 'lucide-react';
import { call } from '../lib/api';
import { formatBytes } from '../lib/clips';
import { tr } from '../i18n';
import { Setting, Toggle } from './SettingsControls';

export type UpdateStatus = {
  phase: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'installing' | 'ready' | 'error';
  version: string | null;
  notes: string | null;
  downloaded: number;
  total: number | null;
  error: string | null;
};

export function AboutSettings({ autoCheck, onAutoCheck }: { autoCheck: boolean; onAutoCheck: (value: boolean) => void }) {
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    const subscription = listen<UpdateStatus>('update-status', event => { if (!disposed) setStatus(event.payload); });
    void subscription.then(() => call<UpdateStatus>('get_update_status')).then(value => { if (!disposed) setStatus(value); }).catch(e => { if (!disposed) setError(String(e)); });
    void getVersion().then(value => { if (!disposed) setVersion(value); }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; void subscription.then(unlisten => unlisten()); };
  }, []);
  const action = async (command: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await call(command); } catch (e) { setError(tr(String(e))); }
    finally { setBusy(false); }
  };
  const phase = status?.phase ?? 'idle';
  const updating = phase === 'downloading' || phase === 'installing';
  const label = {
    idle: '检查更新', checking: '正在检查…', latest: '已是最新版本', available: '发现新版本',
    downloading: '正在下载…', installing: '正在安装…', ready: '更新已安装，重启后生效', error: '更新未完成',
  }[phase];
  return <section className="about-settings">
    <div className="about-brand"><img src="/logo.svg" alt="CPaste" width={76} height={76}/><div><h3>CPaste</h3><p>{tr('版本')} {version || '—'}</p></div></div>
    <Setting label={tr('作者')}><span>chikomago</span></Setting>
    <Setting label={tr('项目地址')}><button type="button" className="about-link" onClick={() => void call('open_project_link', { kind: 'project' }).catch(e => setError(String(e)))}>Chikomago/CPaste<ExternalLink size={13}/></button></Setting>
    <Setting label={tr('协议')}><button type="button" className="about-link" onClick={() => void call('open_project_link', { kind: 'license' }).catch(e => setError(String(e)))}>GPL-3.0-only<ExternalLink size={13}/></button></Setting>
    <Toggle label={tr('自动检查更新')} checked={autoCheck} onChange={onAutoCheck}/>
    <div className="about-update" aria-live="polite">
      <div className="about-update-heading setting-row"><span>{tr(label)}{status?.version && ` · v${status.version}`}</span>
        {phase === 'ready' ? <button type="button" disabled={busy} className="permission-button" onClick={() => void action('restart_after_update')}>{tr('重启应用')}</button>
          : phase === 'available' || (phase === 'error' && status?.version) ? <button type="button" className="permission-button" disabled={busy} onClick={() => void action('install_update')}>{tr('下载并安装')}</button>
          : <button type="button" className="permission-button" disabled={busy || phase === 'checking' || updating || !status} onClick={() => void action('check_for_updates')}>{tr('检查更新')}</button>}
      </div>
      {phase === 'downloading' && <><progress aria-label={tr('下载进度')} max={status?.total || 1} value={status?.total ? status.downloaded : undefined}/><small>{formatBytes(status?.downloaded || 0)}{status?.total ? ` / ${formatBytes(status.total)}` : ''}</small></>}
      {status?.notes && <details><summary>{tr('更新说明')}</summary><p className="about-release-notes">{status.notes}</p></details>}
      {(error || status?.error) && <p className="about-error" role="alert">{error || `${tr('更新未完成')}: ${status?.error}`}<br/>{tr('可重新检查更新，或到项目地址下载安装包。')}</p>}
    </div>
  </section>;
}
