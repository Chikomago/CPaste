import React from 'react';
import { createRoot } from 'react-dom/client';
import { Picker } from './windows/Picker';
import { PreviewWindow } from './windows/PreviewWindow';
import { SettingsWindow } from './windows/SettingsWindow';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>{new URLSearchParams(location.search).get('view') === 'settings' ? <SettingsWindow/> : new URLSearchParams(location.search).get('view') === 'preview' ? <PreviewWindow/> : <Picker/>}</React.StrictMode>);
