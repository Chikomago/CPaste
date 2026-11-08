import { Preferences } from '../types';

export const applyTheme = (theme: Preferences['theme'], accent: string) => {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const hex = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#3569ed';
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  let hue = 0;
  if (delta) {
    const channel = rgb.indexOf(max);
    hue = channel === 0 ? ((rgb[1] - rgb[2]) / delta) % 6 : channel === 1 ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  const vividness = saturation < 0.08 ? 0 : Math.round(Math.min(90, Math.max(45, saturation * 100)));
  const color = (value: number) => `hsl(${Math.round(hue)} ${vividness}% ${value}%)`;
  root.style.setProperty('--accent-base', hex);
  root.style.setProperty('--accent-fill', color(30));
  root.style.setProperty('--accent-text-light', color(36));
  root.style.setProperty('--accent-text-dark', color(72));
};
