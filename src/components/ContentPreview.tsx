import {convertFileSrc} from '@tauri-apps/api/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { File, Maximize2, Minimize2 } from 'lucide-react';
import { PreviewClip } from '../types';
import { kindName, timeLabel, formatBytes } from '../lib/clips';
import { previewImageCache, previewImageKey } from '../lib/clip-images';
import { isEnglish, tr } from '../i18n';

export function ContentPreview({ clip, imageMetadata=false, imageControls=false }: { clip: PreviewClip; imageMetadata?:boolean; imageControls?:boolean }) {
  const key = previewImageKey(clip);
  const currentId=useRef(clip.id);
  const imageStage=useRef<HTMLDivElement>(null);
  const [stageSize,setStageSize]=useState<[number,number]>([0,0]);
  const [imageData, setImageData] = useState<string | null>(() => clip.sensitive_masked ? null : previewImageCache.peek(key));
  const [imageFit,setImageFit]=useState<'fit'|'fill'>('fit');
  useEffect(()=>setImageFit('fit'),[clip.id]);
  const [imageSize, setImageSize] = useState<[number, number] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const changed=currentId.current!==clip.id;currentId.current=clip.id;
    const cached=clip.sensitive_masked?null:previewImageCache.peek(key);
    if(cached||changed||clip.sensitive_masked||clip.kind!=='image')setImageData(cached);
    if (clip.kind !== 'image' || clip.sensitive_masked) return;
    void previewImageCache.get(key,controller.signal).then(data => { if (!controller.signal.aborted) setImageData(data); });
    return () => controller.abort();
  }, [key, clip.kind, clip.sensitive_masked]);
  useLayoutEffect(()=>{
    const node=imageStage.current;if(!node)return;
    const measure=()=>{const box=node.getBoundingClientRect();setStageSize(current=>current[0]===box.width&&current[1]===box.height?current:[box.width,box.height]);};
    measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();
  },[imageData,clip.kind]);
  useLayoutEffect(()=>{if(imageStage.current){imageStage.current.scrollLeft=0;imageStage.current.scrollTop=0;}},[imageFit,clip.id]);
  const scrollAxis=imageSize&&stageSize[0]>0&&stageSize[1]>0&&imageSize[0]/imageSize[1]>stageSize[0]/stageSize[1]?'x':'y';
  const knownFileSizes = clip.file_sizes.filter((size): size is number => size !== null);
  const stats = clip.kind === 'image'
    ? clip.sensitive_masked ? tr('尺寸不可用') : [imageSize ? `${imageSize[0]} × ${imageSize[1]}` : null, imageMetadata ? clip.image_format : null, imageMetadata && clip.image_size!=null ? formatBytes(clip.image_size) : null].filter(Boolean).join(' · ')
    : clip.kind === 'files'
      ? knownFileSizes.length === clip.files.length ? `${clip.files.length} ${isEnglish() ? 'files' : '个文件'} · ${formatBytes(knownFileSizes.reduce((total, size) => total + size, 0))}` : `${clip.files.length} ${isEnglish() ? 'files' : '个文件'}`
      : `${Array.from(clip.plain_text).length} ${isEnglish() ? 'characters' : '字符'}`;
  return <div className={`preview-card${clip.kind==='image'?' preview-image-card':''}`} data-image-fit={clip.kind==='image'?imageFit:undefined} data-scroll-axis={clip.kind==='image'&&imageFit==='fill'?scrollAxis:undefined}><div className="preview-heading"><strong>{tr(kindName[clip.kind])}</strong><span>{clip.source_app || tr('未知应用')} · {timeLabel(clip.created_at)}</span></div>{stats && <div className="preview-stats">{stats}</div>}<div className="preview-body">{clip.kind === 'image' ? clip.sensitive_masked ? '******' : imageData ? <div ref={imageStage} className="preview-image-stage"><img src={convertFileSrc(imageData)} alt={tr('剪贴板图片预览')} onLoad={event => setImageSize([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])}/></div> : tr('图片预览不可用') : clip.kind === 'files' ? clip.files.map((file, index) => <div key={`${index}-${file}`} className="preview-file"><File size={14}/><span className="preview-file-path">{file}</span><span className="preview-file-size">{clip.file_sizes[index] == null ? tr('大小不可用') : formatBytes(clip.file_sizes[index])}</span></div>) : <p>{clip.plain_text || tr('此记录没有纯文本预览')}</p>}</div>{clip.kind==='image'&&imageControls&&<div className="preview-image-controls"><button type="button" className="image-fit-button" title={tr(imageFit==='fit'?'充满':'适应')} aria-label={tr(imageFit==='fit'?'充满':'适应')} disabled={!imageData||clip.sensitive_masked} onMouseDown={event=>event.preventDefault()} onClick={()=>setImageFit(current=>current==='fit'?'fill':'fit')}>{imageFit==='fit'?<Maximize2 size={16}/>:<Minimize2 size={16}/>}</button></div>}</div>;
}


/** Preserve the last committed image element while the preview is closed. */
export function RetainedPreview({ clip, active, imageMetadata=false, imageControls=false }: { clip: PreviewClip | null; active: boolean; imageMetadata?:boolean; imageControls?:boolean }) {
  const lastClip = useRef<PreviewClip | null>(null);
  useLayoutEffect(() => { if (clip) lastClip.current = clip; }, [clip]);
  const retained = clip ?? lastClip.current;
  return <div className={`retained-preview${retained?.kind==='image'?' retained-image-preview':''}`} hidden={!active || !clip}>{retained && <ContentPreview key={`${retained.id}/${retained.created_at}`} clip={retained} imageMetadata={imageMetadata} imageControls={imageControls}/>}</div>;
}
