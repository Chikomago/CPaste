import React from 'react';
import { tr } from '../i18n';

export const normalizeShortcut = (value: string) => value.replace('CommandOrControl', navigator.userAgent.includes('Mac') ? 'Command' : 'Control').toLowerCase();
export const displayShortcut = (value: string) => {
  const mac = navigator.userAgent.includes('Mac');
  if (!value) return '';
  const parts = value.replace('CommandOrControl', mac ? 'Command' : 'Control').split('+');
  const macNames: Record<string, string> = { Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Enter: '↵', Space: tr('空格'), Delete: '⌫', Backspace: '⌫', Up: '↑', Down: '↓', Left: '←', Right: '→' };
  const winNames: Record<string, string> = { Control: 'Ctrl', Command: 'Win', Super: 'Win', Alt: 'Alt', Shift: 'Shift', Enter: 'Enter', Space: tr('空格'), Delete: 'Del', Backspace: 'Backspace', Up: '↑', Down: '↓', Left: '←', Right: '→' };
  return parts.map(part => (mac ? macNames : winNames)[part] || part).join(mac ? '' : '+');
};

// One keycap renderer shared by macOS and Windows. The held trigger key is
// stripped here (⌘ on macOS, Ctrl on Windows); every remaining key — whether it
// carries a macOS name (Command/Option) or a Windows name (Control/Super/Win) —
// is mapped through ONE glyph table, so both platforms render identically and
// only the key-name → glyph mapping differs. This keeps a single CSS style
// (button[data-shortcut-hint]) for both platforms.
const keyGlyphs: Record<string, string> = { Command: '⌘', Super: '⌘', Win: '⌘', Meta: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Enter: '↵', Space: '␣', Delete: '⌫', Backspace: '⌫', Up: '↑', Down: '↓', Left: '←', Right: '→' };
export const keycapShortcut = (value: string) => {
  if (!value) return '';
  const mac = navigator.userAgent.includes('Mac');
  const parts = value.split('+');
  const last = parts.length - 1;
  return parts
    // Strip the held trigger on each platform (and the platform-neutral
    // CommandOrControl alias), but always keep the final primary key.
    .filter((part, i) => i === last || !['CommandOrControl', 'Command', 'Control'].includes(part))
    .map(part => keyGlyphs[part] ?? part)
    .join('');
};
export function shortcutFromKey(e: React.KeyboardEvent, allowBare = false): string | null {
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return null;
  const code = e.code;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit[0-9]$/.test(code) ? code.slice(5) : /^F(?:[1-9]|1[0-2])$/.test(code) ? code : { Enter: 'Enter', Space: 'Space', Delete: 'Delete', Backspace: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[code];
  if (!key || (!(e.metaKey || e.ctrlKey || e.altKey) && !(allowBare && ['Enter', 'Space', 'Delete'].includes(key)))) return null;
  const parts = [e.metaKey ? (navigator.userAgent.includes('Mac') ? 'Command' : 'Super') : null, e.ctrlKey ? 'Control' : null, e.altKey ? 'Alt' : null, e.shiftKey ? 'Shift' : null, key];
  return parts.filter(Boolean).join('+');
}
