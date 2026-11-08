import { dictionarySearchTerms } from '../lib/dictionary';
import { TokenDialog } from '../components/TokenDialog';
import { matchesSearch, searchTerms } from '../lib/segmentation';
import { ConfirmDialog } from '../components/ConfirmDialog';
import React from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ArrowDownUp, Clipboard, Code2, Copy, File, FileText, Heart, Image, List, Pencil, WholeWord, Pin, Search, Settings2, Trash2, X } from 'lucide-react';
import { Clip, ClipSort, TriggerEdge, PickerOpening, ActionShortcut, Preferences, Filter, PreviewClip } from '../types';
import { actionShortcutDefaults, defaults } from '../preferences';
import { normalizeShortcut, shortcutFromKey } from '../lib/shortcuts';
import { isCode, clipLabel, clipSummary, timeLabel } from '../lib/clips';
import { applyTheme } from '../lib/theme';
import { call } from '../lib/api';
import { AppIcon, ImageThumbnail } from '../components/ClipMedia';
import { ContentPreview } from '../components/ContentPreview';
import { setLanguage, tr, trNotice } from '../i18n';

const filters: { id: Filter; label: string; icon: React.ComponentType<{ size?: number }> }[] = [{ id: 'all', label: '全部', icon: List }, { id: 'text', label: '文本', icon: FileText }, { id: 'rich', label: '富文本', icon: Clipboard }, { id: 'image', label: '图片', icon: Image }, { id: 'files', label: '文件', icon: File }, { id: 'code', label: '代码', icon: Code2 }, { id: 'favorite', label: '收藏', icon: Heart }];
export function Picker() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [prefs, setPrefs] = useState<Preferences>(defaults);
  const [pickerEdge, setPickerEdge] = useState<TriggerEdge>('none');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<ClipSort>('created');
  const [sortOpen, setSortOpen] = useState(false);
  const [dictionaryRevision, setDictionaryRevision] = useState(0);
  const [dictionaryQuery, setDictionaryQuery] = useState<{ query: string; key: string; terms: string[] } | null>(null);
  const [tokenClip, setTokenClip] = useState<Clip | null>(null);
  const tokenOpenRef = useRef(false);
  tokenOpenRef.current = tokenClip !== null;
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editingClip, setEditingClip] = useState<Clip | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editError, setEditError] = useState('');
  const [windowPinned, setWindowPinned] = useState(false);
  const defaultFilterRef = useRef<Preferences['default_filter']>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewClip, setPreviewClip] = useState<PreviewClip | null>(null);
  const [showPositionKeys, setShowPositionKeys] = useState(false);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const menuActionRef = useRef<(id: number, action: string) => void>(() => {});
  const [notice, setNotice] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pickerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const closingAnimation = useRef<Animation | null>(null);
  const skipOpeningAnimation = useRef(false);
  const openingSequence = useRef(0);
  const edgeOpeningAnimation = useRef(false);
  const resizeDrag = useRef<{ edge: Exclude<TriggerEdge, 'none'>; start: number; cardSize: number; current: number; columns: number } | null>(null);
  const resizeQueue = useRef<{ requested: number | null; running: boolean }>({ requested: null, running: false });
  const [previewTop, setPreviewTop] = useState(0);
  const pastingRef = useRef(false);
  const refreshVersion = useRef(0);
  const removeClip = (id: number) => { refreshVersion.current += 1; setClips(items => items.filter(clip => clip.id !== id)); setSelectedId(current => current === id ? null : current); setPreviewId(current => current === id ? null : current); };
  const refresh = async () => { const version = ++refreshVersion.current; try { const [items, settings] = await Promise.all([call<Clip[]>('list_clips'), call<Preferences>('get_preferences')]); if (version !== refreshVersion.current) return; setClips(items); setPrefs(settings); setLanguage(settings.language); defaultFilterRef.current = settings.default_filter; applyTheme(settings.theme, settings.accent_color); } catch (e) { setNotice(`记录读取失败：${String(e)}`); } };
  useEffect(() => {
    void refresh();
    const focusSearch = () => {
      if (navigator.userAgent.includes('Windows')) return;
      requestAnimationFrame(() => {
        if (tokenOpenRef.current) return;
        const input = searchRef.current;
        if (!input) return;
        if (document.activeElement === input) input.blur();
        input.focus({ preventScroll: true });
      });
    };
    const offset = (edge: TriggerEdge) => ({ left: 'translateX(-100%)', right: 'translateX(100%)', top: 'translateY(-100%)', bottom: 'translateY(100%)', none: 'none' })[edge];
    let pendingOpenCleanup = () => {};
    const events = Promise.all([
      listen<{ phase: string; version?: string | null }>('update-status', event => { setUpdateAvailable(event.payload.phase === 'available' || event.payload.phase === 'ready' || event.payload.phase === 'error' && !!event.payload.version); if (event.payload.phase === 'available') setNotice('发现新版本，请到设置 → 关于更新'); }),
      listen('dictionary-changed', () => setDictionaryRevision(value => value + 1)),
      listen<{ deleted_id?: number } | null>('clips-changed', event => { if (typeof event.payload?.deleted_id === 'number') removeClip(event.payload.deleted_id); else void refresh(); }),
      listen<{ id: number; action: string }>('clip-menu-action', event => menuActionRef.current(event.payload.id, event.payload.action)),
      listen<PickerOpening>('picker-opening', event => {
        pendingOpenCleanup();
        const { edge, width, height } = event.payload;
        openingSequence.current += 1;
        edgeOpeningAnimation.current = edge !== 'none';
        closingAnimation.current?.cancel();
        closingAnimation.current = null;
        flushSync(() => {
          setPickerEdge(edge);
          setQuery(''); setFilter(defaultFilterRef.current); setSort('created'); setSortOpen(false); setEditingClip(null); setTokenClip(null); setDeleteId(null); setWindowPinned(false); setSelectedId(null); setPreviewId(null); setShowPositionKeys(false); setMenu(null);
        });
        const reveal = (animate: boolean) => {
          pendingOpenCleanup();
          skipOpeningAnimation.current = !animate;
          const picker = pickerRef.current;
          if (picker) {
            picker.getAnimations().forEach(animation => animation.cancel());
            const vertical = edge === 'top' || edge === 'bottom';
            picker.style.transform = animate && !vertical && edge !== 'none' ? offset(edge) : '';
            picker.style.clipPath = '';
            picker.style.opacity = animate && vertical ? '0' : '';
            void picker.getBoundingClientRect();
          }
          void call('reveal_picker', { edge }).catch(error => setNotice(`面板无法打开：${String(error)}`));
        };
        const ready = () => Math.abs(window.innerWidth - width) < 2 && Math.abs(window.innerHeight - height) < 2;
        const check = () => { if (ready()) reveal(true); };
        window.addEventListener('resize', check);
        const interval = window.setInterval(check, 16);
        const fallback = window.setTimeout(() => reveal(false), 800);
        pendingOpenCleanup = () => { window.removeEventListener('resize', check); window.clearInterval(interval); window.clearTimeout(fallback); pendingOpenCleanup = () => {}; };
        check();
      }),
      listen<TriggerEdge>('picker-opened', event => {
        const picker = pickerRef.current;
        const sequence = openingSequence.current;
        if (picker) {
          if (event.payload !== 'none' && !skipOpeningAnimation.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              if (sequence !== openingSequence.current || !picker.isConnected) return;
              const vertical = event.payload === 'top' || event.payload === 'bottom';
              const animation = vertical
                ? picker.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 190, easing: 'ease-out', fill: 'forwards' })
                : picker.animate([{ transform: offset(event.payload) }, { transform: 'translate(0)' }], { duration: 185, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'forwards' });
              animation.onfinish = () => { picker.style.transform = ''; picker.style.opacity = ''; animation.cancel(); edgeOpeningAnimation.current = false; focusSearch(); };
            }));
          } else {
            picker.style.transform = '';
            picker.style.clipPath = '';
            picker.style.opacity = '';
            edgeOpeningAnimation.current = false;
            focusSearch();
          }
        }
        skipOpeningAnimation.current = false;
      }),
      getCurrentWindow().onFocusChanged(event => { if (event.payload && !edgeOpeningAnimation.current) focusSearch(); }),
    ]);
    return () => { openingSequence.current += 1; pendingOpenCleanup(); void events.then(xs => xs.forEach(x => x())); };
  }, []);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(''), 3800); return () => clearTimeout(t); }, [notice]);
  const searchIndex = useMemo(() => clips.map(clip => ({ clip, text: `${clip.title} ${clip.plain_text} ${clip.source_app} ${clip.files.join(' ')}`.normalize('NFKC').toLocaleLowerCase(), modified: Date.parse(clip.updated_at) })), [clips]);
  const dictionaryKey = JSON.stringify([prefs.segment_builtin_dictionary, prefs.segment_custom_dictionary, prefs.segment_custom_words, dictionaryRevision]);
  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    const timer = window.setTimeout(() => { void dictionarySearchTerms(query).then(terms => { if (active) setDictionaryQuery({ query, key: dictionaryKey, terms }); }).catch(error => { if (active) setNotice(`${tr('搜索分词失败')}：${String(error)}`); }); }, 80);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, dictionaryKey]);
  const visible = useMemo(() => {
    const terms = dictionaryQuery?.query === query && dictionaryQuery.key === dictionaryKey ? dictionaryQuery.terms : searchTerms(query);
    const matches = searchIndex.filter(({ clip, text }) => (filter === 'all' || (filter === 'favorite' ? clip.favorite : filter === 'code' ? isCode(clip) : filter === 'text' ? clip.kind === 'text' && !isCode(clip) : clip.kind === filter)) && matchesSearch(text, query, terms));
    matches.sort((a, b) => Number(b.clip.pinned) - Number(a.clip.pinned) || (sort === 'used' ? b.clip.use_count - a.clip.use_count : sort === 'modified' ? b.modified - a.modified : b.clip.id - a.clip.id) || b.clip.id - a.clip.id);
    return matches.slice(0, 300).map(({ clip }) => clip);
  }, [searchIndex, filter, query, sort, dictionaryQuery, dictionaryKey]);
  const active = visible.find(c => c.id === selectedId) ?? visible[0] ?? null;
  const positionById = useMemo(() => new Map(visible.slice(0, 10).map((clip, index) => [clip.id, index === 9 ? 0 : index + 1])), [visible]);
  const showPreview = !tokenClip && pickerEdge === 'none' && (prefs.hover_preview || previewId !== null);
  const previewTargetId = showPreview ? (previewId ?? (prefs.hover_preview ? active?.id ?? null : null)) : null;
  useEffect(() => {
    if (pickerEdge === 'none' || previewId === null) { void call('hide_preview'); return; }
    const row = rowRefs.current[previewId]?.getBoundingClientRect();
    void call('show_preview', { id: previewId, edge: pickerEdge, anchorX: row ? row.left + row.width / 2 : window.innerWidth / 2, anchorY: row ? row.top + row.height / 2 : window.innerHeight / 2 }).catch(error => setNotice(`预览无法打开：${String(error)}`));
    return () => { void call('hide_preview'); };
  }, [pickerEdge, previewId]);

  useEffect(() => { if (pickerEdge === 'none' && !prefs.hover_preview) void getCurrentWindow().setSize(new LogicalSize(showPreview ? 650 : 350, 600)).catch(error => setNotice(`预览窗口无法调整：${String(error)}`)); }, [showPreview, prefs.hover_preview, pickerEdge]);
  useEffect(() => {
    if (previewTargetId === null) { setPreviewClip(null); return; }
    let current = true;
    setPreviewClip(null);
    void call<PreviewClip | null>('get_preview_clip', { id: previewTargetId }).then(clip => { if (current) setPreviewClip(clip); }).catch(error => { if (current) setNotice(`预览读取失败：${String(error)}`); });
    return () => { current = false; };
  }, [previewTargetId]);
  const alignPreview = () => {
    const row = previewTargetId === null ? null : rowRefs.current[previewTargetId];
    const preview = previewRef.current;
    const shell = pickerRef.current?.parentElement;
    if (!row || !preview || !shell) return;
    const shellBounds = shell.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const rowY = rowBounds.top + rowBounds.height / 2 - shellBounds.top;
    const height = preview.getBoundingClientRect().height;
    const top = Math.max(0, Math.min(rowY - 24, shellBounds.height - height));
    setPreviewTop(top);
  };
  useLayoutEffect(() => {
    if (!showPreview) return;
    alignPreview();
    const observer = new ResizeObserver(alignPreview);
    if (previewRef.current) observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [showPreview, previewTargetId, previewClip?.id]);
  useEffect(() => { if (selectedId !== null) rowRefs.current[selectedId]?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selectedId]);
  useEffect(() => {
    if (pickerEdge !== 'top' && pickerEdge !== 'bottom') return;
    const lists = pickerRef.current?.querySelectorAll<HTMLElement>('.result-list,.pinned-list');
    const scrollSideways = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      (event.currentTarget as HTMLElement).scrollLeft += event.deltaY;
    };
    lists?.forEach(list => list.addEventListener('wheel', scrollSideways, { passive: false }));
    return () => lists?.forEach(list => list.removeEventListener('wheel', scrollSideways));
  }, [pickerEdge, clips]);
  const action = async (name: string, args?: Record<string, unknown>, successNotice?: string) => { setMenu(null); try { setBusy(true); await call(name, args); if (name === 'delete_clip' && typeof args?.id === 'number') removeClip(args.id); else await refresh(); if (successNotice) setNotice(successNotice); } catch (e) { setNotice(`操作未完成：${String(e)}`); } finally { setBusy(false); } };
  const openEditor = (clip: Clip) => { if ((clip.kind !== 'text' && clip.kind !== 'rich') || clip.sensitive_masked) return; setEditingClip(clip); setEditDraft(clip.plain_text); setEditError(''); setPreviewId(null); if (navigator.userAgent.includes('Windows')) void call('set_picker_editing', { editing: true }); };
  const saveEdit = async () => { if (!editingClip || busy) return; if (!editDraft.trim()) { setEditError(tr('内容不能为空')); return; } try { setBusy(true); await call('edit_clip', { id: editingClip.id, content: editDraft }); setEditingClip(null); setEditError(''); await refresh(); } catch (error) { setEditError(String(error)); } finally { setBusy(false); } };
  const paste = async (clip: Clip, mode: 'default' | 'plain' | 'original' = 'default') => { if (pastingRef.current) return; pastingRef.current = true; setMenu(null); setPreviewId(null); try { setBusy(true); const command = mode === 'plain' ? 'paste_plain_clip' : mode === 'original' ? 'paste_original_clip' : 'paste_clip'; const result = await call<string>(command, { id: clip.id, edge: pickerEdge }); if (result === 'copied') setNotice(tr('已放入剪贴板，可手动粘贴')); if (result === 'pasted' && prefs.return_to_top_after_paste) { setSelectedId(null); pickerRef.current?.querySelectorAll<HTMLElement>('.result-list,.pinned-list').forEach(list => { list.scrollTop = 0; list.scrollLeft = 0; }); } } catch (e) { setNotice(`粘贴失败：${String(e)}`); } finally { setBusy(false); window.setTimeout(() => { pastingRef.current = false; }, 350); } };
  const openTokens = (clip: Clip) => { if ((clip.kind === 'text' || clip.kind === 'rich') && clip.plain_text.trim() && !clip.sensitive_masked) { setTokenClip(clip); setPreviewId(null); setShowPositionKeys(false); } };
  const submitFragment = async (text: string) => {
    if (!tokenClip || busy || pastingRef.current) return;
    pastingRef.current = true; setBusy(true);
    try {
      const result = await call<string>('paste_text_fragment', { id: tokenClip.id, text, edge: pickerEdge });
      if (result === 'copied') setNotice(tr('已放入剪贴板，可手动粘贴'));
      if (result === 'pasted' && prefs.return_to_top_after_paste) { setSelectedId(null); pickerRef.current?.querySelectorAll<HTMLElement>('.result-list,.pinned-list').forEach(list => { list.scrollTop = 0; list.scrollLeft = 0; }); }
      setTokenClip(null);
    } finally { setBusy(false); pastingRef.current = false; }
  };
  const closePicker = () => {
    if (pickerEdge === 'none' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !pickerRef.current) { void call('hide_picker'); return; }
    if (closingAnimation.current) return;
    const offset = { left: 'translateX(-100%)', right: 'translateX(100%)', top: 'translateY(-100%)', bottom: 'translateY(100%)' }[pickerEdge];
    const vertical = pickerEdge === 'top' || pickerEdge === 'bottom';
    const animation = vertical
      ? pickerRef.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-in', fill: 'forwards' })
      : pickerRef.current.animate([{ transform: 'translate(0)' }, { transform: offset }], { duration: 170, easing: 'cubic-bezier(.4,0,.8,.2)', fill: 'forwards' });
    closingAnimation.current = animation;
    animation.onfinish = () => { if (closingAnimation.current === animation) void call('hide_picker'); };
  };
  const onKeyDown = (e: React.KeyboardEvent) => { if (e.nativeEvent.isComposing) return; if (tokenClip) { if (e.key === 'Escape' && !busy) { e.preventDefault(); setTokenClip(null); } return; } if (editingClip || deleteId !== null) return; const positionModifier = navigator.userAgent.includes('Mac') ? e.metaKey : e.ctrlKey; const horizontal = pickerEdge === 'top' || pickerEdge === 'bottom'; if (positionModifier) setShowPositionKeys(true); if (positionModifier && !e.altKey && !e.shiftKey && /^Digit[0-9]$/.test(e.code)) { const digit = Number(e.code.slice(5)); const target = visible[digit === 0 ? 9 : digit - 1]; if (target) { e.preventDefault(); void paste(target); } return; } if (e.key === 'Escape') { e.preventDefault(); if (sortOpen) setSortOpen(false); else if (menu) setMenu(null); else closePicker(); return; } if (e.key === (horizontal ? 'ArrowRight' : 'ArrowDown') && visible.length && !(horizontal && e.target instanceof HTMLInputElement)) { e.preventDefault(); const i = visible.findIndex(c => c.id === active?.id); setSelectedId(visible[Math.min(i + 1, visible.length - 1)].id); setPreviewId(null); } if (e.key === (horizontal ? 'ArrowLeft' : 'ArrowUp') && visible.length && !(horizontal && e.target instanceof HTMLInputElement)) { e.preventDefault(); const i = visible.findIndex(c => c.id === active?.id); setSelectedId(visible[Math.max(0, i - 1)].id); setPreviewId(null); } if (active && !(e.target instanceof HTMLSelectElement)) { const chord = shortcutFromKey(e, true); const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement; const matched = (Object.entries(prefs.action_shortcuts || actionShortcutDefaults) as [ActionShortcut, string][]).find(([, value]) => value && normalizeShortcut(value) === normalizeShortcut(chord || '')); if (matched && (!typing || e.metaKey || e.ctrlKey || e.altKey || (matched[0] === 'paste' && chord === 'Enter')) ) { e.preventDefault(); menuActionRef.current(active.id, matched[0]); return; } } if ((e.key === 'F10' && e.shiftKey || e.key === 'ContextMenu') && active) { e.preventDefault(); const bounds = rowRefs.current[active.id]?.getBoundingClientRect(); if (bounds) void call('show_clip_context_menu', { id: active.id, x: bounds.left + 20, y: bounds.bottom, edge: pickerEdge }).catch(error => setNotice(`菜单无法打开：${String(error)}`)); } };
  const openMenu = (e: React.MouseEvent, clip: Clip) => { e.preventDefault(); setSelectedId(clip.id); setPreviewId(null); void call('show_clip_context_menu', { id: clip.id, x: e.clientX, y: e.clientY, edge: pickerEdge }).catch(error => setNotice(`菜单无法打开：${String(error)}`)); };
  menuActionRef.current = (id, choice) => {
    const clip = clips.find(item => item.id === id);
    if (!clip) return;
    switch (choice) {
      case 'paste': void paste(clip); break;
      case 'paste_plain': if (clip.kind === 'rich' || clip.kind === 'files') void paste(clip, 'plain'); break;
      case 'paste_original': void paste(clip, 'original'); break;
      case 'copy': void action('copy_clip', { id }); break;
      case 'copy_plain': if (clip.kind === 'rich' || clip.kind === 'files') void action('copy_plain_clip', { id }); break;
      case 'copy_original': void action('copy_original_clip', { id }); break;
      case 'preview': setPreviewId(current => current === id ? null : id); break;
      case 'edit': openEditor(clip); break;
      case 'segment': openTokens(clip); break;
      case 'favorite': void action('toggle_favorite', { id }); break;
      case 'pin': void action('toggle_pin', { id }); break;
      case 'delete': setDeleteId(id); break;
    }
  };
  useEffect(() => {
    const captureSpace = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const search = target === searchRef.current;
      if (search && query.trim()) return;
      if (!search && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) return;
      if (target.closest('button:not(.result-row)')) return;
      event.preventDefault();
      if ((search || !pickerRef.current?.contains(target)) && active && normalizeShortcut(prefs.action_shortcuts?.preview || '') === 'space') {
        event.stopImmediatePropagation();
        menuActionRef.current(active.id, 'preview');
      }
    };
    window.addEventListener('keydown', captureSpace, true);
    return () => window.removeEventListener('keydown', captureSpace, true);
  }, [active?.id, query, prefs.action_shortcuts?.preview]);
  const pinnedVisible = visible.filter(c => c.pinned);
  const regularVisible = visible.filter(c => !c.pinned);
  const renderRow = (c: Clip) => <div className="result-item" key={c.id} onMouseEnter={() => { if (pickerEdge === 'none' && prefs.hover_preview && !menu) setPreviewId(c.id); }} onMouseLeave={() => { if (pickerEdge === 'none' && prefs.hover_preview) setPreviewId(null); }}>
    <button ref={el => { rowRefs.current[c.id] = el; }} className={`result-row ${active?.id === c.id ? 'selected' : ''} ${c.kind === 'image' ? 'image-row' : 'text-row'}`} onClick={() => { setSelectedId(c.id); setPreviewId(null); if (prefs.paste_on_single_click) void paste(c); }} onContextMenu={e => openMenu(e, c)} onDoubleClick={() => { if (!prefs.paste_on_single_click) void paste(c); }}>
      <span className="format-heading">{prefs.show_source_app_icon && pickerEdge === 'none' && <AppIcon clip={c}/>}<span className="format-label">{clipLabel(c)}</span>{c.favorite && <Heart size={13} fill="currentColor"/>}</span>
      {prefs.show_source_app_icon && pickerEdge !== 'none' && <AppIcon clip={c}/>}{showPositionKeys && positionById.has(c.id) && <span className="position-key" aria-label={`快捷键 ${positionById.get(c.id)}`}>{positionById.get(c.id)}</span>}
      {c.kind === 'image' ? <ImageThumbnail clip={c}/> : <span className="result-text"><span className="result-summary">{clipSummary(c)}</span><span className="result-bottom">{c.favorite && <Heart size={13} fill="currentColor"/>}<span className="format-label">{clipLabel(c)}</span></span></span>}
    </button>
    <div className="row-actions" role="group" aria-label={tr('记录操作')} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
      {(c.kind === 'text' || c.kind === 'rich') && c.plain_text.trim() && !c.sensitive_masked && <button type="button" title={tr('分词')} aria-label={tr('分词')} disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => openTokens(c)}><WholeWord size={16}/></button>}
      {(c.kind === 'text' || c.kind === 'rich') && !c.sensitive_masked && <button type="button" title={tr('编辑内容')} aria-label={tr('编辑内容')} disabled={busy} onClick={() => openEditor(c)}><Pencil size={16}/></button>}
      <button type="button" title={tr(c.pinned ? '取消置顶' : '置顶')} aria-label={tr(c.pinned ? '取消置顶' : '置顶')} aria-pressed={c.pinned} disabled={busy} className={c.pinned ? 'is-active' : ''} onClick={() => void action('toggle_pin', { id: c.id })}><Pin size={16} fill={c.pinned ? 'currentColor' : 'none'}/></button>
      <button type="button" title={tr(c.favorite ? '取消收藏' : '收藏')} aria-label={tr(c.favorite ? '取消收藏' : '收藏')} aria-pressed={c.favorite} disabled={busy} className={c.favorite ? 'is-active' : ''} onClick={() => void action('toggle_favorite', { id: c.id })}><Heart size={16} fill={c.favorite ? 'currentColor' : 'none'}/></button>
      <button type="button" title={tr('复制')} aria-label={tr('复制')} disabled={busy} onClick={() => void action('copy_clip', { id: c.id }, tr('已复制'))}><Copy size={16}/></button>
      <button type="button" title={tr('删除')} aria-label={tr('删除')} disabled={busy} className="danger" onClick={() => setDeleteId(c.id)}><Trash2 size={16}/></button>
    </div>
    <span className="row-time">{timeLabel(c.created_at)}</span>
  </div>;
  const queueResize = (edge: Exclude<TriggerEdge, 'none'>, size: number) => {
    const queue = resizeQueue.current;
    queue.requested = size;
    if (queue.running) return;
    queue.running = true;
    void (async () => {
      try {
        while (queue.requested !== null) {
          const next = queue.requested;
          queue.requested = null;
          await call('resize_edge_picker', { edge, cardSize: next });
        }
      } catch (error) { setNotice(`面板尺寸调整失败：${String(error)}`); }
      finally { queue.running = false; }
    })();
  };
  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pickerEdge === 'none') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeDrag.current = { edge: pickerEdge, start: pickerEdge === 'left' || pickerEdge === 'right' ? event.screenX : event.screenY, cardSize: prefs.edge_card_size, current: prefs.edge_card_size, columns: prefs.side_columns };
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current;
    if (!drag) return;
    event.preventDefault();
    const current = drag.edge === 'left' || drag.edge === 'right' ? event.screenX : event.screenY;
    const sign = drag.edge === 'left' || drag.edge === 'top' ? 1 : -1;
    const divisor = drag.edge === 'left' || drag.edge === 'right' ? drag.columns : 1;
    const size = Math.max(120, Math.min(360, Math.round(drag.cardSize + sign * (current - drag.start) / divisor)));
    if (size === drag.current) return;
    drag.current = size;
    const shell = pickerRef.current?.parentElement;
    shell?.style.setProperty('--edge-app-icon-size', `${Math.max(18, Math.min(38, Math.round(size * 0.135)))}px`);
    shell?.style.setProperty('--edge-app-glyph-size', `${Math.max(12, Math.min(23, Math.round(size * 0.08)))}px`);
    shell?.style.setProperty('--pinned-width', `${pinnedVisible.length * (size + 7) + 8}px`);
    queueResize(drag.edge, size);
  };
  const endResize = () => {
    const drag = resizeDrag.current;
    if (!drag) return;
    resizeDrag.current = null;
    if (drag.current !== drag.cardSize) {
      const next = { ...prefs, edge_card_size: drag.current };
      setPrefs(next);
      void call('save_preferences', { preferences: next }).catch(error => setNotice(`面板尺寸未保存：${String(error)}`));
    }
  };
  const isHorizontal = pickerEdge === 'top' || pickerEdge === 'bottom';
  const displayedCardSize = resizeDrag.current?.current ?? prefs.edge_card_size;
  const edgeStyle = { '--edge-app-icon-size': `${Math.max(18, Math.min(38, Math.round(displayedCardSize * 0.135))) + 2}px`, '--edge-app-glyph-size': `${Math.max(12, Math.min(23, Math.round(displayedCardSize * 0.08))) + 2}px`, '--pinned-width': `${pinnedVisible.length * (displayedCardSize + 7) + 8}px`, '--thumbnail-max-height': `${pickerEdge === 'none' ? 100 : Math.max(40, displayedCardSize - 18 - (prefs.show_source_app_icon ? Math.max(18, Math.min(38, Math.round(displayedCardSize * 0.135))) + 10 : 0))}px`, '--item-max-lines': prefs.item_max_lines } as React.CSSProperties;
  const searchBox = <div className="search-box"><Search size={19}/><input ref={searchRef} aria-label={tr('搜索剪贴板记录')} placeholder={tr('搜索')} value={query} onMouseDown={e => { if (!navigator.userAgent.includes('Windows')) return; e.preventDefault(); void call('set_picker_editing', { editing: true }).then(() => searchRef.current?.focus()); }} onBlur={() => { if (navigator.userAgent.includes('Windows')) void call('set_picker_editing', { editing: false }); }} onChange={e => { setQuery(e.target.value); setSelectedId(null); setPreviewId(null); }}/>{query && <button title={tr('清除搜索')} onClick={() => setQuery('')}><X size={15}/></button>}</div>;
  const sortLabels: Record<ClipSort, string> = { created: '创建时间', used: '使用频率', modified: '修改时间' };
  const sortControl = <div className="sort-control-wrap"><button type="button" className="sort-control" title={`${tr('记录排序')}：${tr(sortLabels[sort])}`} aria-label={`${tr('记录排序')}：${tr(sortLabels[sort])}`} aria-haspopup="menu" aria-expanded={sortOpen} onClick={() => setSortOpen(open => !open)}><ArrowDownUp size={14}/></button>{sortOpen && <div className="sort-menu" role="menu" aria-label={tr('记录排序')}>{(Object.keys(sortLabels) as ClipSort[]).map(key => <button key={key} type="button" role="menuitemradio" aria-checked={sort === key} onClick={() => { setSort(key); setSortOpen(false); setSelectedId(null); }}>{tr(sortLabels[key])}</button>)}</div>}</div>;
  const pinWindowButton = <button className={`header-icon window-pin ${windowPinned ? 'is-active' : ''}`} title={tr(windowPinned ? '取消窗口置顶' : '窗口置顶')} aria-label={tr(windowPinned ? '取消窗口置顶' : '窗口置顶')} aria-pressed={windowPinned} onClick={() => void call<boolean>('set_picker_pinned', { pinned: !windowPinned }).then(setWindowPinned).catch(error => setNotice(`窗口置顶失败：${String(error)}`))}><Pin size={17} fill={windowPinned ? 'currentColor' : 'none'}/></button>;
  const settingsButton = <button className="header-icon update-settings-button" aria-label={tr(updateAvailable ? '发现新版本，请到设置 → 关于更新' : '打开设置')} title={tr(updateAvailable ? '发现新版本，请到设置 → 关于更新' : '打开设置')} onClick={() => void call('open_settings').catch(e => setNotice(`设置无法打开：${String(e)}`))}><Settings2 size={19}/>{updateAvailable && <span className="update-dot" aria-hidden="true"/>}</button>;
  return <div className={`picker-shell edge-${pickerEdge} side-columns-${prefs.side_columns} ${showPreview ? 'with-preview' : ''}`} style={edgeStyle}><div ref={pickerRef} className="picker" onScrollCapture={alignPreview} onKeyDown={onKeyDown} onKeyUp={e => { if (e.key === 'Meta' || e.key === 'Control') setShowPositionKeys(false); }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setShowPositionKeys(false); }} onClick={e => { if (menu) setMenu(null); if (sortOpen && !(e.target as HTMLElement).closest('.sort-control-wrap')) setSortOpen(false); if (!(e.target as HTMLElement).closest('.result-row,.context-menu')) setPreviewId(null); }}>
    {!isHorizontal && <header className="picker-header">{searchBox}{pinWindowButton}{settingsButton}</header>}
    <div className="filter-bar"><div className="filter-scroll">{filters.map(f => <button key={f.id} className={filter === f.id ? 'chosen' : ''} title={tr(f.label)} aria-label={tr(f.label)} aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setSelectedId(null); setPreviewId(null); }}><f.icon size={14}/></button>)}</div>{isHorizontal && <>{pinWindowButton}{settingsButton}{searchBox}</>}{sortControl}</div>
    <div className="picker-body"><div className="picker-results">
      {pinnedVisible.length > 0 && <div className="pinned-list" aria-label={tr('置顶记录')} style={isHorizontal ? { width: 'var(--pinned-width)' } : undefined}>{pinnedVisible.map(renderRow)}</div>}
      <div className="result-list">{regularVisible.map(renderRow)}{visible.length === 0 && <div className="empty-state"><Search size={24}/><strong>{tr(query ? '没有匹配的记录' : '还没有记录')}</strong><span>{tr(query ? '换个关键词或类型试试' : '复制内容后会显示在这里')}</span></div>}</div>
    </div></div>

    {tokenClip && <TokenDialog key={tokenClip.id} clip={tokenClip} dictionaryKey={dictionaryKey} busy={busy} onClose={() => setTokenClip(null)} onSubmit={submitFragment}/>}
    {deleteId !== null && <ConfirmDialog title={tr('删除记录')} description={tr('删除这条记录？删除后无法恢复。')} confirmLabel={tr('删除')} busy={busy} onCancel={() => setDeleteId(null)} onConfirm={() => { const id = deleteId; setDeleteId(null); void action('delete_clip', { id }); }}/>}
    {editingClip && <div className="clip-edit-backdrop" onClick={event => event.stopPropagation()}><div className="clip-edit-dialog" role="dialog" aria-modal="true" aria-label={tr('编辑内容')} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); setEditingClip(null); } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void saveEdit(); } }}><h2>{tr('编辑内容')}</h2>{editingClip.kind === 'rich' && <p className="clip-edit-help">{tr('保存后转为纯文本，原格式会丢失。')}</p>}<textarea autoFocus aria-label={tr('记录内容')} value={editDraft} onChange={event => { setEditDraft(event.target.value); setEditError(''); }} onMouseDown={() => { if (navigator.userAgent.includes('Windows')) void call('set_picker_editing', { editing: true }); }}/>{editError && <p className="clip-edit-error" role="alert">{tr(editError)}</p>}<div className="clip-edit-actions"><button type="button" onClick={() => setEditingClip(null)}>{tr('取消')}</button><button type="button" className="primary" disabled={busy} onClick={() => void saveEdit()}>{tr('保存')}</button></div></div></div>}

    {pickerEdge !== 'none' && <div className={`resize-edge resize-${pickerEdge}`} role="separator" aria-label={tr('拖动面板边缘调整大小')} onPointerDown={beginResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize}/>}
    {notice && <div className="toast" role="status">{trNotice(notice)}<button title={tr('关闭提示')} onClick={() => setNotice('')}><X size={14}/></button></div>}
  </div>{showPreview && <aside ref={previewRef} className="side-preview" style={{ top: previewTop }} aria-label={tr('内容预览')}>{previewClip ? <ContentPreview key={previewClip.id} clip={previewClip}/> : <div className="detail-empty">{tr(previewTargetId === null ? '选择记录以预览内容' : '预览加载中')}</div>}</aside>}</div>;
}
