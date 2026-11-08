import { invoke } from '@tauri-apps/api/core';

export const call = <T,>(name: string, args?: Record<string, unknown>) => invoke<T>(name, args);
