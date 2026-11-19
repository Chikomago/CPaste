import {WindowActivity} from '../lib/window-activity';
import { useScriptRules } from '../lib/use-script-rules';
import type { ScriptRule } from '../lib/js-rules';
import { toolHistoryAction } from '../lib/history-shortcuts';
import { patchClipContent, type ClipContentPatch } from '../lib/clip-content';
import type { RegexRule } from '../lib/regex-transform';
import { MediaQuickTools,mediaHistoryAction,applyMediaScript } from '../components/MediaQuickTools';
import {thumbnailCache,resetImageCaches} from '../lib/clip-images';
import { QuickActionsPanel } from '../components/QuickActionsPanel';
import { applyTextTool } from '../lib/text-tools';
import { ClipFlagMutations, patchClipFlags, type ClipFlagPatch } from '../lib/clip-flags';
import { dictionarySearchTerms } from '../lib/dictionary';
import type { ToolDocument } from '../lib/text-tools';
import { ClipEditor } from '../components/ClipEditor';
import { TokenDialog } from '../components/TokenDialog';
import { matchesSearch, searchTerms } from '../lib/segmentation';
import { ConfirmDialog } from '../components/ConfirmDialog';
import React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Workflow, ArrowDownUp, Clipboard, Code2, Copy, Download, Eye, File, FileText, FolderOpen, Heart, Image, List, Pencil, WholeWord, Pin, AppWindow, PanelRightOpen, PanelRightClose, Search, Settings2, Trash2, X } from 'lucide-react';
import { Clip, ClipSort, TriggerEdge, PickerOpening, ActionShortcut, Preferences, Filter, PreviewClip } from '../types';
import { actionShortcutDefaults, defaults } from '../preferences';
import { compactShortcut, displayShortcut, normalizeShortcut, shortcutFromKey } from '../lib/shortcuts';
import { isCode, clipLabel, clipSummary, timeLabel } from '../lib/clips';
import { animationsEnabled, animateSurface, applyTheme } from '../lib/theme';
import { call } from '../lib/api';
import { AppIcon, ImageThumbnail, resetAppIconCache } from '../components/ClipMedia';
import { VirtualClipList } from '../components/VirtualClipList';
import { ClipDetails } from '../components/ClipDetails';
import { setLanguage, tr, trNotice } from '../i18n';

type MenuEntry = { action: string; label: string; icon: React.ComponentType<{ size?: number }>; shortcut?: string; danger?: boolean };
const filters: { id: Filter; label: string; icon: React.ComponentType<{ size?: number }> }[] = [{ id: 'all', label: '全部', icon: List }, { id: 'text', label: '文本', icon: FileText }, { id: 'rich', label: '富文本', icon: Clipboard }, { id: 'image', label: '图片', icon: Image }, { id: 'files', label: '文件', icon: File }, { id: 'code', label: '代码', icon: Code2 }, { id: 'favorite', label: '收藏', icon: Heart }];
export function Picker() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [prefs, setPrefs] = useState<Preferences>(defaults);
  const [pickerEdge, setPickerEdge] = useState<TriggerEdge>('none');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<ClipSort>('created');
  const [sortOpen, setSortOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dictionaryRevision, setDictionaryRevision] = useState(0);
  const [dictionaryQuery, setDictionaryQuery] = useState<{ query: string; key: string; terms: string[] } | null>(null);
  const [tokenClip, setTokenClip] = useState<Clip | null>(null);
  const inputModeOpenRef = useRef(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editingClip, setEditingClip] = useState<Clip | null>(null);
  const [sidebarEditingClip, setSidebarEditingClip] = useState<Clip | null>(null);
  const [sidebarTokenClip, setSidebarTokenClip] = useState<Clip | null>(null);
  const {rules:rowRules,ready:rowRulesReady}=useScriptRules();
  const pendingRules=useRef<{clip:Clip;rules:ScriptRule[]} | null>(null);
  useEffect(() => {
    document.body.classList.add('picker-body-root');
    return () => document.body.classList.remove('picker-body-root');
  }, []);
  useEffect(()=>{
    const close=(event:PointerEvent)=>{if(!(event.target as HTMLElement).closest('[data-row-rules]'))void call('hide_rule_menu');};
    document.addEventListener('pointerdown',close);
    return()=>document.removeEventListener('pointerdown',close);
  },[]);

  const [sidebarToolsClip, setSidebarToolsClip] = useState<Clip | null>(null);
  inputModeOpenRef.current = tokenClip !== null || editingClip !== null || sidebarOpen && (sidebarEditingClip !== null || sidebarTokenClip !== null || sidebarToolsClip !== null);
  const [toolHistory, setToolHistory] = useState<{id:number; before:ToolDocument; after:ToolDocument}[]>([]);
  const [toolRedo, setToolRedo] = useState<typeof toolHistory>([]);
  const toolMutation = useRef(false);
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
  const [clearScope,setClearScope]=useState<{ids:number[]}|null>(null);
  const [clearError,setClearError]=useState('');
  const [transferBusy,setTransferBusy]=useState(false);
  const transferPending=useRef(false);
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
  const scrollingUntil = useRef(0);
  const alignFrame = useRef(0);
  const pastingRef = useRef(false);
  const refreshVersion = useRef(0);
  const refreshNow=useRef<()=>void>(()=>{});
  const dictionaryDirty=useRef(false);
  const imageRevisions=useRef(new Map<number,{revision:string;image_size?:number;image_format?:string}>());
  const activity=useRef<WindowActivity|null>(null);
  if(!activity.current)activity.current=new WindowActivity(()=>refreshNow.current(),dormant=>{document.documentElement.dataset.pickerDormant=String(dormant);});
  const removeClips = (ids:number[]) => {
    const removed=new Set(ids);refreshVersion.current+=1;
    setToolHistory(items=>items.filter(item=>!removed.has(item.id)));setToolRedo(items=>items.filter(item=>!removed.has(item.id)));
    setClips(items=>items.filter(clip=>!removed.has(clip.id)));
    setSelectedId(current=>current!==null&&removed.has(current)?null:current);setPreviewId(current=>current!==null&&removed.has(current)?null:current);
    setSidebarToolsClip(current=>current&&removed.has(current.id)?null:current);
    ids.forEach(id=>{thumbnailCache.invalidate(id);imageRevisions.current.delete(id);});
  };
  const removeClip=(id:number)=>removeClips([id]);
  const receiveContent = (patch: ClipContentPatch) => {
    refreshVersion.current += 1;
    setClips(items => patchClipContent(items,patch));
    setSidebarToolsClip(current => current ? patchClipContent([current],patch)[0] : null);
  };
  const flagMutations = useMemo(() => new ClipFlagMutations(patch => {
    refreshVersion.current += 1;
    setClips(items => patchClipFlags(items, patch));
  }, (command, id) => call<boolean>(command, { id })), []);
  const refresh = async () => { const version = ++refreshVersion.current; try { const [items, settings] = await Promise.all([call<Clip[]>('list_clips'), call<Preferences>('get_preferences')]); if (version !== refreshVersion.current) return; activity.current?.setEnabled(settings.lightweight_mode); if(version!==refreshVersion.current||activity.current?.deferWork())return; setClips(flagMutations.overlay(items).map(clip=>{const patch=imageRevisions.current.get(clip.id);return patch&&Math.floor(Date.parse(clip.updated_at)/1000)===Math.floor(Date.parse(patch.revision)/1000)?{...clip,updated_at:patch.revision,image_size:patch.image_size??clip.image_size,image_format:patch.image_format??clip.image_format}:clip;})); setPrefs(settings); setLanguage(settings.language); defaultFilterRef.current = settings.default_filter; applyTheme(settings.theme, settings.accent_color, settings.disable_animations); } catch (e) { setNotice(`记录读取失败：${String(e)}`); } };
  refreshNow.current=()=>{if(dictionaryDirty.current){dictionaryDirty.current=false;setDictionaryRevision(value=>value+1);}void refresh();};
  useEffect(() => {
    let live=true;
    void getCurrentWindow().isVisible().then(visible=>{if(live&&visible===false)activity.current?.hide();});
    void refresh();
    const focusSearch = () => {
      if (navigator.userAgent.includes('Windows')) return;
      requestAnimationFrame(() => {
        if (inputModeOpenRef.current) return;
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
      listen<{id:number;revision:string;image_size?:number;image_format?:string}>('image-content-changed', event => { refreshVersion.current += 1; imageRevisions.current.set(event.payload.id,event.payload);thumbnailCache.invalidate(event.payload.id);if(activity.current?.deferWork())return; setClips(items=>items.map(clip=>clip.id===event.payload.id?{...clip,updated_at:event.payload.revision,image_size:event.payload.image_size??clip.image_size,image_format:event.payload.image_format??clip.image_format}:clip)); }),
      listen('dictionary-changed', () => {if(activity.current?.deferWork()){dictionaryDirty.current=true;return;}setDictionaryRevision(value => value + 1);}),
      listen<{kind:string}>('media-cache-cleared', event=>{const kind=event.payload.kind;if(kind==='icons')resetAppIconCache();else if(kind==='thumbnails')thumbnailCache.clear();else if(kind==='originals')resetImageCaches();if(!activity.current?.deferWork())setClips(items=>[...items]);}),
      listen<(Partial<ClipFlagPatch & ClipContentPatch> & { deleted_id?: number;deleted_ids?:number[];reset?:boolean;use_count?:number }) | null>('clips-changed', event => { const patch = event.payload; if(activity.current?.deferWork()){refreshVersion.current+=1;if(patch?.reset){resetImageCaches();imageRevisions.current.clear();}return;} if(patch?.reset){resetImageCaches();imageRevisions.current.clear();void refresh();return;} if(Array.isArray(patch?.deleted_ids)){removeClips(patch.deleted_ids);return;} if(typeof patch?.updated_id==='number'&&typeof patch.use_count==='number'){refreshVersion.current+=1;setClips(items=>items.map(clip=>clip.id===patch.updated_id?{...clip,use_count:patch.use_count!}:clip));return;} if (typeof patch?.deleted_id === 'number') removeClip(patch.deleted_id); else if (typeof patch?.updated_id === 'number' && typeof patch.plain_text === 'string') receiveContent(patch as ClipContentPatch); else if (typeof patch?.updated_id === 'number' && (typeof patch.pinned === 'boolean' || typeof patch.favorite === 'boolean')) flagMutations.receive(patch as ClipFlagPatch); else void refresh(); }),
      listen<{ id: number; action: string }>('clip-menu-action', event => menuActionRef.current(event.payload.id, event.payload.action)),
      listen('picker-hidden',()=>activity.current?.hide()),
      listen('preferences-changed',()=>{void call<Preferences>('get_preferences').then(settings=>{setPrefs(settings);setLanguage(settings.language);applyTheme(settings.theme,settings.accent_color,settings.disable_animations);activity.current?.setEnabled(settings.lightweight_mode);});}),
      listen<PickerOpening>('picker-opening', event => {
        activity.current?.show();
        pendingOpenCleanup();
        const { edge, width, height, sidebar_open } = event.payload;
        detailsGeometry.current = { edge, expanded: sidebar_open };
        openingSequence.current += 1;
        edgeOpeningAnimation.current = edge !== 'none';
        closingAnimation.current?.cancel();
        closingAnimation.current = null;
        flushSync(() => {
          setPickerEdge(edge);
          setQuery(''); setFilter(defaultFilterRef.current); setSort('created'); setSortOpen(false); setSidebarOpen(sidebar_open); setEditingClip(null); setTokenClip(null); setSidebarEditingClip(null); setSidebarTokenClip(null); setSidebarToolsClip(null); setDeleteId(null); setClearScope(null); setClearError(''); setWindowPinned(false); setSelectedId(null); setPreviewId(null); setShowPositionKeys(false); setMenu(null);
        });
        const reveal = (animate: boolean) => {
          animate = animate && animationsEnabled();
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
        activity.current?.show();
        const picker = pickerRef.current;
        const sequence = openingSequence.current;
        if(event.payload==='none')animateSurface(picker);
        if (picker) {
          if (event.payload !== 'none' && !skipOpeningAnimation.current && animationsEnabled()) {
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
    return () => { live=false;activity.current?.dispose();delete document.documentElement.dataset.pickerDormant; openingSequence.current += 1; pendingOpenCleanup(); void events.then(xs => xs.forEach(x => x())); };
  }, []);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(''), 3800); return () => clearTimeout(t); }, [notice]);
  const searchIndex = useMemo(() => clips.map(clip => ({ clip, text: `${clip.title} ${clip.plain_text} ${clip.source_app} ${clip.files.join(' ')}`.normalize('NFKC').toLocaleLowerCase(), modified: Date.parse(clip.updated_at) })), [clips]);
  const dictionaryKey = JSON.stringify([prefs.segment_builtin_dictionary, prefs.segment_custom_dictionary, prefs.segment_custom_words, dictionaryRevision]);
  useEffect(() => {
    if (!query.trim() || activity.current?.isDormant()) return;
    let active = true;
    const timer = window.setTimeout(() => { void dictionarySearchTerms(query).then(terms => { if (active) setDictionaryQuery({ query, key: dictionaryKey, terms }); }).catch(error => { if (active) setNotice(`${tr('搜索分词失败')}：${String(error)}`); }); }, 80);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, dictionaryKey]);
  const matchedClips = useMemo(() => {
    const terms = dictionaryQuery?.query === query && dictionaryQuery.key === dictionaryKey ? dictionaryQuery.terms : searchTerms(query);
    const matches = searchIndex.filter(({ clip, text }) => (filter === 'all' || (filter === 'favorite' ? clip.favorite : filter === 'code' ? isCode(clip) : filter === 'text' ? clip.kind === 'text' && !isCode(clip) : clip.kind === filter)) && matchesSearch(text, query, terms));
    matches.sort((a, b) => Number(b.clip.pinned) - Number(a.clip.pinned) || (sort === 'used' ? b.clip.use_count - a.clip.use_count : sort === 'modified' ? b.modified - a.modified : b.clip.id - a.clip.id) || b.clip.id - a.clip.id);
    return matches.map(({ clip }) => clip);
  }, [searchIndex, filter, query, sort, dictionaryQuery, dictionaryKey]);
  const visible=useMemo(()=>matchedClips.slice(0,300),[matchedClips]);
  const active = visible.find(c => c.id === selectedId) ?? visible[0] ?? null;
  const [viewportIds,setViewportIds]=useState<{pinned:number[];regular:number[]}>({pinned:[],regular:[]});
  const updateViewport=useCallback((key:'pinned'|'regular',ids:number[])=>setViewportIds(current=>current[key].length===ids.length&&current[key].every((id,index)=>id===ids[index])?current:{...current,[key]:ids}),[]);
  const pinnedViewport=useCallback((ids:number[])=>updateViewport('pinned',ids),[updateViewport]);
  const regularViewport=useCallback((ids:number[])=>updateViewport('regular',ids),[updateViewport]);
  const positionClips=useMemo(()=>[...viewportIds.pinned,...viewportIds.regular].map(id=>visible.find(clip=>clip.id===id)).filter((clip):clip is Clip=>!!clip).slice(0,10),[viewportIds,visible]);
  const positionById = useMemo(() => new Map(positionClips.map((clip,index)=>[clip.id,index===9?0:index+1])),[positionClips]);
  const detailsActive = sidebarOpen && !tokenClip && !editingClip;
  // The in-window sidebar is now reserved for the expanded details/editor view.
  // Hover previews live in a separate native window, so the picker webview no
  // longer grows to 650px or paints a backing panel behind the preview card.
  const showPreview = detailsActive;
  const previewTargetId = showPreview ? active?.id ?? null : null;
  const floatingPreviewId = !detailsActive && !tokenClip && !editingClip && deleteId === null
    ? previewId ?? (pickerEdge === 'none' && prefs.hover_preview ? active?.id ?? null : null)
    : null;
  useEffect(() => {
    if (floatingPreviewId === null) { void call('hide_preview'); return; }
    const row = rowRefs.current[floatingPreviewId]?.getBoundingClientRect();
    void call('show_preview', { id: floatingPreviewId, edge: pickerEdge, anchorX: row ? row.left + row.width / 2 : window.innerWidth / 2, anchorY: row ? row.top + row.height / 2 : window.innerHeight / 2 }).catch(error => setNotice(`预览无法打开：${String(error)}`));
  }, [pickerEdge, floatingPreviewId, detailsActive, tokenClip, editingClip, deleteId]);

  const detailsGeometry = useRef<{ edge: TriggerEdge; expanded: boolean }>({ edge: 'none', expanded: false });
  useEffect(() => {
    const previous = detailsGeometry.current;
    if (previous.edge !== pickerEdge) { previous.edge = pickerEdge; previous.expanded = false; }
    if (pickerEdge === 'none' || previous.expanded === detailsActive) return;
    previous.expanded = detailsActive;
    void call('resize_edge_picker', { edge: pickerEdge, cardSize: prefs.edge_card_size, details: detailsActive }).catch(error => setNotice(`面板尺寸调整失败：${String(error)}`));
  }, [pickerEdge, detailsActive, prefs.edge_card_size]);
  useLayoutEffect(() => {
    if (pickerEdge !== 'none') return;
    const width = detailsActive ? 650 : 350;
    if (Math.abs(window.innerWidth - width) < 1 && Math.abs(window.innerHeight - 600) < 1) return;
    void getCurrentWindow().setSize(new LogicalSize(width, 600)).catch(error => setNotice(`预览窗口无法调整：${String(error)}`));
  }, [detailsActive, pickerEdge]);
  const previewKnown = clips.find(clip => clip.id === previewTargetId);
  useEffect(() => {
    if (previewTargetId === null || previewKnown?.kind !== 'files') return;
    let current = true;

    void call<PreviewClip | null>('get_preview_clip', { id: previewTargetId }).then(clip => { if (current) setPreviewClip(clip); }).catch(error => { if (current) setNotice(`预览读取失败：${String(error)}`); });
    return () => { current = false; };
  }, [previewTargetId, previewKnown?.kind, previewKnown?.files]);
  const displayedPreview = useMemo(() => {
    const known = clips.find(clip => clip.id === previewTargetId);
    if (previewClip?.id === previewTargetId && known) return { ...previewClip, ...known, file_sizes: known.files.map((file, index) => previewClip.files[index] === file ? previewClip.file_sizes[index] ?? null : null) };
    return known ? { ...known, file_sizes: known.files.map(() => null) } : null;
  }, [previewClip, previewTargetId, clips]);
  // Write the preview offset straight to the DOM: setState here used to
  // re-render the whole picker (and the virtual list) on every scroll frame,
  // which is why wheel events were intermittently dropped on Windows.
  const alignPreview = () => {
    const preview = previewRef.current;
    if (!preview) return;
    if (detailsActive) { preview.style.top = '0px'; return; }
    const row = previewTargetId === null ? null : rowRefs.current[previewTargetId];
    const shell = pickerRef.current?.parentElement;
    if (!row || !shell) return;
    const shellBounds = shell.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const rowY = rowBounds.top + rowBounds.height / 2 - shellBounds.top;
    const height = preview.getBoundingClientRect().height;
    const top = Math.max(0, Math.min(rowY - 24, shellBounds.height - height));
    preview.style.top = `${top}px`;
  };
  const scheduleAlignPreview = () => {
    scrollingUntil.current = Date.now() + 200;
    if (alignFrame.current) return;
    alignFrame.current = requestAnimationFrame(() => { alignFrame.current = 0; alignPreview(); });
  };
  useEffect(() => () => { if (alignFrame.current) cancelAnimationFrame(alignFrame.current); }, []);
  useLayoutEffect(() => {
    if (!showPreview) return;
    alignPreview();
    const observer = new ResizeObserver(alignPreview);
    if (previewRef.current) observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [showPreview, previewTargetId, previewClip?.id, detailsActive]);
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
  // WebView2 sometimes swallows wheel events over the virtual list unless the
  // cursor sits on the scrollbar. Take vertical scrolling over natively there,
  // and suppress hover-preview changes while the list is being scrolled.
  useEffect(() => {
    if (!navigator.userAgent.includes('Windows') || pickerEdge === 'top' || pickerEdge === 'bottom') return;
    const lists = pickerRef.current?.querySelectorAll<HTMLElement>('.result-list,.pinned-list');
    const onWheel = (event: WheelEvent) => {
      scrollingUntil.current = Date.now() + 200;
      const list = event.currentTarget as HTMLElement;
      if (list.scrollHeight <= list.clientHeight + 1) return;
      event.preventDefault();
      list.scrollTop += event.deltaY;
    };
    lists?.forEach(list => list.addEventListener('wheel', onWheel, { passive: false }));
    return () => lists?.forEach(list => list.removeEventListener('wheel', onWheel));
  }, [pickerEdge, clips]);
  const action = async (name: string, args?: Record<string, unknown>, successNotice?: string) => {
    setMenu(null);
    if ((name === 'toggle_pin' || name === 'toggle_favorite') && typeof args?.id === 'number') {
      const clip = clips.find(item => item.id === args.id);
      if (clip) try { await flagMutations.toggle(clip, name === 'toggle_pin' ? 'pinned' : 'favorite'); } catch (e) { setNotice(`操作未完成：${String(e)}`); }
      return;
    }
    if(['copy_clip','copy_plain_clip','copy_original_clip'].includes(name)){
      if(transferPending.current||busy)return;
      transferPending.current=true;setTransferBusy(true);
      try{await call(name,args);if(successNotice)setNotice(successNotice);}catch(error){setNotice(`操作未完成：${String(error)}`);}finally{transferPending.current=false;setTransferBusy(false);}
      return;
    }
    try { setBusy(true); await call(name, args); if (name === 'delete_clip' && typeof args?.id === 'number') removeClip(args.id); else await refresh(); if (successNotice) setNotice(successNotice); } catch (e) { setNotice(`操作未完成：${String(e)}`); } finally { setBusy(false); }
  };
  const beginEditorInput = () => { if (navigator.userAgent.includes('Windows')) void call('set_picker_editing', { editing: true }); };
  const openEditor = (clip: Clip) => {
    if ((clip.kind !== 'text' && clip.kind !== 'rich') || clip.sensitive_masked) return;
    if (sidebarOpen) { setSidebarTokenClip(null); setSidebarToolsClip(null); setSidebarEditingClip(clip); setSelectedId(clip.id); } else setEditingClip(clip);
    setPreviewId(null); beginEditorInput();
  };
  const saveEdit = async (clip: Clip, content: string, formats?: ToolDocument) => {
    try { setBusy(true); const patch = await call<ClipContentPatch>('edit_clip', { id: clip.id, content, formattedHtml: formats?.html ?? null, formattedRtf: formats?.rtf ?? null }); receiveContent(patch); }
    finally { setBusy(false); }
  };
  const paste = async (clip: Clip, mode: 'default' | 'plain' | 'original' = 'default') => { if (pastingRef.current || transferPending.current || busy) return; pastingRef.current = true;transferPending.current=true; setMenu(null); setPreviewId(null); try { setTransferBusy(true); const command = mode === 'plain' ? 'paste_plain_clip' : mode === 'original' ? 'paste_original_clip' : 'paste_clip'; const result = await call<string>(command, { id: clip.id, edge: pickerEdge }); if (result === 'copied') setNotice(tr('已放入剪贴板，可手动粘贴')); if (result === 'pasted' && prefs.return_to_top_after_paste) { setSelectedId(null); pickerRef.current?.querySelectorAll<HTMLElement>('.result-list,.pinned-list').forEach(list => { list.scrollTop = 0; list.scrollLeft = 0; }); } } catch (e) { setNotice(`粘贴失败：${String(e)}`); } finally { setTransferBusy(false);transferPending.current=false; window.setTimeout(() => { pastingRef.current = false; }, 350); } };
  const openTokens = (clip: Clip) => { if ((clip.kind === 'text' || clip.kind === 'rich') && clip.plain_text.trim() && !clip.sensitive_masked) { if (sidebarOpen) { setSidebarToolsClip(null); setSidebarEditingClip(null); setSidebarTokenClip(clip); setSelectedId(clip.id); } else setTokenClip(clip); setPreviewId(null); setShowPositionKeys(false); } };
  const submitFragment = async (text: string, clip: Clip | null = tokenClip) => {
    if (!clip || busy || pastingRef.current) return;
    pastingRef.current = true; setBusy(true);
    try {
      const result = await call<string>('paste_text_fragment', { id: clip.id, text, edge: pickerEdge });
      if (result === 'copied') setNotice(tr('已放入剪贴板，可手动粘贴'));
      if (result === 'pasted' && prefs.return_to_top_after_paste) { setSelectedId(null); pickerRef.current?.querySelectorAll<HTMLElement>('.result-list,.pinned-list').forEach(list => { list.scrollTop = 0; list.scrollLeft = 0; }); }
      setTokenClip(current => current?.id === clip.id ? null : current);
      setSidebarTokenClip(current => current?.id === clip.id ? null : current);
    } finally { setBusy(false); pastingRef.current = false; }
  };
  const saveToolValue = async (clip: Clip, value: ToolDocument, expected: ToolDocument) => {
    const patch=await call<ClipContentPatch>('edit_clip', { id: clip.id, content: value.text, formattedHtml: value.html ?? null, formattedRtf: value.rtf ?? null, expectedSource: expected });
    receiveContent(patch);
  };
  useEffect(() => { setSidebarToolsClip(current => current && current.id !== previewTargetId ? null : current); }, [previewTargetId]);
  const applyTool = async (id: string, source: ToolDocument, rule?: RegexRule, script?:ScriptRule, targetClip?:Clip): Promise<ToolDocument> => {
    const target = targetClip ?? sidebarToolsClip;
    if (!target || toolMutation.current) throw Error(tr('操作进行中'));
    toolMutation.current = true; setBusy(true);
    try {
      const next = script ? await (await import('../lib/js-execution')).applyScriptRule(script,source,false,target.id) : id === 'auto-lines' ? await (await import('../lib/regex-runner')).runAutoLines(source,target.id) : id === 'regex' && rule ? await (await import('../lib/regex-runner')).runRegex(source,rule,target.id) : ['plain','to-markdown','to-rich','strip-markdown'].includes(id) ? await (await import('../lib/format-conversions')).convertFormat(id,source) : applyTextTool(id,source);
      await saveToolValue(target,next,source);
      setToolRedo([]);
      setToolHistory(items => {
        const history = [...items.slice(-19),{id:target.id,before:source,after:next}];
        const bytes = (entry: typeof history[number]) => [entry.before,entry.after].reduce((size,doc) => size + 2 * (doc.text.length + (doc.html?.length ?? 0) + (doc.rtf?.length ?? 0)),0);
        let total = history.reduce((size,entry) => size + bytes(entry),0);
        while (history.length > 1 && total > 16 * 1024 * 1024) total -= bytes(history.shift()!);
        return history;
      });
      return next;
    } finally { toolMutation.current = false; setBusy(false); }
  };
  const undoTool = async () => {
    if(active?.kind==='image'){if(busy)return;setBusy(true);try{await mediaHistoryAction(active.id,'undo');}finally{setBusy(false);}return;}
    const last = toolHistory.at(-1); if (!last || toolMutation.current) return;
    const clip = clips.find(item => item.id === last.id); if (!clip) return;
    toolMutation.current = true; setBusy(true);
    try { await saveToolValue(clip,last.before,last.after); setToolHistory(items => items.slice(0,-1)); setToolRedo(items => [...items,last]); if(sidebarToolsClip?.id === last.id)return last.before; }
    finally { toolMutation.current = false; setBusy(false); }
  };
  const redoTool = async () => {
    if(active?.kind==='image'){if(busy)return;setBusy(true);try{await mediaHistoryAction(active.id,'redo');}finally{setBusy(false);}return;}
    const last = toolRedo.at(-1); if (!last || toolMutation.current) return;
    const clip = clips.find(item => item.id === last.id); if (!clip) return;
    toolMutation.current = true; setBusy(true);
    try { await saveToolValue(clip,last.after,last.before); setToolRedo(items => items.slice(0,-1)); setToolHistory(items => [...items,last]); if(sidebarToolsClip?.id === last.id)return last.after; }
    finally { toolMutation.current = false; setBusy(false); }
  };
  const imageAction = async (clip: Clip, command: 'save_image' | 'open_image' | 'save_image_as') => {
    if (clip.kind !== 'image' || clip.sensitive_masked || busy) return;
    setPreviewId(null); setBusy(true);
    try { const result = await call<string | null>(command === 'save_image_as' ? 'save_image' : command, { id: clip.id, choosePath: command === 'save_image_as' }); if (command !== 'open_image' && result) setNotice(tr('已保存')); }
    catch (error) { setNotice(tr(String(error))); } finally { setBusy(false); }
  };
  const closePicker = () => {
    if (!animationsEnabled() || !pickerRef.current) { void call('hide_picker'); return; }
    if (closingAnimation.current) return;
    const offset = { none: 'translate(0)', left: 'translateX(-100%)', right: 'translateX(100%)', top: 'translateY(-100%)', bottom: 'translateY(100%)' }[pickerEdge];
    const vertical = pickerEdge === 'top' || pickerEdge === 'bottom';
    const animation = pickerEdge === 'none'
      ? pickerRef.current.animate([{opacity:1},{opacity:0}],{duration:100,easing:'ease-in',fill:'forwards'})
      : vertical
      ? pickerRef.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-in', fill: 'forwards' })
      : pickerRef.current.animate([{ transform: 'translate(0)' }, { transform: offset }], { duration: 170, easing: 'cubic-bezier(.4,0,.8,.2)', fill: 'forwards' });
    closingAnimation.current = animation;
    animation.onfinish = () => { if (closingAnimation.current === animation) void call('hide_picker'); };
  };
  const panelAction=(action:string):boolean=>{
    switch(action){
      case 'settings':void call('open_settings').catch(error=>setNotice(String(error)));return true;
      case 'sidebar':setSidebarOpen(open=>!open);return true;
      case 'window_pin':void call<boolean>('set_picker_pinned',{pinned:!windowPinned}).then(setWindowPinned).catch(error=>setNotice(String(error)));return true;
      case 'sort':setSortOpen(open=>!open);return true;
      case 'search':void call('set_picker_editing',{editing:true}).then(()=>searchRef.current?.focus()).catch(error=>setNotice(String(error)));return true;
    }
    if(action.startsWith('filter_')){
      const direction=action==='filter_next'?1:action==='filter_previous'?-1:0;
      const next=direction?filters[(filters.findIndex(item=>item.id===filter)+direction+filters.length)%filters.length]?.id:filters.find(item=>`filter_${item.id}`===action)?.id;
      if(next){setFilter(next);setSelectedId(null);setPreviewId(null);return true;}
    }
    return false;
  };
  const onKeyDown = (e: React.KeyboardEvent) => { if (e.nativeEvent.isComposing) return; if (toolHistoryAction(e) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable)) && !editingClip && !sidebarEditingClip && !tokenClip && !sidebarTokenClip) { e.preventDefault(); void (toolHistoryAction(e) === 'redo' ? redoTool() : undoTool()).catch(error => setNotice(tr(String(error)))); return; } if (tokenClip) { if (e.key === 'Escape' && !busy) { e.preventDefault(); setTokenClip(null); } return; } if (editingClip || deleteId !== null || clearScope !== null) return; const bound=(Object.entries({...actionShortcutDefaults,...prefs.action_shortcuts}) as [ActionShortcut,string][]).find(([,value])=>value&&normalizeShortcut(value)===normalizeShortcut(shortcutFromKey(e,true)||''));
    if(bound && !sidebarEditingClip && !sidebarTokenClip && ['settings','sidebar','window_pin','sort','search','filter_next','filter_previous','filter_favorite'].includes(bound[0])){e.preventDefault();if(!e.nativeEvent.repeat)panelAction(bound[0]);return;}
     if(active && !sidebarEditingClip && !sidebarTokenClip && normalizeShortcut(shortcutFromKey(e,true)||'')===normalizeShortcut(({...actionShortcutDefaults,...prefs.action_shortcuts}).tools) && ({...actionShortcutDefaults,...prefs.action_shortcuts}).tools){e.preventDefault();if(!e.nativeEvent.repeat)menuActionRef.current(active.id,'tools');return;} if(e.key==='Escape'&&sidebarOpen&&sidebarToolsClip){e.preventDefault();setSidebarToolsClip(null);return;} if (sidebarOpen && (sidebarTokenClip || sidebarEditingClip)) { if (e.key === 'Escape' && !busy) { e.preventDefault(); setSidebarTokenClip(null); setSidebarToolsClip(null); setSidebarEditingClip(null); } return; } const positionModifier = navigator.userAgent.includes('Mac') ? e.metaKey : e.ctrlKey; const horizontal = pickerEdge === 'top' || pickerEdge === 'bottom';  if (positionModifier && !e.altKey && !e.shiftKey && /^Digit[0-9]$/.test(e.code)) { const digit = Number(e.code.slice(5)); const target = positionClips[digit === 0 ? 9 : digit - 1]; if (target) { e.preventDefault(); void paste(target); } return; } if (e.key === 'Escape') { e.preventDefault(); if (sortOpen) setSortOpen(false); else if (menu) setMenu(null); else closePicker(); return; } if (e.key === (horizontal ? 'ArrowRight' : 'ArrowDown') && visible.length && !(horizontal && e.target instanceof HTMLInputElement)) { e.preventDefault(); const i = visible.findIndex(c => c.id === active?.id); setSelectedId(visible[Math.min(i + 1, visible.length - 1)].id); setPreviewId(null); } if (e.key === (horizontal ? 'ArrowLeft' : 'ArrowUp') && visible.length && !(horizontal && e.target instanceof HTMLInputElement)) { e.preventDefault(); const i = visible.findIndex(c => c.id === active?.id); setSelectedId(visible[Math.max(0, i - 1)].id); setPreviewId(null); } if (active && !(e.target instanceof HTMLSelectElement)) { const chord = shortcutFromKey(e, true); const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement; const matched = (Object.entries({...actionShortcutDefaults,...prefs.action_shortcuts}) as [ActionShortcut, string][]).find(([, value]) => value && normalizeShortcut(value) === normalizeShortcut(chord || '')); if (matched && (!typing || e.metaKey || e.ctrlKey || e.altKey || (matched[0] === 'paste' && chord === 'Enter')) ) { e.preventDefault(); menuActionRef.current(active.id, matched[0]); return; } } if ((e.key === 'F10' && e.shiftKey || e.key === 'ContextMenu') && active) { e.preventDefault(); const bounds = rowRefs.current[active.id]?.getBoundingClientRect(); if (bounds) { setSelectedId(active.id); setPreviewId(null); setMenu({ id: active.id, x: bounds.left + 20, y: bounds.bottom }); } } };
  const openMenu = (e: React.MouseEvent, clip: Clip) => { e.preventDefault(); setSelectedId(clip.id); setPreviewId(null); setSortOpen(false); setMenu({ id: clip.id, x: e.clientX, y: e.clientY }); };
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.context-menu')) setMenu(null); };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [menu]);
  const pickerKeyHandler=useRef(onKeyDown);pickerKeyHandler.current=onKeyDown;
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(pickerRef.current?.parentElement?.contains(event.target as Node))return;
      pickerKeyHandler.current({nativeEvent:event,key:event.key,code:event.code,target:event.target,metaKey:event.metaKey,ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,preventDefault:()=>event.preventDefault()} as React.KeyboardEvent);
    };
    window.addEventListener('keydown',key);
    return()=>window.removeEventListener('keydown',key);
  },[]);
  useEffect(()=>{if(!prefs.rules_enabled){setSidebarToolsClip(null);pendingRules.current=null;void call('hide_rule_menu');}},[prefs.rules_enabled]);
  const openRowRules=(clip:Clip,rect:DOMRect)=>{
    if(!prefs.rules_enabled)return;
    const rules=rowRules.filter(rule=>rule.enabled&&(rule.target??'text')===(clip.kind==='rich'?'text':clip.kind));
    const toggle=pendingRules.current?.clip.id===clip.id;
    pendingRules.current={clip,rules};setSelectedId(clip.id);
    void call('show_rule_menu',{toggle,id:clip.id,x:rect.left,y:rect.bottom,entries:rules.map((rule,index)=>({id:String(index),label:tr(rule.name)}))}).catch(error=>setNotice(String(error)));
  };
  menuActionRef.current = (id, choice) => {
    if(panelAction(choice))return;
    const clip = clips.find(item => item.id === id);
    if (!clip) return;
    if(choice.startsWith('rule-')){
      if(!prefs.rules_enabled)return;
      const pending=pendingRules.current,rule=pending?.rules[Number(choice.slice(5))];
      if(!pending||pending.clip.id!==id||!rule||busy)return;
      void (async()=>{try{if(clip.kind==='image'||clip.kind==='files'){setBusy(true);await applyMediaScript(clip,rule);}else{const source=await call<ToolDocument>('get_transform_source',{id});await applyTool(rule.id,source,undefined,rule,clip);}}catch(error){setNotice(String(error));}finally{setBusy(false);}})();return;
    }
    switch (choice) {
      case 'paste': void paste(clip); break;
      case 'paste_plain': if (clip.kind === 'rich' || clip.kind === 'files') void paste(clip, 'plain'); break;
      case 'paste_original': void paste(clip, 'original'); break;
      case 'copy': void action('copy_clip', { id }); break;
      case 'copy_plain': if (clip.kind === 'rich' || clip.kind === 'files') void action('copy_plain_clip', { id }); break;
      case 'copy_original': void action('copy_original_clip', { id }); break;
      case 'preview': setPreviewId(current => current === id ? null : id); break;
      case 'close_tools': setSidebarToolsClip(null); break;
      case 'tools': if(!prefs.rules_enabled)break; if(!sidebarOpen){const rect=rowRefs.current[id]?.getBoundingClientRect();if(rect&&!clip.sensitive_masked)openRowRules(clip,rect);break;} if(sidebarToolsClip?.id===id){setSidebarToolsClip(null);break;} setSidebarOpen(true); setSidebarEditingClip(null); setSidebarTokenClip(null); setSidebarToolsClip(clip); setSelectedId(clip.id); setPreviewId(null); beginEditorInput(); break;
      case 'edit': openEditor(clip); break;
      case 'segment': openTokens(clip); break;
      case 'save_image': void imageAction(clip, 'save_image'); break;
      case 'save_image_as': void imageAction(clip, 'save_image_as'); break;
      case 'reveal_file': if(clip.kind==='files'&&!clip.sensitive_masked)void action('file_tool', { id, action: 'reveal' }); break;
      case 'open_image': void imageAction(clip, 'open_image'); break;
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
  const pinnedVisible = useMemo(() => visible.filter(c => c.pinned), [visible]);
  const regularVisible = useMemo(() => visible.filter(c => !c.pinned), [visible]);
  useEffect(()=>{
    const root=pickerRef.current?.parentElement;
    if(!root)return;
    const actions:Record<string,string>={};
    for(const [action,labels] of Object.entries({settings:['打开设置','发现新版本，请到设置 → 关于更新'],sidebar:['展开侧栏','收起侧栏'],window_pin:['窗口置顶','取消窗口置顶'],search:['搜索剪贴板记录'],reveal_file:['打开文件位置'],open_image:['用系统预览打开'],save_image_as:['图片另存为'],tools:['快捷处理'],copy:['复制'],paste:['粘贴'],edit:['编辑内容'],segment:['分词'],pin:['置顶','取消置顶'],favorite:['收藏','取消收藏'],delete:['删除']}))for(const label of labels)actions[tr(label)]=action;
    root.querySelectorAll<HTMLButtonElement>('button').forEach(button=>{
      delete button.dataset.shortcutHint;
      delete button.dataset.shortcutMods;
      const action=(button.dataset.shortcutAction??actions[button.getAttribute('aria-label')??'']) as ActionShortcut|undefined;
      if(!showPositionKeys||!action)return;
      const shortcut=({...actionShortcutDefaults,...prefs.action_shortcuts})[action];
      if(!shortcut)return;
      const bare=shortcut.replace(/(?:CommandOrControl|Command|Control)\+/g,'');
      if(navigator.userAgent.includes('Windows')){
        const compact=compactShortcut(bare);
        button.dataset.shortcutHint=compact.key;
        if(compact.mods)button.dataset.shortcutMods=compact.mods;
      }else{
        button.dataset.shortcutHint=displayShortcut(bare);
      }
    });
  },[showPositionKeys,prefs.action_shortcuts,sidebarOpen,clips,active?.id,filter,windowPinned,sort]);
  useEffect(()=>{
    let timer:number|undefined;
    const primary=navigator.userAgent.includes('Mac')?'Meta':'Control';
    const clear=()=>{window.clearTimeout(timer);timer=undefined;setShowPositionKeys(false);};
    const down=(event:KeyboardEvent)=>{
      if(event.key!==primary){clear();return;}
      if(event.repeat||timer!==undefined)return;
      timer=window.setTimeout(()=>setShowPositionKeys(true),400);
    };
    const up=(event:KeyboardEvent)=>{if(event.key===primary||!(primary==='Meta'?event.metaKey:event.ctrlKey))clear();};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);
    return()=>{window.clearTimeout(timer);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);};
  },[]);
  const shortcutLabel = (action: ActionShortcut) => {
    const value = ({ ...actionShortcutDefaults, ...prefs.action_shortcuts })[action];
    return value ? displayShortcut(value) : '';
  };
  // The context menu is rendered in the page so Windows and macOS share the
  // same rounded look; native Windows menus are always square.
  const contextGroups = (clip: Clip): MenuEntry[][] => {
    const masked = clip.sensitive_masked;
    const textLike = clip.kind === 'text' || clip.kind === 'rich';
    const richOrFiles = clip.kind === 'rich' || clip.kind === 'files';
    const groups: MenuEntry[][] = [
      [
        { action: 'paste', label: '粘贴', icon: Clipboard, shortcut: shortcutLabel('paste') },
        ...(richOrFiles ? [{ action: 'paste_plain', label: clip.kind === 'files' ? '粘贴文件路径' : '粘贴为纯文本', icon: FileText, shortcut: shortcutLabel('paste_plain') }] : []),
        ...((clip.kind === 'rich' && prefs.default_plain_paste) || (clip.kind === 'files' && prefs.default_file_paths) ? [{ action: 'paste_original', label: clip.kind === 'files' ? '粘贴文件' : '粘贴原格式', icon: Clipboard, shortcut: shortcutLabel('paste_original') }] : []),
      ],
      [
        { action: 'copy', label: '复制到剪贴板', icon: Copy, shortcut: shortcutLabel('copy') },
        ...(richOrFiles ? [{ action: 'copy_plain', label: clip.kind === 'files' ? '复制文件路径' : '复制为纯文本', icon: Copy, shortcut: shortcutLabel('copy_plain') }] : []),
        ...((clip.kind === 'rich' && prefs.default_plain_copy) || (clip.kind === 'files' && prefs.default_copy_file_paths) ? [{ action: 'copy_original', label: clip.kind === 'files' ? '复制文件' : '复制原格式', icon: Copy, shortcut: shortcutLabel('copy_original') }] : []),
      ],
    ];
    const extras: MenuEntry[] = [];
    if (!sidebarOpen) extras.push({ action: 'preview', label: '预览内容', icon: Eye, shortcut: shortcutLabel('preview') });
    if (textLike && !masked) {
      extras.push({ action: 'edit', label: '编辑内容', icon: Pencil, shortcut: shortcutLabel('edit') });
      if (clip.plain_text.trim()) extras.push({ action: 'segment', label: '分词', icon: WholeWord, shortcut: shortcutLabel('segment') });
    }
    if (clip.kind === 'image' && !masked) {
      extras.push({ action: 'save_image', label: '保存到下载目录', icon: Download });
      extras.push({ action: 'save_image_as', label: '图片另存为', icon: Download, shortcut: shortcutLabel('save_image_as') });
      extras.push({ action: 'open_image', label: '用系统预览打开', icon: FolderOpen, shortcut: shortcutLabel('open_image') });
    }
    if (extras.length) groups.push(extras);
    groups.push([
      { action: 'favorite', label: clip.favorite ? '取消收藏' : '收藏', icon: Heart, shortcut: shortcutLabel('favorite') },
      { action: 'pin', label: clip.pinned ? '取消置顶' : '置顶', icon: Pin, shortcut: shortcutLabel('pin') },
    ]);
    groups.push([{ action: 'delete', label: '删除记录', icon: Trash2, shortcut: shortcutLabel('delete'), danger: true }]);
    return groups;
  };
  const menuClip = menu ? clips.find(clip => clip.id === menu.id) ?? null : null;
  const menuGroups = menuClip ? contextGroups(menuClip) : [];
  const menuRows = menuGroups.reduce((total, group) => total + group.length, 0) + Math.max(0, menuGroups.length - 1);
  const menuLeft = menu ? Math.max(6, Math.min(menu.x, window.innerWidth - 214)) : 0;
  const menuTop = menu ? Math.max(6, Math.min(menu.y, window.innerHeight - menuRows * 29 - 16)) : 0;
  const renderRow = (c: Clip) => <div className="result-item" key={c.id} onMouseEnter={() => { if (Date.now() > scrollingUntil.current && pickerEdge === 'none' && prefs.hover_preview && !menu) setPreviewId(c.id); }} onMouseLeave={() => { if (pickerEdge === 'none' && prefs.hover_preview) setPreviewId(null); }}>
    <button ref={el => { if (el) rowRefs.current[c.id] = el; else delete rowRefs.current[c.id]; }} className={`result-row ${active?.id === c.id ? 'selected' : ''} ${c.kind === 'image' ? 'image-row' : 'text-row'}`} onClick={() => { setSelectedId(c.id); setPreviewId(null); if (prefs.paste_on_single_click) void paste(c); }} onContextMenu={e => openMenu(e, c)} onDoubleClick={() => { if (!prefs.paste_on_single_click) void paste(c); }}>
      <span className="format-heading">{prefs.show_source_app_icon && pickerEdge === 'none' && <span className="row-app-shortcut"><AppIcon clip={c}/>{showPositionKeys && positionById.has(c.id) && <span className="position-key" aria-label={`快捷键 ${positionById.get(c.id)}`}>{positionById.get(c.id)}</span>}</span>}{!prefs.show_source_app_icon && showPositionKeys && positionById.has(c.id) ? <span className="row-format-shortcut position-key" aria-label={`快捷键 ${positionById.get(c.id)}`}>{positionById.get(c.id)}</span> : <span className="format-label">{clipLabel(c)}</span>}{c.favorite && <Heart size={13} fill="currentColor"/>}</span>
      {prefs.show_source_app_icon && pickerEdge !== 'none' && <AppIcon clip={c}/>}
      {c.kind === 'image' ? <ImageThumbnail clip={c}/> : <span className="result-text"><span className="result-summary">{clipSummary(c)}</span><span className="result-bottom">{c.favorite && <Heart size={13} fill="currentColor"/>}<span className="format-label">{clipLabel(c)}</span></span></span>}
    </button>
    {!sidebarOpen && <div className="row-actions" role="group" aria-label={tr('记录操作')} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
      {(c.kind === 'text' || c.kind === 'rich') && c.plain_text.trim() && !c.sensitive_masked && <button type="button" title={tr('分词')} aria-label={tr('分词')} disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => openTokens(c)}><WholeWord size={16}/></button>}
      {(c.kind === 'text' || c.kind === 'rich') && !c.sensitive_masked && <button type="button" title={tr('编辑内容')} aria-label={tr('编辑内容')} disabled={busy} onClick={() => openEditor(c)}><Pencil size={16}/></button>}
      {prefs.rules_enabled && ['text', 'rich', 'image', 'files'].includes(c.kind) && !c.sensitive_masked && <button type="button" title={tr('快捷处理')} aria-label={tr('快捷处理')} disabled={busy || !rowRulesReady} onMouseDown={event => event.preventDefault()} data-row-rules onClick={event => openRowRules(c,event.currentTarget.getBoundingClientRect())}><Workflow size={16}/></button>}
      <button type="button" title={tr(c.pinned ? '取消置顶' : '置顶')} aria-label={tr(c.pinned ? '取消置顶' : '置顶')} aria-pressed={c.pinned} disabled={busy} className={c.pinned ? 'is-active' : ''} onClick={() => void action('toggle_pin', { id: c.id })}><Pin size={16} fill={c.pinned ? 'currentColor' : 'none'}/></button>
      <button type="button" title={tr(c.favorite ? '取消收藏' : '收藏')} aria-label={tr(c.favorite ? '取消收藏' : '收藏')} aria-pressed={c.favorite} disabled={busy} className={c.favorite ? 'is-active' : ''} onClick={() => void action('toggle_favorite', { id: c.id })}><Heart size={16} fill={c.favorite ? 'currentColor' : 'none'}/></button>
      <button type="button" title={tr('复制')} aria-label={tr('复制')} disabled={busy||transferBusy} onClick={() => void action('copy_clip', { id: c.id }, tr('已复制'))}><Copy size={16}/></button>
      <button type="button" title={tr('删除')} aria-label={tr('删除')} disabled={busy} className="danger" onClick={() => setDeleteId(c.id)}><Trash2 size={16}/></button>
    </div>}
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
          await call('resize_edge_picker', { edge, cardSize: next, details: detailsActive });
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
    if (sidebarOpen && (drag.edge === 'left' || drag.edge === 'right')) shell?.style.setProperty('--expanded-panel-width', `${Math.min(size * drag.columns + 7 * (drag.columns - 1) + 316, window.screen.width - 16)}px`);
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
  const edgeStyle = { '--expanded-panel-width': `${Math.min(displayedCardSize * prefs.side_columns + 7 * (prefs.side_columns - 1) + 316, window.screen.width - 16)}px`, '--edge-app-icon-size': `${Math.max(18, Math.min(38, Math.round(displayedCardSize * 0.135))) + 2}px`, '--edge-app-glyph-size': `${Math.max(12, Math.min(23, Math.round(displayedCardSize * 0.08))) + 2}px`, '--pinned-width': `${pinnedVisible.length * (displayedCardSize + 7) + 8}px`, '--thumbnail-max-height': `${pickerEdge === 'none' ? 100 : Math.max(40, displayedCardSize - 18 - (prefs.show_source_app_icon ? Math.max(18, Math.min(38, Math.round(displayedCardSize * 0.135))) + 10 : 0))}px`, '--item-max-lines': prefs.item_max_lines } as React.CSSProperties;
  const searchBox = <div className="search-box"><Search size={19}/><input ref={searchRef} aria-label={tr('搜索剪贴板记录')} placeholder={tr('搜索')} value={query} onMouseDown={e => { if (!navigator.userAgent.includes('Windows')) return; e.preventDefault(); void call('set_picker_editing', { editing: true }).then(() => searchRef.current?.focus()); }} onBlur={() => { if (navigator.userAgent.includes('Windows')) void call('set_picker_editing', { editing: false }); }} onChange={e => { setQuery(e.target.value); setSelectedId(null); setPreviewId(null); }}/>{query && <button title={tr('清除搜索')} onClick={() => setQuery('')}><X size={15}/></button>}</div>;
  const sortLabels: Record<ClipSort, string> = { created: '创建时间', used: '使用频率', modified: '修改时间' };
  const sortControl = <div className="sort-control-wrap"><button type="button" className="sort-control" data-shortcut-action="sort" title={`${tr('记录排序')}：${tr(sortLabels[sort])}`} aria-label={`${tr('记录排序')}：${tr(sortLabels[sort])}`} aria-haspopup="menu" aria-expanded={sortOpen} onClick={() => setSortOpen(open => !open)}><ArrowDownUp size={14}/></button>{sortOpen && <div className="sort-menu" role="menu" aria-label={tr('记录排序')}>{(Object.keys(sortLabels) as ClipSort[]).map(key => <button key={key} type="button" role="menuitemradio" aria-checked={sort === key} onClick={() => { setSort(key); setSortOpen(false); setSelectedId(null); }}>{tr(sortLabels[key])}</button>)}</div>}</div>;
  const pinWindowButton = <button className={`header-icon window-pin ${windowPinned ? 'is-active' : ''}`} title={tr(windowPinned ? '取消窗口置顶' : '窗口置顶')} aria-label={tr(windowPinned ? '取消窗口置顶' : '窗口置顶')} aria-pressed={windowPinned} onClick={() => void call<boolean>('set_picker_pinned', { pinned: !windowPinned }).then(setWindowPinned).catch(error => setNotice(`窗口置顶失败：${String(error)}`))}><AppWindow size={17}/></button>;
  const sidebarButton = <button type="button" className={`header-icon ${sidebarOpen ? 'is-active' : ''}`} title={tr(sidebarOpen ? '收起侧栏' : '展开侧栏')} aria-label={tr(sidebarOpen ? '收起侧栏' : '展开侧栏')} aria-expanded={sidebarOpen} aria-controls="clip-detail-sidebar" onMouseDown={event => event.preventDefault()} onClick={() => setSidebarOpen(open => !open)}>{sidebarOpen ? <PanelRightClose size={17}/> : <PanelRightOpen size={17}/>}</button>;
  const settingsButton = <button className="header-icon update-settings-button" aria-label={tr(updateAvailable ? '发现新版本，请到设置 → 关于更新' : '打开设置')} title={tr(updateAvailable ? '发现新版本，请到设置 → 关于更新' : '打开设置')} onClick={() => void call('open_settings').catch(e => setNotice(`设置无法打开：${String(e)}`))}><Settings2 size={19}/>{updateAvailable && <span className="update-dot" aria-hidden="true"/>}</button>;
  return <div className={`picker-shell edge-${pickerEdge} side-columns-${prefs.side_columns} ${detailsActive ? 'with-details' : ''}`} style={edgeStyle} onKeyDown={onKeyDown}>{pickerEdge === 'none' && <div className="picker-drag-handle" data-tauri-drag-region title={tr('拖动面板')}/>}<div ref={pickerRef} className="picker" onScrollCapture={scheduleAlignPreview} onKeyUp={e => { if (e.key === 'Meta' || e.key === 'Control') setShowPositionKeys(false); }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setShowPositionKeys(false); }} onClick={e => { if (menu) setMenu(null); if (sortOpen && !(e.target as HTMLElement).closest('.sort-control-wrap')) setSortOpen(false); if (!(e.target as HTMLElement).closest('.result-row,.context-menu')) setPreviewId(null); }}>
    {!isHorizontal && <header className="picker-header" data-tauri-drag-region={pickerEdge === 'none' ? 'deep' : undefined}>{searchBox}{pinWindowButton}{settingsButton}{sidebarButton}</header>}
    <div className="filter-bar" data-tauri-drag-region={pickerEdge === 'none' ? 'deep' : undefined}><div className="filter-scroll">{filters.map(f => <button key={f.id} data-shortcut-action={f.id==='favorite'?'filter_favorite':undefined} className={filter === f.id ? 'chosen' : ''} title={tr(f.label)} aria-label={tr(f.label)} aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setSelectedId(null); setPreviewId(null); }}><f.icon size={14}/></button>)}</div>{isHorizontal && <>{pinWindowButton}{settingsButton}{searchBox}</>}{sortControl}{isHorizontal && sidebarButton}</div>
    <div className="picker-body"><div className="picker-results">
      {pinnedVisible.length > 0 && <VirtualClipList onVisibleIds={pinnedViewport} clips={pinnedVisible} className="pinned-list" label={tr('置顶记录')} edge={pickerEdge} columns={prefs.side_columns} selectedId={selectedId} resetKey={JSON.stringify([query, filter, sort])} maxLines={prefs.item_max_lines} style={isHorizontal ? { width: 'var(--pinned-width)' } : undefined} renderRow={renderRow}/>}
      <VirtualClipList onVisibleIds={regularViewport} clips={regularVisible} className="result-list" edge={pickerEdge} columns={prefs.side_columns} selectedId={selectedId} resetKey={JSON.stringify([query, filter, sort])} maxLines={prefs.item_max_lines} renderRow={renderRow}>{visible.length === 0 && <div className="empty-state"><Search size={24}/><strong>{tr(query ? '没有匹配的记录' : '还没有记录')}</strong><span>{tr(query ? '换个关键词或类型试试' : '复制内容后会显示在这里')}</span></div>}</VirtualClipList>
    </div></div>

    {tokenClip && <TokenDialog key={tokenClip.id} clip={tokenClip} dictionaryKey={dictionaryKey} busy={busy} onClose={() => setTokenClip(null)} onSubmit={submitFragment}/>}
    <footer className="picker-footer" data-tauri-drag-region={pickerEdge === 'none' ? 'deep' : undefined}><span className="picker-count">{tr('共 {count} 条').replace('{count}', clips.length.toLocaleString())}</span><button type="button" className="clear-scope-button" title={tr('清空当前筛选')} aria-label={tr('清空当前筛选')} disabled={busy||transferBusy||matchedClips.length===0} onClick={()=>{setClearError('');setClearScope({ids:matchedClips.map(clip=>clip.id)});setPreviewId(null);setSortOpen(false);void call('hide_rule_menu');}}><Trash2 size={14}/></button></footer>
    {clearScope&&<ConfirmDialog title={tr('清空记录')} description={tr('将清空{count}条记录，含置顶和收藏，此操作无法恢复。').replace('{count}',String(clearScope.ids.length))+(clearError?` ${clearError}`:'')} confirmLabel={tr('清空记录')} busy={busy} onCancel={()=>{setClearScope(null);setClearError('');}} onConfirm={()=>{if(busy)return;const scope=clearScope;setBusy(true);setClearError('');void call('clear_clips',{ids:scope.ids}).then(()=>{removeClips(scope.ids);setClearScope(null);}).catch(error=>setClearError(tr(String(error)))).finally(()=>setBusy(false));}}/>}
    {deleteId !== null && <ConfirmDialog title={tr('删除记录')} description={tr('删除这条记录？删除后无法恢复。')} confirmLabel={tr('删除')} busy={busy} onCancel={() => setDeleteId(null)} onConfirm={() => { const id = deleteId; setDeleteId(null); void action('delete_clip', { id }); }}/>}
    {editingClip && <div className="clip-edit-backdrop" onClick={event => event.stopPropagation()}><ClipEditor key={editingClip.id} clip={editingClip} busy={busy} onCancel={() => setEditingClip(null)} onBeginInput={beginEditorInput} onSave={async (content, formats) => { await saveEdit(editingClip, content, formats); setEditingClip(null); }}/></div>}

    {pickerEdge !== 'none' && <div className={`resize-edge resize-${pickerEdge}`} role="separator" aria-label={tr('拖动面板边缘调整大小')} onPointerDown={beginResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize}/>}
    {notice && <div className="toast" role="status">{trNotice(notice)}<button title={tr('关闭提示')} onClick={() => setNotice('')}><X size={14}/></button></div>}
  </div><aside ref={previewRef} hidden={!showPreview} id="clip-detail-sidebar" className={`side-preview ${detailsActive ? 'details-sidebar' : ''}`} aria-label={tr('内容预览')}><div className="sidebar-detail-view" hidden={sidebarOpen && (sidebarEditingClip !== null || sidebarTokenClip !== null)}><ClipDetails rulesEnabled={prefs.rules_enabled} clip={displayedPreview} active={showPreview} expanded={sidebarOpen} busy={busy} transferBusy={transferBusy} toolsExpanded={sidebarToolsClip?.id === displayedPreview?.id && sidebarToolsClip !== null} toolsPanel={sidebarToolsClip && (sidebarToolsClip.kind === 'image' || sidebarToolsClip.kind === 'files') ? <MediaQuickTools key={sidebarToolsClip.id} clip={sidebarToolsClip} busy={busy} onBusy={setBusy} onError={setNotice}/> : sidebarToolsClip ? <QuickActionsPanel key={sidebarToolsClip.id} active={detailsActive} clip={sidebarToolsClip} busy={busy} canUndo={toolHistory.length > 0} canRedo={toolRedo.length > 0} onRedo={redoTool} onClose={() => setSidebarToolsClip(null)} onApply={applyTool} onUndo={undoTool}/> : null} onAction={(id, choice) => menuActionRef.current(id, choice)}/></div>{sidebarEditingClip && <div className="sidebar-work-view" hidden={!sidebarOpen}><ClipEditor key={sidebarEditingClip.id} embedded active={detailsActive} clip={sidebarEditingClip} busy={busy} onCancel={() => setSidebarEditingClip(null)} onBeginInput={beginEditorInput} onSave={async (content, formats) => { await saveEdit(sidebarEditingClip, content, formats); setSidebarEditingClip(null); }}/></div>}{sidebarTokenClip && <div className="sidebar-work-view" hidden={!sidebarOpen}><TokenDialog key={sidebarTokenClip.id} embedded clip={sidebarTokenClip} dictionaryKey={dictionaryKey} busy={busy} onClose={() => setSidebarTokenClip(null)} onSubmit={text => submitFragment(text, sidebarTokenClip)}/></div>}{showPreview && !sidebarEditingClip && !sidebarTokenClip && !sidebarToolsClip && !displayedPreview && <div className="detail-empty">{tr(previewTargetId === null ? '选择记录以预览内容' : '预览加载中')}</div>}</aside>{menu && menuClip && <div className="context-menu" role="menu" aria-label={tr('记录操作')} style={{ left: menuLeft, top: menuTop }} onContextMenu={event => event.preventDefault()}>{menuGroups.map((group, index) => <div className="context-menu-group" key={index}>{index > 0 && <div className="menu-divider"/>}{group.map(entry => <button key={entry.action} type="button" role="menuitem" className={entry.danger ? 'danger' : ''} onClick={() => { const id = menu.id; setMenu(null); menuActionRef.current(id, entry.action); }}><entry.icon size={15}/><span>{tr(entry.label)}</span>{entry.shortcut && <span className="menu-shortcut">{entry.shortcut}</span>}</button>)}</div>)}</div>}</div>;
}
