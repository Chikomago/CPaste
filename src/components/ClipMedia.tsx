import { useEffect, useRef, useState } from 'react';
import { AppWindow, Image } from 'lucide-react';
import { Clip, InstalledApp } from '../types';
import { call } from '../lib/api';
import { tr } from '../i18n';

const appIconCache = new Map<string, Promise<string | null>>();
export function AppIcon({ clip }: { clip: Clip }) {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => { const path = clip.source_path; setIcon(null); if (!path) return; let active = true; let request = appIconCache.get(path); if (!request) { request = call<string | null>('get_app_icon', { sourcePath: path }).catch(() => null); appIconCache.set(path, request); } void request.then(data => { if (active) setIcon(data); }); return () => { active = false; }; }, [clip.source_path]);
  return <span className="app-icon" title={clip.source_app || tr('未知应用')} aria-label={clip.source_app || tr('未知应用')}>{icon ? <img src={`data:image/png;base64,${icon}`} alt=""/> : <AppWindow size={19}/>}</span>;
}
export function InstalledAppIcon({ app }: { app: InstalledApp }) {
  const host = useRef<HTMLSpanElement>(null);
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return;
      observer.disconnect();
      let request = appIconCache.get(app.path);
      if (!request) { request = call<string | null>('get_app_icon', { sourcePath: app.path }).catch(() => null); appIconCache.set(app.path, request); }
      void request.then(value => { if (active) setIcon(value); });
    });
    if (host.current) observer.observe(host.current);
    return () => { active = false; observer.disconnect(); };
  }, [app.path]);
  return <span ref={host} className="app-icon" aria-hidden="true">{icon ? <img src={`data:image/png;base64,${icon}`} alt=""/> : <AppWindow size={19}/>}</span>;
}
const thumbnailCache = new Map<number, Promise<string | null>>();
export function ImageThumbnail({ clip }: { clip: Clip }) {
  const host = useRef<HTMLSpanElement>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  useEffect(() => {
    if (clip.sensitive_masked) return;
    let active = true;
    const node = host.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      let request = thumbnailCache.get(clip.id);
      if (!request) {
        request = call<string | null>('get_clip_thumbnail', { id: clip.id }).catch(() => null);
        thumbnailCache.set(clip.id, request);
      }
      void request.then(data => { if (active) setThumbnail(data); });
    }, { root: node.closest('.result-list,.pinned-list') });
    observer.observe(node);
    return () => { active = false; observer.disconnect(); };
  }, [clip.id, clip.sensitive_masked]);
  return <span ref={host} className="image-thumbnail" aria-label={tr('图片缩略图')}>{thumbnail ? <img src={`data:image/png;base64,${thumbnail}`} alt=""/> : <Image size={20}/>}</span>;
}
