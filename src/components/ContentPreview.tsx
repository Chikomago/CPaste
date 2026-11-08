import { useEffect, useState } from 'react';
import { File } from 'lucide-react';
import { PreviewClip } from '../types';
import { kindName, timeLabel, formatBytes } from '../lib/clips';
import { call } from '../lib/api';
import { isEnglish, tr } from '../i18n';

export function ContentPreview({ clip }: { clip: PreviewClip }) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<[number, number] | null>(null);
  useEffect(() => { if (clip.kind !== 'image') return; let cancelled = false; void call<string | null>('get_clip_image', { id: clip.id }).then(data => { if (!cancelled) setImageData(data); }).catch(() => { if (!cancelled) setImageData(null); }); return () => { cancelled = true; }; }, [clip.id, clip.kind]);
  const knownFileSizes = clip.file_sizes.filter((size): size is number => size !== null);
  const stats = clip.kind === 'image'
    ? imageSize ? `${imageSize[0]} × ${imageSize[1]}` : clip.sensitive_masked ? tr('尺寸不可用') : null
    : clip.kind === 'files'
      ? knownFileSizes.length === clip.files.length ? `${clip.files.length} ${isEnglish() ? 'files' : '个文件'} · ${formatBytes(knownFileSizes.reduce((total, size) => total + size, 0))}` : `${clip.files.length} ${isEnglish() ? 'files' : '个文件'}`
      : `${Array.from(clip.plain_text).length} ${isEnglish() ? 'characters' : '字符'}`;
  return <div className="preview-card"><div className="preview-heading"><strong>{tr(kindName[clip.kind])}</strong><span>{clip.source_app || tr('未知应用')} · {timeLabel(clip.created_at)}</span></div>{stats && <div className="preview-stats">{stats}</div>}<div className="preview-body">{clip.kind === 'image' ? clip.sensitive_masked ? '******' : imageData ? <img src={`data:image/png;base64,${imageData}`} alt={tr('剪贴板图片预览')} onLoad={event => setImageSize([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])}/> : tr('图片预览不可用') : clip.kind === 'files' ? clip.files.map((file, index) => <div key={`${index}-${file}`} className="preview-file"><File size={14}/><span className="preview-file-path">{file}</span><span className="preview-file-size">{clip.file_sizes[index] == null ? tr('大小不可用') : formatBytes(clip.file_sizes[index])}</span></div>) : <p>{clip.plain_text || tr('此记录没有纯文本预览')}</p>}</div></div>;
}
