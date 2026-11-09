import { AboutSettings } from '../components/AboutSettings';
import { DictionaryEditor } from '../components/DictionaryEditor';
import { DictionaryDownload } from '../components/DictionaryDownload';
import { ConfirmDialog } from '../components/ConfirmDialog';
import React from 'react';
import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Info, AppWindow, Clipboard, Database, Download, Keyboard, List, Palette, Power, Search, Shield, Upload, WholeWord, X } from 'lucide-react';
import { ActionShortcut, Preferences, InstalledApp } from '../types';
import { actionShortcutLabels, defaults } from '../preferences';
import { normalizeShortcut, displayShortcut, shortcutFromKey } from '../lib/shortcuts';
import { formatBytes } from '../lib/clips';
import { applyTheme } from '../lib/theme';
import { call } from '../lib/api';
import { InstalledAppIcon } from '../components/ClipMedia';
import { Setting, SettingsSelect, SettingsNumber, Toggle } from '../components/SettingsControls';
import { isEnglish, setLanguage, tr, trNotice } from '../i18n';

export type Category = 'appearance' | 'shortcut' | 'behavior' | 'capture' | 'segmentation' | 'cleanup' | 'privacy' | 'permissions' | 'startup' | 'backup' | 'about';
export const categories: { id: Category; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'appearance', label: '界面', icon: Palette },
  { id: 'shortcut', label: '快捷键', icon: Keyboard },
  { id: 'behavior', label: '行为', icon: Clipboard },
  { id: 'segmentation', label: '分词', icon: WholeWord },
  { id: 'capture', label: '采集类型', icon: List },
  { id: 'cleanup', label: '存储', icon: Database },
  { id: 'privacy', label: '隐私', icon: Shield },
  { id: 'permissions', label: '系统权限', icon: Shield },
  { id: 'startup', label: '启动与显示', icon: Power },
  { id: 'backup', label: '备份', icon: Database },
  { id: 'about', label: '关于', icon: Info },
];
export function SettingsWindow() {
  const [prefs, setPrefs] = useState<Preferences>(defaults);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [category, setCategory] = useState<Category>('appearance');
  const [notice, setNotice] = useState('');
  const [appInput, setAppInput] = useState('');
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [recordingAction, setRecordingAction] = useState<ActionShortcut | null>(null);
  const [databaseSize, setDatabaseSize] = useState<number | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [fullDiskGranted, setFullDiskGranted] = useState<boolean | null>(null);
  useEffect(() => {
    void call<Preferences>('get_preferences').then(p => { setPrefs(p); setLanguage(p.language); applyTheme(p.theme, p.accent_color); }).catch(e => setNotice(`设置读取失败：${String(e)}`));
    const refreshSize = () => { void call<number>('get_database_size').then(setDatabaseSize).catch(() => setDatabaseSize(null)); };
    refreshSize();
    const listener = Promise.all([listen('clips-changed', refreshSize), listen('dictionary-changed', refreshSize)]);
    return () => { void listener.then(unlisteners => unlisteners.forEach(unlisten => unlisten())); };
  }, []);
  useEffect(() => {
    if (category !== 'privacy') return;
    void call<InstalledApp[]>('list_installed_apps').then(setInstalledApps).catch(() => setInstalledApps([]));
  }, [category]);
  useEffect(() => {
    if (category !== 'permissions' || !navigator.userAgent.includes('Mac')) return;
    const update = () => {
      void call<boolean>('accessibility_status').then(setAccessibilityGranted).catch(() => setAccessibilityGranted(false));
      void call<boolean | null>('full_disk_access_status').then(setFullDiskGranted).catch(() => setFullDiskGranted(null));
    };
    update();
    const timer = window.setInterval(update, 1200);
    return () => window.clearInterval(timer);
  }, [category]);
  const save = async (next: Preferences) => { setPrefs(next); setLanguage(next.language); applyTheme(next.theme, next.accent_color); try { await call('save_preferences', { preferences: next }); } catch (e) { setNotice(`设置未保存：${String(e)}`); const prior = await call<Preferences>('get_preferences'); setPrefs(prior); setLanguage(prior.language); applyTheme(prior.theme, prior.accent_color); } };
  const appRule = (app: InstalledApp) => navigator.userAgent.includes('Windows') ? app.name : app.path;
  const isAppBlocked = (app: InstalledApp) => prefs.excluded_apps.some(rule => rule.toLocaleLowerCase() === app.name.toLocaleLowerCase() || rule.toLocaleLowerCase() === app.path.toLocaleLowerCase() || (rule.toLocaleLowerCase().endsWith('.app') && app.path.toLocaleLowerCase().startsWith(`${rule.toLocaleLowerCase()}/`)));
  const toggleAppBlocked = (app: InstalledApp) => {
    const blocked = isAppBlocked(app);
    const next = prefs.excluded_apps.filter(rule => rule.toLocaleLowerCase() !== app.name.toLocaleLowerCase() && rule.toLocaleLowerCase() !== app.path.toLocaleLowerCase());
    if (!blocked) next.push(appRule(app));
    void save({ ...prefs, excluded_apps: next });
  };
  const recordShortcut = (e: React.KeyboardEvent<HTMLInputElement>) => { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') { setRecordingShortcut(false); e.currentTarget.blur(); return; } const shortcut = shortcutFromKey(e); if (!shortcut) { if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) setNotice('请按下带 ⌘、Ctrl 或 Alt 的组合键'); return; } setRecordingShortcut(false); e.currentTarget.blur(); void save({ ...prefs, shortcut }); };
  const recordActionShortcut = (action: ActionShortcut, e: React.KeyboardEvent<HTMLInputElement>) => { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') { setRecordingAction(null); e.currentTarget.blur(); return; } const shortcut = shortcutFromKey(e, true); if (!shortcut) { if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) setNotice('请按组合键，或 Enter、空格、Delete'); return; } const normalized = normalizeShortcut(shortcut); if (normalized === normalizeShortcut(prefs.shortcut) || Object.entries(prefs.action_shortcuts).some(([key, value]) => key !== action && value && normalizeShortcut(value) === normalized)) { setNotice('快捷键已被使用，请换一组'); return; } setRecordingAction(null); e.currentTarget.blur(); void save({ ...prefs, action_shortcuts: { ...prefs.action_shortcuts, [action]: shortcut } }); };
  const backup = async () => {
    setBackupBusy(true);
    try { const path = await call<string | null>('backup_database'); if (path) setNotice(tr('备份已保存')); }
    catch (error) { setNotice(`备份失败：${String(error)}`); }
    finally { setBackupBusy(false); }
  };
  const restore = async () => {
    setBackupBusy(true);
    try {
      const path = await call<string | null>('choose_restore_file');
      if (!path || !window.confirm(tr('恢复备份会覆盖当前所有记录和设置，无法撤销。确定继续吗？'))) return;
      await call('restore_database', { path });
      const [restored, size] = await Promise.all([call<Preferences>('get_preferences'), call<number>('get_database_size')]);
      setPrefs(restored); setLanguage(restored.language); applyTheme(restored.theme, restored.accent_color); setDatabaseSize(size); setNotice(tr('备份已恢复'));
    } catch (error) { setNotice(`恢复失败：${String(error)}`); }
    finally { setBackupBusy(false); }
  };
  const clearHistory = async () => { if (clearing) return; setClearing(true); try { await call('clear_clips'); setDatabaseSize(await call<number>('get_database_size')); setClearOpen(false); } catch (error) { setNotice(`清空失败：${String(error)}`); } finally { setClearing(false); } };
  return <div className="settings-window">
    {clearOpen && <ConfirmDialog title={tr('清空所有记录')} description={tr('将删除全部剪贴板记录，包括置顶和收藏，无法恢复。设置和系统剪贴板不受影响。')} confirmLabel={tr('清空所有记录')} busy={clearing} onCancel={() => setClearOpen(false)} onConfirm={() => void clearHistory()}/>}
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={tr('设置分类')}>
        <div className="settings-nav-items">{categories.map(c => <button key={c.id} className={category === c.id ? 'active' : ''} onClick={() => setCategory(c.id)}><c.icon size={17}/>{tr(c.label)}</button>)}</div>
        <div className="settings-storage" aria-live="polite"><Database size={14}/><strong>{databaseSize === null ? '—' : formatBytes(databaseSize)} / {prefs.max_storage_mb === 0 ? tr('无限制') : formatBytes(prefs.max_storage_mb * 1048576)}</strong></div>
      </nav>
      <main className="settings-body"><h2>{tr(categories.find(c => c.id === category)?.label || '')}</h2>
        {category === 'appearance' && <>
          <Setting label={tr('展示位置')} help={tr('选择面板出现的位置和样式')}><SettingsSelect label={tr('展示位置')} value={prefs.popup_position} options={[['cursor', tr('跟随光标')], ['center', tr('屏幕中间')], ['left', tr('屏幕左侧')], ['right', tr('屏幕右侧')], ['top', tr('屏幕顶部')], ['bottom', tr('屏幕底部')]]} onChange={value => void save({ ...prefs, popup_position: value as Preferences['popup_position'] })}/></Setting>
          {(prefs.popup_position === 'left' || prefs.popup_position === 'right') && <Setting label={tr('卡片列数')} help={tr('左侧和右侧面板使用')}><div className="segmented"><button className={prefs.side_columns === 1 ? 'active' : ''} onClick={() => void save({ ...prefs, side_columns: 1 })}>{tr('一列') }</button><button className={prefs.side_columns === 2 ? 'active' : ''} onClick={() => void save({ ...prefs, side_columns: 2 })}>{tr('两列') }</button></div></Setting>}
          <Setting label={tr('语言')} help={tr('切换界面语言')}><SettingsSelect label={tr('语言')} value={prefs.language} options={[['zh-CN', tr('中文')], ['en-US', 'English']]} onChange={value => void save({ ...prefs, language: value as Preferences['language'] })}/></Setting>
          <Setting label={tr('主题')} help={tr('切换主题外观')}><SettingsSelect label={tr('主题')} value={prefs.theme} options={[['system', tr('跟随系统')], ['light', tr('浅色')], ['dark', tr('深色')]]} onChange={value => void save({ ...prefs, theme: value as Preferences['theme'] })}/></Setting>
          <Setting label={tr('主题色')} help={tr('界面主色调')}><input className="accent-picker" type="color" aria-label={tr('主题色')} value={prefs.accent_color} onChange={event => void save({ ...prefs, accent_color: event.target.value })}/></Setting>
          <Toggle label={tr('内容预览')} help={tr('跟随光标显示剪贴板预览卡片')} checked={prefs.hover_preview} onChange={v => void save({ ...prefs, hover_preview: v })}/>
          <Toggle label={tr('显示来源应用图标')} help={tr('在记录条目中显示复制来源的应用图标')} checked={prefs.show_source_app_icon} onChange={value => void save({ ...prefs, show_source_app_icon: value })}/>
          <Setting label={tr('条目最大显示行数')} help={tr('超过设定行数的内容会省略')}><SettingsNumber label={tr('条目最大显示行数')} value={prefs.item_max_lines} min={1} max={10} onCommit={value => void save({ ...prefs, item_max_lines: value })}/></Setting>
          <Toggle label={tr('粘贴后回到顶部')} help={tr('粘贴后将记录列表滚回顶部')} checked={prefs.return_to_top_after_paste} onChange={v => void save({ ...prefs, return_to_top_after_paste: v })}/>
          <Setting label={tr('默认打开分类')} help={tr('呼出面板时显默认展示分类')}><div className="segmented"><button className={prefs.default_filter === 'all' ? 'active' : ''} onClick={() => void save({ ...prefs, default_filter: 'all' })}>{tr('全部') }</button><button className={prefs.default_filter === 'favorite' ? 'active' : ''} onClick={() => void save({ ...prefs, default_filter: 'favorite' })}>{tr('收藏') }</button></div></Setting>
        </>}
        {category === 'shortcut' && <>
          <Setting label={tr('打开主面板')} help={tr('点击输入框后按下组合键；Esc 取消')}><input className="shortcut-input" aria-label={tr('打开选择面板的快捷键')} readOnly value={recordingShortcut ? tr('请按下组合键…') : displayShortcut(prefs.shortcut)} onFocus={() => setRecordingShortcut(true)} onBlur={() => setRecordingShortcut(false)} onKeyDown={recordShortcut}/></Setting>

          {actionShortcutLabels.map(({ action, label }) => <Setting key={action} label={tr(label)}><div className="shortcut-control"><input className="shortcut-input" aria-label={`${tr(label)} ${isEnglish() ? 'shortcut' : '的快捷键'}`} readOnly value={recordingAction === action ? tr('请按下快捷键…') : displayShortcut(prefs.action_shortcuts?.[action] || '')} placeholder={tr('未设置')} onFocus={() => setRecordingAction(action)} onBlur={() => setRecordingAction(null)} onKeyDown={e => recordActionShortcut(action, e)}/><button type="button" aria-label={isEnglish() ? `Clear ${tr(label)} shortcut` : `清除${label}快捷键`} title={tr('清除快捷键')} disabled={!prefs.action_shortcuts?.[action]} onClick={() => void save({ ...prefs, action_shortcuts: { ...prefs.action_shortcuts, [action]: '' } })}><X size={14}/></button></div></Setting>)}
        </>}
        {category === 'behavior' && <>
          <h3>{tr('粘贴')}</h3>
          <Toggle label={tr('粘贴后关闭面板')} help={tr('完成粘贴后收起选择面板')} checked={prefs.close_after_paste} onChange={v => void save({ ...prefs, close_after_paste: v })}/>
          <Toggle label={tr('默认粘贴为纯文本')} help={tr('文本和富文本记录不带格式；图片不受影响')} checked={prefs.default_plain_paste} onChange={v => void save({ ...prefs, default_plain_paste: v })}/>
          <Toggle label={tr('默认粘贴文件路径')} help={tr('文件记录粘贴为路径文字；关闭后粘贴文件')} checked={prefs.default_file_paths} onChange={v => void save({ ...prefs, default_file_paths: v })}/>
          <Setting label={tr('点击粘贴')} help={tr('选择记录时如何粘贴')}><div className="segmented"><button className={prefs.paste_on_single_click ? 'active' : ''} onClick={() => void save({ ...prefs, paste_on_single_click: true })}>{tr('单击') }</button><button className={!prefs.paste_on_single_click ? 'active' : ''} onClick={() => void save({ ...prefs, paste_on_single_click: false })}>{tr('双击') }</button></div></Setting>
          <h3>{tr('复制')}</h3>
          <Toggle label={tr('默认复制为纯文本')} help={tr('文本和富文本记录不带格式；图片不受影响')} checked={prefs.default_plain_copy} onChange={v => void save({ ...prefs, default_plain_copy: v })}/>
          <Toggle label={tr('默认复制文件路径')} help={tr('文件记录复制为路径文字；关闭后复制文件')} checked={prefs.default_copy_file_paths} onChange={v => void save({ ...prefs, default_copy_file_paths: v })}/>
        </>}
        {category === 'segmentation' && <>
          <DictionaryDownload enabled={prefs.segment_builtin_dictionary} onChange={value => void save({ ...prefs, segment_builtin_dictionary: value })}/>
          <Toggle label={tr('自定义词典')} checked={prefs.segment_custom_dictionary} onChange={value => void save({ ...prefs, segment_custom_dictionary: value })}/>
          <div hidden={!prefs.segment_custom_dictionary}><DictionaryEditor value={prefs.segment_custom_words} onSave={async words => { const next = { ...prefs, segment_custom_words: words }; await call('save_preferences', { preferences: next }); setPrefs(next); }}/></div>
        </>}
        {category === 'capture' && <><p className="settings-help">{tr('选择要保存的剪贴板类型。') }</p>{([['capture_text','纯文本'],['capture_rich','富文本'],['capture_image','图片'],['capture_files','文件']] as const).map(([key,label]) => <Toggle key={key} label={tr(label)} checked={prefs[key]} onChange={value => void save({ ...prefs, [key]: value })}/>)}</>}
        {category === 'cleanup' && <><div className="storage-rows">
          <Setting label={tr('保留天数')} help={tr('设为 0 则不按时间清理')}><SettingsNumber label={tr('保留天数')} value={prefs.retention_days} min={0} max={3650} onCommit={value => void save({ ...prefs, retention_days: value })}/></Setting>
          <Setting label={tr('最多条数')} help={tr('设为 0 则不限制条数')}><SettingsNumber label={tr('最多条数')} value={prefs.max_items} min={0} max={1000000} onCommit={value => void save({ ...prefs, max_items: value })}/></Setting>
          <Setting label={tr('存储上限（MB）')} help={tr('设为 0 则不限制容量')}><SettingsNumber label={tr('存储上限（MB）')} value={prefs.max_storage_mb} min={0} max={102400} onCommit={value => void save({ ...prefs, max_storage_mb: value })}/></Setting>
        </div><p className="settings-help">{tr('置顶和收藏的记录不自动清理。') }</p><Setting label={tr('清空所有记录')} help={tr('删除全部记录，包括置顶和收藏')}><button type="button" className="clear-history-button" onClick={() => setClearOpen(true)}>{tr('清空所有记录')}</button></Setting></>}
        {category === 'privacy' && <>
          <Setting label={tr('敏感内容')} help={tr('识别密钥、令牌和密码字段')}><SettingsSelect label={tr('敏感内容处理方式')} value={prefs.sensitive_action} options={[["mask", tr('保存并遮盖')], ["skip", tr('不加入历史')], ["save", tr('正常保存')]]} onChange={value => void save({ ...prefs, sensitive_action: value as Preferences['sensitive_action'] })}/></Setting>
          <h3>{tr('来源应用黑名单') }</h3><p className="settings-help">{tr('开启后不记录从该应用复制的内容。') }</p>
          <div className="app-list-search"><Search size={15}/><input aria-label={tr('搜索本机应用')} placeholder={tr('搜索应用')} value={appInput} onChange={event => setAppInput(event.target.value)}/></div>
          <div className="installed-app-list">{installedApps.filter(app => !appInput.trim() || app.name.toLocaleLowerCase().includes(appInput.trim().toLocaleLowerCase())).map(app => <label className="installed-app-row" key={app.path}><InstalledAppIcon app={app}/><span className="installed-app-name" title={app.path}>{app.name}</span><input type="checkbox" aria-label={isEnglish() ? `Exclude ${app.name}` : `不记录 ${app.name}`} checked={isAppBlocked(app)} onChange={() => toggleAppBlocked(app)}/></label>)}{prefs.excluded_apps.filter(rule => !installedApps.some(app => rule.toLocaleLowerCase() === app.name.toLocaleLowerCase() || rule.toLocaleLowerCase() === app.path.toLocaleLowerCase())).filter(rule => !appInput.trim() || rule.toLocaleLowerCase().includes(appInput.trim().toLocaleLowerCase())).map(rule => <label className="installed-app-row" key={rule}><AppWindow size={19}/><span className="installed-app-name" title={rule}>{rule}</span><input type="checkbox" aria-label={isEnglish() ? `Exclude ${rule}` : `不记录 ${rule}`} checked onChange={() => void save({ ...prefs, excluded_apps: prefs.excluded_apps.filter(value => value !== rule) })}/></label>)}{installedApps.length === 0 && <p className="settings-help">{tr('未读取到本机应用。重新打开设置后再试。') }</p>}</div>
        </>}
        {category === 'permissions' && <>{navigator.userAgent.includes('Mac') ? <>
          <Setting label={tr('辅助功能')} help={tr('用于粘贴到其他应用所需权限')}><button type="button" className="permission-button" onClick={() => void call<boolean>('open_system_permission', { kind: 'accessibility' }).then(setAccessibilityGranted).catch(error => setNotice(`无法请求辅助功能权限：${String(error)}`))}>{tr(accessibilityGranted ? '已开启' : '去开启')}</button></Setting>
          <Setting label={tr('完全磁盘访问')} help={tr('需在系统设置中手动开启')}><button type="button" className="permission-button" onClick={() => void call<boolean>('open_system_permission', { kind: 'full_disk' }).then(setFullDiskGranted).catch(error => setNotice(`无法打开系统设置：${String(error)}`))}>{tr(fullDiskGranted === true ? '已开启' : fullDiskGranted === false ? '去开启' : '打开系统设置')}</button></Setting>
        </> : <p className="settings-help">{tr('Windows 无需单独开启这两项权限。') }</p>}</>}
        {category === 'startup' && <>
          <Toggle label={tr('在菜单栏／托盘显示')} help={tr('关闭后仍可用快捷键打开面板')} checked={prefs.show_tray_icon} onChange={v => void save({ ...prefs, show_tray_icon: v })}/>
          {navigator.userAgent.includes('Mac') && <Toggle label={tr('在 Dock 显示')} help={tr('关闭后仍可用快捷键呼出面板')} checked={prefs.show_dock_icon} onChange={v => void save({ ...prefs, show_dock_icon: v })}/>}
          <Toggle label={tr('开机启动')} help={tr('登录电脑后开始后台记录')} checked={prefs.launch_at_login} onChange={v => void save({ ...prefs, launch_at_login: v })}/>
        </>}
        {category === 'backup' && <><p className="settings-help">{tr('备份文件包含记录、图片和设置。') }</p><div className="backup-actions"><button disabled={backupBusy} onClick={() => void backup()}><Download size={16}/>{tr('备份到文件') }</button><button disabled={backupBusy} onClick={() => void restore()}><Upload size={16}/>{tr('从文件恢复') }</button></div></>}
        {category === 'about' && <AboutSettings autoCheck={prefs.auto_check_updates} onAutoCheck={value => void save({ ...prefs, auto_check_updates: value })}/>}
      </main>
    </div>
    {notice && <div className="toast" role="status">{trNotice(notice)}<button title={tr('关闭提示')} onClick={() => setNotice('')}><X size={14}/></button></div>}
  </div>;
}
