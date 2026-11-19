import { applyTheme } from '../lib/theme';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { TriggerEdge, PreviewPlacement, Preferences, PreviewClip } from '../types';
import { call } from '../lib/api';
import {resetImageCaches} from '../lib/clip-images';
import { RetainedPreview } from '../components/ContentPreview';
import { setLanguage } from '../i18n';

type PreviewInitial = { id?: number; edge?: string; anchor_x?: number; anchor_y?: number };
declare global { interface Window { __previewInitial?: PreviewInitial } }

export function PreviewWindow() {
  const params = new URLSearchParams(location.search);
  const initial = window.__previewInitial;
  const [placement, setPlacement] = useState<PreviewPlacement>({
    id: Number(initial?.id ?? params.get('id') ?? 0) || 0,
    edge: (initial?.edge ?? params.get('edge') ?? 'none') as TriggerEdge,
    anchor_x: Number(initial?.anchor_x ?? params.get('anchorX') ?? 0) || 0,
    anchor_y: Number(initial?.anchor_y ?? params.get('anchorY') ?? 0) || 0,
  });
  const [dataRevision, setDataRevision] = useState(0);
  const [clip, setClip] = useState<PreviewClip | null>(null);
  const [, refreshLanguage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { document.body.classList.add('preview-body-root'); const listener = listen<PreviewPlacement>('preview-changed', event => { setPlacement(event.payload); }); return () => { document.body.classList.remove('preview-body-root'); void listener.then(unlisten => unlisten()); }; }, []);
  useEffect(() => { const update = () => { void call<Preferences>('get_preferences').then(value => { setLanguage(value.language); applyTheme(value.theme,value.accent_color,value.disable_animations); refreshLanguage(value => value + 1); }); }; update(); const listener = listen<{reset?:boolean}|null>('clips-changed', event => { if(event.payload?.reset)resetImageCaches();update(); setDataRevision(value => value + 1); }); return () => { void listener.then(unlisten => unlisten()); }; }, []);
  useEffect(() => { if (!placement.id) return; let active = true; setClip(null); void call<PreviewClip | null>('get_preview_clip', { id: placement.id }).then(value => { if (active) setClip(value); }).catch(() => { if (active) setClip(null); }); return () => { active = false; }; }, [placement.id, dataRevision]);
  useLayoutEffect(() => {
    const card = containerRef.current?.querySelector('.preview-card');
    if (!card) return;
    let lastHeight = 0;
    // The card fills the window (no padding, no outer shadow), so its own
    // height is the window height; adding padding here leaves a blank band.
    const resize = () => { const height = Math.ceil(Math.max(card.scrollHeight, card.getBoundingClientRect().height)); if (height === lastHeight) return; lastHeight = height; void call('resize_preview', { edge: placement.edge, anchorX: placement.anchor_x, anchorY: placement.anchor_y, height }); };
    const observer = new ResizeObserver(resize);
    observer.observe(card);
    resize();
    return () => observer.disconnect();
  }, [clip, placement]);
  return <div ref={containerRef} className="preview-window" onMouseEnter={() => void emit('preview-pointer', { inside: true })} onMouseLeave={() => void emit('preview-pointer', { inside: false })}><RetainedPreview clip={clip} active={!!clip}/></div>;
}
