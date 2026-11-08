import React from 'react';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { isEnglish } from '../i18n';

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
export function SettingsNumber({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (input: string) => { const next = input === '' ? value : Math.max(min, Math.min(max, Number(input))); setDraft(String(next)); if (next !== value) onCommit(next); };
  return <div className="settings-number"><button type="button" aria-label={isEnglish() ? `Decrease ${label}` : `减少${label}`} disabled={value <= min} onClick={() => commit(String(value - 1))}><Minus size={14}/></button><input type="text" inputMode="numeric" pattern="[0-9]*" aria-label={label} value={draft} onChange={event => { if (/^\d*$/.test(event.target.value)) setDraft(event.target.value); }} onBlur={() => commit(draft)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(String(value)); event.currentTarget.blur(); } }}/><button type="button" aria-label={isEnglish() ? `Increase ${label}` : `增加${label}`} disabled={value >= max} onClick={() => commit(String(value + 1))}><Plus size={14}/></button></div>;
}
export function Toggle({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) { return <Setting label={label} help={help}><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/></Setting>; }
