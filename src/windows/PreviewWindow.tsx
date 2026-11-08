import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { TriggerEdge, PreviewPlacement, Preferences, PreviewClip } from '../types';
import { call } from '../lib/api';
import { ContentPreview } from '../components/ContentPreview';
import { setLanguage } from '../i18n';

export function PreviewWindow() {
  const initial = new URLSearchParams(location.search);
  const [placement, setPlacement] = useState<PreviewPlacement>({ id: Number(initial.get('id')) || 0, edge: (initial.get('edge') || 'none') as TriggerEdge, anchor_x: Number(initial.get('anchorX')) || 0, anchor_y: Number(initial.get('anchorY')) || 0 });
  const [clip, setClip] = useState<PreviewClip | null>(null);
  const [, refreshLanguage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { document.body.classList.add('preview-body-root'); const listener = listen<PreviewPlacement>('preview-changed', event => setPlacement(event.payload)); return () => { document.body.classList.remove('preview-body-root'); void listener.then(unlisten => unlisten()); }; }, []);
  useEffect(() => { const update = () => { void call<Preferences>('get_preferences').then(value => { setLanguage(value.language); refreshLanguage(value => value + 1); }); }; update(); const listener = listen('clips-changed', update); return () => { void listener.then(unlisten => unlisten()); }; }, []);
  useEffect(() => { if (!placement.id) return; let active = true; setClip(null); void call<PreviewClip | null>('get_preview_clip', { id: placement.id }).then(value => { if (active) setClip(value); }).catch(() => { if (active) setClip(null); }); return () => { active = false; }; }, [placement.id]);
  useLayoutEffect(() => {
    const card = containerRef.current?.querySelector('.preview-card');
    if (!card) return;
    let lastHeight = 0;
    const resize = () => { const height = Math.ceil(card.getBoundingClientRect().height); if (height === lastHeight) return; lastHeight = height; void call('resize_preview', { edge: placement.edge, anchorX: placement.anchor_x, anchorY: placement.anchor_y, height }); };
    const observer = new ResizeObserver(resize);
    observer.observe(card);
    resize();
    return () => observer.disconnect();
  }, [clip, placement]);
  return <div ref={containerRef} className="preview-window" onMouseEnter={() => void emit('preview-pointer', { inside: true })} onMouseLeave={() => void emit('preview-pointer', { inside: false })}>{clip && <ContentPreview clip={clip}/>}</div>;
}
