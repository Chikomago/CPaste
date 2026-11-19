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

// Windows keycaps reuse the macOS glyphs, one-to-one: Ctrl is ⌃, Alt is ⌥,
// Shift is ⇧ and the Windows key is ⌘. A single line such as "⌃⇧P" always fits
// inside a 24px row button, and no modifier can be mistaken for a bare letter.
const keyGlyphs: Record<string, string> = { Command: '⌘', Super: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Enter: '↵', Space: '␣', Delete: '⌫', Backspace: '⌫', Up: '↑', Down: '↓', Left: '←', Right: '→' };
export const keycapShortcut = (value: string) => {
  if (!value) return '';
  return value
    .split('+')
    .map(part => part === 'CommandOrControl' ? 'Control' : part)
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
