import { Kind, Clip } from '../types';
import { isEnglish, tr } from '../i18n';

export const kindName: Record<Kind, string> = { text: '纯文本', rich: '富文本', image: '图片', files: '文件' };
export function isCode(clip: Clip) {
  if (clip.kind !== 'text' && clip.kind !== 'rich') return false;
  const value = clip.plain_text.trim();
  if (!value || value.length < 12) return false;
  if (/^(?:```|#!\/|import\s|from\s+\w+\s+import\s|(?:export\s+)?(?:const|let|var|function|class|interface|type)\s|def\s|fn\s|pub\s|SELECT\s)/im.test(value)) return true;
  if (value.startsWith('{') || value.startsWith('[')) { try { JSON.parse(value); return true; } catch { /* ordinary text */ } }
  return value.split('\n').length >= 3 && /[{};=<>]/.test(value) && /(?:=>|\breturn\b|\bif\s*\(|\bfor\s*\(|<\w+[\s>])/.test(value);
}
export const clipLabel = (clip: Clip) => tr(isCode(clip) ? '代码' : kindName[clip.kind]);
export const clipSummary = (clip: Clip) => clip.kind === 'files' ? clip.files.join('\n') : clip.sensitive_masked && clip.kind === 'image' ? '******' : clip.kind === 'image' ? tr('图片') : clip.plain_text || clip.title;
export const timeLabel = (iso: string) => { const delta = Date.now() - new Date(iso).getTime(); if (delta < 60000) return tr('刚刚'); if (delta < 3600000) return isEnglish() ? `${Math.floor(delta / 60000)} min ago` : `${Math.floor(delta / 60000)} 分钟前`; if (delta < 86400000) return isEnglish() ? `${Math.floor(delta / 3600000)} hr ago` : `${Math.floor(delta / 3600000)} 小时前`; return new Date(iso).toLocaleDateString(isEnglish() ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric' }); };
export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toLocaleString(isEnglish() ? 'en-US' : 'zh-CN', { maximumFractionDigits: 1 })} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
};
