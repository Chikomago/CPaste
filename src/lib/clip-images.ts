import { call } from './api';
import { MediaCache } from './media-cache';

export const thumbnailCache = new MediaCache<number>(id => call<string | null>('get_clip_thumbnail_path', { id }));
export const previewImageCache = new MediaCache<string>(key => call<string | null>('get_clip_image_path', { id: Number(key.split('/')[0]) }), 32 * 1024 * 1024, 4, 1);
export const previewImageKey = (clip: { id: number; created_at: string; updated_at?:string }) => `${clip.id}/${clip.updated_at ?? clip.created_at}/${previewImageCache.generation()}`;

export function resetImageCaches(){thumbnailCache.clear();previewImageCache.clear();}
