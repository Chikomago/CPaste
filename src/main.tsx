import { RuleMenuWindow } from './windows/RuleMenuWindow';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Picker } from './windows/Picker';
import { PreviewWindow } from './windows/PreviewWindow';
import { SettingsWindow } from './windows/SettingsWindow';
import './style.css';

// Prefer the explicit query parameter for backwards compatibility, but derive
// the view from the window label when there is none. On Windows, Tauri builds
// app URLs from a path and query strings on spawned windows are unreliable.
const requestedView = new URLSearchParams(location.search).get('view');
let windowLabel = '';
try {
  windowLabel = getCurrentWindow().label;
} catch {
  // Running outside Tauri (for example in a plain browser preview).
}
const view = requestedView || (windowLabel === 'main' ? '' : windowLabel);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {view === 'rules' ? <RuleMenuWindow /> : view === 'settings' ? <SettingsWindow /> : view === 'preview' ? <PreviewWindow /> : <Picker />}
  </React.StrictMode>
);
