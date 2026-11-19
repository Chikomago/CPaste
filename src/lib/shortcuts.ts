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

// Windows keycap hints: the primary key stays a single character, while
// modifiers use multi-letter badges (SH / ALT / CTL / WIN). Mapping Shift to a
// bare "S" would make Shift+S render as "SS", indistinguishable from a lone S.
// No macOS modifier glyphs (⌃⌥⇧⌘) are used here.
const winModifierLabels: Record<string, string> = { Control: 'CTL', Alt: 'ALT', Shift: 'SH', Command: 'WIN', Super: 'WIN' };
const winKeyLabels: Record<string, string> = { Enter: '↵', Space: '␣', Delete: '⌫', Backspace: '⌫', Up: '↑', Down: '↓', Left: '←', Right: '→' };
export const compactShortcut = (value: string) => {
  if (!value) return { key: '', mods: '' };
  const parts = value.replace('CommandOrControl', navigator.userAgent.includes('Mac') ? 'Command' : 'Control').split('+');
  const mods = parts.filter(part => winModifierLabels[part]).map(part => winModifierLabels[part]);
  const key = [...parts].reverse().find(part => !winModifierLabels[part]) ?? '';
  return { key: winKeyLabels[key] ?? key, mods: mods.join(' ') };
};
export function shortcutFromKey(e: React.KeyboardEvent, allowBare = false): string | null {
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return null;
  const code = e.code;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit[0-9]$/.test(code) ? code.slice(5) : /^F(?:[1-9]|1[0-2])$/.test(code) ? code : { Enter: 'Enter', Space: 'Space', Delete: 'Delete', Backspace: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[code];
  if (!key || (!(e.metaKey || e.ctrlKey || e.altKey) && !(allowBare && ['Enter', 'Space', 'Delete'].includes(key)))) return null;
  const parts = [e.metaKey ? (navigator.userAgent.includes('Mac') ? 'Command' : 'Super') : null, e.ctrlKey ? 'Control' : null, e.altKey ? 'Alt' : null, e.shiftKey ? 'Shift' : null, key];
  return parts.filter(Boolean).join('+');
}
