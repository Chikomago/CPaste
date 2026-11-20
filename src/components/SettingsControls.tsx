import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Minus, Plus, Search } from 'lucide-react';
import { isEnglish, tr } from '../i18n';
import { call } from '../lib/api';

export function Setting({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) { return <div className="setting-row"><span><strong>{label}</strong>{help && <small>{help}</small>}</span>{children}</div>; }
export function SettingsSelect({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [opensUp, setOpensUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);
  const toggle = () => { setOpensUp((window.innerHeight - (root.current?.getBoundingClientRect().bottom ?? 0)) < Math.min(220, options.length * 38 + 10)); setOpen(value => !value); };
  const move = (direction: number) => { const index = options.findIndex(option => option[0] === value); const next = options[(index + direction + options.length) % options.length]; if (next) onChange(next[0]); };
  return <div ref={root} className={`settings-select ${opensUp ? 'opens-up' : ''}`} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); event.stopPropagation(); } else if (event.target === trigger.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); } }}>
    <button ref={trigger} type="button" className="settings-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}><span>{options.find(option => option[0] === value)?.[1] ?? value}</span><ChevronDown size={15}/></button>
    {open && <div className="settings-select-options" role="listbox" aria-label={label}>{options.map(([id, text]) => <button key={id} type="button" role="option" aria-selected={value === id} onClick={() => { onChange(id); setOpen(false); trigger.current?.focus(); }}>{text}</button>)}</div>}
  </div>;
}
// Self-styled font list: a search field plus options rendered in their own
// typeface, so the user can judge each font before applying it. No native
// select is used. Values come from the `list_fonts` backend command; the empty
// value means "system default" (the CSS fallback stack in :root).
export function FontPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [opensUp, setOpensUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void call<string[]>('list_fonts').then(setFonts).catch(() => setFonts([]));
  }, []);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    const focus = window.setTimeout(() => search.current?.focus(), 0);
    return () => { document.removeEventListener('pointerdown', closeOutside); window.clearTimeout(focus); };
  }, [open]);
  const toggle = () => {
    setOpensUp((window.innerHeight - (root.current?.getBoundingClientRect().bottom ?? 0)) < 300);
    setQuery('');
    setOpen(value => !value);
  };
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const matches = fonts.filter(font => !q || font.toLocaleLowerCase().includes(q));
    return matches.length > 200 ? matches.slice(0, 200) : matches;
  }, [fonts, query]);
  const preview = 'Aa 中文 字体预览 0123';
  const choose = (family: string) => { onChange(family); setOpen(false); trigger.current?.focus(); };
  return <div ref={root} className={`settings-select font-picker ${opensUp ? 'opens-up' : ''}`} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); event.stopPropagation(); } }}>
    <button ref={trigger} type="button" className="settings-select-trigger" aria-label={tr('字体')} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
      <span>{value || tr('系统默认')}</span><ChevronDown size={15}/>
    </button>
    {open && <div className="settings-select-options font-picker-options" role="listbox" aria-label={tr('字体')}>
      <div className="font-picker-search"><Search size={14}/><input ref={search} aria-label={tr('搜索字体')} placeholder={tr('搜索字体')} value={query} onChange={event => setQuery(event.target.value)}/></div>
      <div className="font-picker-list">
        <button type="button" role="option" aria-selected={!value} onClick={() => choose('')}><span className="font-picker-name">{tr('系统默认')}</span><span className="font-picker-sample">{preview}</span></button>
        {shown.map(font => <button key={font} type="button" role="option" aria-selected={value === font} onClick={() => choose(font)}><span className="font-picker-name">{font}</span><span className="font-picker-sample" style={{ fontFamily: `"${font.replace(/["\\]/g, '')}", sans-serif` }}>{preview}</span></button>)}
        {shown.length === 0 && <p className="font-picker-empty">{tr('未找到匹配的字体')}</p>}
      </div>
    </div>}
  </div>;
}
export function SettingsNumber({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (input: string) => { const next = input === '' ? value : Math.max(min, Math.min(max, Number(input))); setDraft(String(next)); if (next !== value) onCommit(next); };
  return <div className="settings-number"><button type="button" aria-label={isEnglish() ? `Decrease ${label}` : `减少${label}`} disabled={value <= min} onClick={() => commit(String(value - 1))}><Minus size={14}/></button><input type="text" inputMode="numeric" pattern="[0-9]*" aria-label={label} value={draft} onChange={event => { if (/^\d*$/.test(event.target.value)) setDraft(event.target.value); }} onBlur={() => commit(draft)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(String(value)); event.currentTarget.blur(); } }}/><button type="button" aria-label={isEnglish() ? `Increase ${label}` : `增加${label}`} disabled={value >= max} onClick={() => commit(String(value + 1))}><Plus size={14}/></button></div>;
}
export function Toggle({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) { return <Setting label={label} help={help}><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/></Setting>; }
