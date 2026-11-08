import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Clip } from '../types';
import { dictionarySegments } from '../lib/dictionary';
import { joinDictionaryTokens } from '../lib/segmentation';
import { tr } from '../i18n';

export function TokenDialog({ clip, dictionaryKey, busy, onClose, onSubmit }: { clip: Clip; dictionaryKey: string; busy: boolean; onClose: () => void; onSubmit: (text: string) => Promise<void> }) {
  const [tokens, setTokens] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [visibleCount, setVisibleCount] = useState(200);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setSelected(new Set());
    void dictionarySegments(clip.plain_text).then(value => { if (active) setTokens(value); }).catch(error => { if (active) setError(String(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clip.plain_text, dictionaryKey]);
  const output = useMemo(() => joinDictionaryTokens(clip.plain_text, tokens, selected), [clip.plain_text, tokens, selected]);
  const submit = async (text: string) => { try { setError(''); await onSubmit(text); } catch (error) { setError(String(error)); } };
  return <div className="clip-edit-backdrop" onMouseDown={event => event.preventDefault()} onClick={event => event.stopPropagation()}><div className="clip-edit-dialog token-dialog" role="dialog" aria-label={tr('分词')} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); } }}><div className="token-toolbar"><h2>{tr('分词')}</h2><button type="button" disabled={busy || loading} onClick={() => setSelected(new Set(tokens.map((_, index) => index)))}>{tr('全选')}</button><button type="button" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>{tr('清除选择')}</button><button type="button" disabled={busy} aria-label={tr('关闭分词')} title={tr('关闭分词')} onClick={onClose}><X size={16}/></button></div><p className="clip-edit-help">{tr('点选词块，按原文顺序组合')}</p><div className="token-list" aria-busy={loading}>{loading ? <p className="clip-edit-help">{tr('正在分词…')}</p> : tokens.slice(0, visibleCount).map((token, index) => <button key={index} type="button" disabled={busy} aria-pressed={selected.has(index)} onMouseDown={event => event.preventDefault()} onClick={() => setSelected(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })}>{token}</button>)}{!loading && visibleCount < tokens.length && <button type="button" onClick={() => setVisibleCount(count => count + 200)}>{tr('显示更多')}</button>}</div><div className="token-output" role="textbox" aria-readonly="true" aria-label={tr('组词区域')}>{output || tr('选择词块后在这里预览')}</div>{error && <p className="clip-edit-error" role="alert">{tr(error)}</p>}<div className="clip-edit-actions"><button type="button" className="primary" disabled={busy || loading || !output.trim()} onClick={() => void submit(output)}>{tr('粘贴')}</button></div></div></div>;
}
