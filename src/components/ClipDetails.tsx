import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Download, ExternalLink, FolderOpen, Workflow, ChevronDown, ClipboardPaste, Copy, Heart, Pencil, Pin, Trash2, WholeWord } from 'lucide-react';
import type { PanelLayout, PreviewClip } from '../types';
import { RetainedPreview } from './ContentPreview';
import { isEnglish, tr } from '../i18n';

type Props = { layout?: PanelLayout; clip: PreviewClip | null; active: boolean; busy?: boolean; transferBusy?:boolean; expanded?: boolean; toolsExpanded?: boolean; rulesEnabled?:boolean; toolsPanel?: ReactNode; onAction: (id: number, action: string) => void };

export function ClipDetails({ layout = 'sidebar', clip, active, busy = false, transferBusy=false, expanded = true, toolsExpanded = false, rulesEnabled=true, toolsPanel, onAction }: Props) {
  const dock = layout === 'columns';
  const editable = clip && (clip.kind === 'text' || clip.kind === 'rich') && !clip.sensitive_masked;
  const formatted = clip?.kind === 'rich' || clip?.kind === 'files';
  const topActions = [
    { id: 'pin', label: clip?.pinned ? '取消置顶' : '置顶', icon: Pin },
    { id: 'favorite', label: clip?.favorite ? '取消收藏' : '收藏', icon: Heart },
    ...(clip?.kind === 'image' && !clip.sensitive_masked ? [{ id: 'open_image', label: '从系统打开', icon: ExternalLink }] : []),
    ...(clip?.kind === 'files' && !clip.sensitive_masked ? [{ id: 'reveal_file', label: '打开文件位置', icon: FolderOpen }] : []),
    ...(editable ? [{ id: 'edit', label: '编辑内容', icon: Pencil }] : []),
    { id: 'delete', label: '删除', icon: Trash2 },
  ];
  const [transferMenu, setTransferMenu] = useState<'copy' | 'paste' | null>(null);
  const transferRoot = useRef<HTMLDivElement>(null);
  const toolsRoot=useRef<HTMLDivElement>(null),toolsTrigger=useRef<HTMLButtonElement>(null);
  const [toolsPosition,setToolsPosition] = useState({left:0,top:0,width:176,maxHeight:360});
  useLayoutEffect(()=>{
    if(!toolsExpanded)return;
    const root=transferRoot.current?.closest('.clip-details');
    const controls=transferRoot.current?.closest('.clip-details-controls');
    const trigger=toolsTrigger.current;
    if(!root||!controls||!trigger)return;
    const measure=()=>{
      const bounds=root.getBoundingClientRect(),origin=controls.getBoundingClientRect(),button=trigger.getBoundingClientRect();
      const width=Math.min(176,Math.max(0,bounds.width-12));
      const left=Math.max(bounds.left+6,Math.min(button.left,bounds.right-width-6));
      const below=Math.max(0,bounds.bottom-button.bottom-8),above=Math.max(0,button.top-bounds.top-8);
      const down=below>=Math.min(360,window.innerHeight*.55)||below>=above;
      const maxHeight=Math.min(360,window.innerHeight*.55,down?below:above);
      const height=Math.min(maxHeight,toolsRoot.current?.scrollHeight??maxHeight);
      setToolsPosition({left:left-origin.left,top:down?button.bottom+4-origin.top:button.top-height-4-origin.top,width,maxHeight});
    };
    measure();const observer=new ResizeObserver(measure);observer.observe(root);
    return()=>observer.disconnect();
  },[toolsExpanded,layout,clip?.id]);
  useEffect(()=>{
    if(!active||!expanded||!toolsExpanded||!clip)return;
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!toolsRoot.current?.contains(event.target)&&!toolsTrigger.current?.contains(event.target))onAction(clip.id,'close_tools');};
    document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);
  },[active,expanded,toolsExpanded,clip?.id,onAction]);
  useEffect(() => { setTransferMenu(null); }, [clip?.id, expanded]);
  useEffect(() => {
    if (!transferMenu) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !transferRoot.current?.contains(event.target)) setTransferMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setTransferMenu(null); } };
    document.addEventListener('pointerdown', outside, true); window.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escape, true); };
  }, [transferMenu]);
  const chooseTransfer = (action: string) => { setTransferMenu(null); if (clip) onAction(clip.id, action); };
  const transfer = (kind: 'copy' | 'paste') => {
    const label = kind === 'copy' ? '复制' : '粘贴';
    const optionsLabel = kind === 'copy' ? '更多复制方式' : '更多粘贴方式';
    const Icon = kind === 'copy' ? Copy : ClipboardPaste;
    return <div className="clip-transfer-control">
      <button type="button" className="clip-transfer-main" title={tr(label)} aria-label={tr(label)} disabled={busy || transferBusy || !clip} onMouseDown={event => event.preventDefault()} onClick={() => chooseTransfer(kind)}><Icon size={17}/><span>{tr(label)}</span></button>
      {formatted && <button type="button" className="clip-transfer-toggle" title={tr(optionsLabel)} aria-label={tr(optionsLabel)} aria-haspopup="menu" aria-expanded={transferMenu === kind} disabled={busy || transferBusy} onMouseDown={event => event.preventDefault()} onClick={() => setTransferMenu(current => current === kind ? null : kind)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setTransferMenu(kind); requestAnimationFrame(() => transferRoot.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()); } }}><ChevronDown size={13}/></button>}
    </div>;
  };
  const transferOptions = transferMenu === 'copy'
    ? [{ id: 'copy_plain', label: clip?.kind === 'files' ? '复制文件路径' : '复制为纯文本' }, { id: 'copy_original', label: '复制原格式' }]
    : [{ id: 'paste_plain', label: clip?.kind === 'files' ? '粘贴文件路径' : '粘贴为纯文本' }, { id: 'paste_original', label: '粘贴原格式' }];
  const renderAction = (action: typeof topActions[number]) => <button key={action.id} type="button" disabled={busy || !clip} title={tr(action.label)} aria-label={tr(action.label)} className={`${action.id === 'delete' ? 'danger' : action.id === 'favorite' ? 'favorite-action' : ''} ${action.id === 'pin' && clip?.pinned || action.id === 'favorite' && clip?.favorite ? 'is-active' : ''}`} aria-pressed={action.id === 'pin' ? clip?.pinned : action.id === 'favorite' ? clip?.favorite : undefined} onMouseDown={event => event.preventDefault()} onClick={() => { if (clip) onAction(clip.id, action.id); }}><action.icon size={14} fill={action.id==='favorite'&&clip?.favorite||action.id==='pin'&&clip?.pinned?'currentColor':'none'}/>{dock&&<span>{tr(action.id==='pin'?'置顶':action.id==='favorite'?'收藏':action.id==='edit'?'编辑':action.label)}</span>}</button>;
  const date = (value: string) => new Date(value).toLocaleString(isEnglish() ? 'en-US' : 'zh-CN');
  return <section className={`preview-surface ${expanded ? `clip-details detail-layout-${layout}` : ''}`} aria-label={tr(expanded ? '条目详情' : '内容预览')}>
    {expanded && <div className="clip-details-controls">{dock&&<strong className="dock-heading">{tr('操作')}</strong>}
    {expanded && <header className="clip-details-header"><div className="clip-details-toolbar" role="group" aria-label={tr('条目管理')}>{topActions.filter(action=>!dock||['pin','favorite'].includes(action.id)).map(renderAction)}</div></header>}
    {expanded && active && clip && <>
      <div ref={transferRoot} className="clip-details-actions" role="group" aria-label={tr('记录操作')}>
        <div className="clip-secondary-row">{dock&&topActions.filter(action=>!['pin','favorite'].includes(action.id)).map(renderAction)}
        {editable && clip.plain_text.trim() && <button type="button" className="clip-segment-button" title={tr('分词')} aria-label={tr('分词')} disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => onAction(clip.id, 'segment')}><WholeWord size={17}/><span>{tr('分词')}</span></button>}
        {clip.kind === 'image' && !clip.sensitive_masked && <button type="button" className="clip-tools-button" title={tr('图片另存为')} aria-label={tr('图片另存为')} disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => onAction(clip.id, 'save_image_as')}><Download size={17}/>{dock&&<span>{tr('图片另存为')}</span>}</button>}
        {rulesEnabled && (editable || clip.kind === 'image' || clip.kind === 'files') && !clip.sensitive_masked && <button ref={toolsTrigger} type="button" className="clip-tools-button" title={tr('快捷处理')} aria-label={tr('快捷处理')} aria-expanded={toolsExpanded} aria-controls="clip-quick-actions" disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => { setTransferMenu(null); onAction(clip.id, toolsExpanded ? 'close_tools' : 'tools'); }}><Workflow size={15}/><span>{tr('快捷处理')}</span></button>}
        </div>
        <div className="clip-transfer-row">{transfer('copy')}{transfer('paste')}</div>
        {toolsExpanded && toolsPanel && <div ref={toolsRoot} id="clip-quick-actions" className="clip-quick-actions-dropdown" style={toolsPosition}>{toolsPanel}</div>}
        {transferMenu && <div className={`clip-transfer-menu clip-transfer-menu-${transferMenu}`} role="menu" aria-label={tr(transferMenu === 'copy' ? '更多复制方式' : '更多粘贴方式')} onKeyDown={event => {
          if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
          event.preventDefault();
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}>{transferOptions.map(option => <button key={option.id} type="button" role="menuitem" title={tr(option.label)} disabled={busy||transferBusy} onMouseDown={event => event.preventDefault()} onClick={() => chooseTransfer(option.id)}>{tr(option.label)}</button>)}</div>}
      </div>
    </>}
    </div>}
    <div className={expanded ? 'clip-details-content' : undefined} tabIndex={expanded ? 0 : undefined} aria-label={expanded ? tr('记录内容') : undefined}><RetainedPreview clip={clip} active={active} imageMetadata={expanded} imageControls={expanded}/>
    {expanded && active && !clip && <p className="clip-details-empty">{tr('选择一条记录查看详情')}</p>}</div>
    {expanded && active && clip && <footer className="clip-details-footer">
      <dl className="clip-details-meta"><div><dt>{tr('来源应用')}</dt><dd>{clip.source_app || tr('未知应用')}</dd></div><div><dt>{tr('创建时间')}</dt><dd>{date(clip.created_at)}</dd></div>{clip.updated_at && <div><dt>{tr('修改时间')}</dt><dd>{date(clip.updated_at)}</dd></div>}{typeof clip.use_count === 'number' && <div><dt>{tr('使用次数')}</dt><dd>{clip.use_count}</dd></div>}</dl>

    </footer>}
  </section>;
}
