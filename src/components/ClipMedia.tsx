import {convertFileSrc} from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { AppWindow, Image } from 'lucide-react';
import { Clip, InstalledApp } from '../types';
import { call } from '../lib/api';
import { thumbnailCache } from '../lib/clip-images';
import { tr } from '../i18n';

const appIconCache = new Map<string, Promise<string | null>>();
let appIconGeneration=0;
export function resetAppIconCache(){appIconCache.clear();appIconGeneration++;}
// Windows has no cheap way to read an executable icon without spawning a
// helper process, so the UI shows a letter badge there instead.
const iconLetter = (name?: string) => (Array.from(name?.trim() || '?')[0] || '?').toUpperCase();
export function AppIcon({ clip }: { clip: Clip }) {
  const generation=appIconGeneration;
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => { const path = clip.source_path; setIcon(null); if (!path || navigator.userAgent.includes('Windows')) return; let active = true; let request = appIconCache.get(path); if (!request) { request = call<string | null>('get_app_icon_path', { sourcePath: path }).catch(() => null); appIconCache.set(path, request); } void request.then(data => { if (active) setIcon(data); }); return () => { active = false; }; }, [clip.source_path,generation]);
  return <span className="app-icon" title={clip.source_app || tr('未知应用')} aria-label={clip.source_app || tr('未知应用')}>{icon ? <img src={convertFileSrc(icon)} alt=""/> : navigator.userAgent.includes('Windows') && clip.source_app ? <span className="app-icon-letter" aria-hidden="true">{iconLetter(clip.source_app)}</span> : <AppWindow size={19}/>}</span>;
}
export function InstalledAppIcon({ app }: { app: InstalledApp }) {
  const host = useRef<HTMLSpanElement>(null);
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (navigator.userAgent.includes('Windows')) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return;
      observer.disconnect();
      let request = appIconCache.get(app.path);
      if (!request) { request = call<string | null>('get_app_icon_path', { sourcePath: app.path }).catch(() => null); appIconCache.set(app.path, request); }
      void request.then(value => { if (active) setIcon(value); });
    });
    if (host.current) observer.observe(host.current);
    return () => { active = false; observer.disconnect(); };
  }, [app.path,appIconGeneration]);
  return <span ref={host} className="app-icon" aria-hidden="true">{icon ? <img src={convertFileSrc(icon)} alt=""/> : navigator.userAgent.includes('Windows') ? <span className="app-icon-letter">{iconLetter(app.name)}</span> : <AppWindow size={19}/>}</span>;
}
export function ImageThumbnail({ clip }: { clip: Clip }) {
  const generation=thumbnailCache.generation();
  const currentId=useRef(clip.id);
  const host = useRef<HTMLSpanElement>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(() => clip.sensitive_masked ? null : thumbnailCache.peek(clip.id));
  useEffect(() => {
    const cached = clip.sensitive_masked ? null : thumbnailCache.touch(clip.id);
    const changed=currentId.current!==clip.id;currentId.current=clip.id;
    if(cached||changed||clip.sensitive_masked)setThumbnail(cached);
    if (clip.sensitive_masked || cached) return;
    let active = true;
    const controller = new AbortController();
    const node = host.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      const revision=thumbnailCache.revision(clip.id);
      const request = thumbnailCache.get(clip.id, controller.signal).then(value=>!value&&!controller.signal.aborted&&thumbnailCache.revision(clip.id)>=revision&&thumbnailCache.revision(clip.id)>0?thumbnailCache.get(clip.id,controller.signal):value);
      void request.then(data => { if (active) setThumbnail(data); });
    }, { root: node.closest('.result-list,.pinned-list'), rootMargin: '160px' });
    observer.observe(node);
    return () => { active = false; controller.abort(); observer.disconnect(); };
  }, [clip.id, clip.sensitive_masked, clip.updated_at,generation]);
  return <span ref={host} className="image-thumbnail" aria-label={tr('图片缩略图')}>{thumbnail && !clip.sensitive_masked ? <img src={convertFileSrc(thumbnail)} decoding="async" alt=""/> : <Image size={20}/>}</span>;
}
