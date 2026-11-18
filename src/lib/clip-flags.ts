import type { Clip } from '../types';

export type ClipFlag = 'pinned' | 'favorite';
export type ClipFlagPatch = { updated_id: number; pinned?: boolean; favorite?: boolean };

export function patchClipFlags(clips: Clip[], patch: ClipFlagPatch): Clip[] {
  let changed = false;
  const next = clips.map(clip => {
    if (clip.id !== patch.updated_id) return clip;
    const pinned = patch.pinned ?? clip.pinned;
    const favorite = patch.favorite ?? clip.favorite;
    if (pinned === clip.pinned && favorite === clip.favorite) return clip;
    changed = true;
    return { ...clip, pinned, favorite };
  });
  return changed ? next : clips;
}

/** Apply reversible flags immediately; merge server events without rereading history. */
export class ClipFlagMutations {
  private pending = new Map<string, { id: number; flag: ClipFlag; value: boolean; confirmed?: boolean }>();
  constructor(private publish: (patch: ClipFlagPatch) => void, private persist: (command: string, id: number) => Promise<boolean>) {}

  async toggle(clip: Clip, flag: ClipFlag) {
    const key = `${clip.id}/${flag}`;
    if (this.pending.has(key)) return;
    const previous = clip[flag];
    const operation = { id: clip.id, flag, value: !previous, confirmed: undefined as boolean | undefined };
    this.pending.set(key, operation);
    this.publish({ updated_id: clip.id, [flag]: operation.value });
    try {
      const value = await this.persist(flag === 'pinned' ? 'toggle_pin' : 'toggle_favorite', clip.id);
      this.pending.delete(key);
      this.publish({ updated_id: clip.id, [flag]: value });
    } catch (error) {
      this.pending.delete(key);
      this.publish({ updated_id: clip.id, [flag]: operation.confirmed ?? previous });
      if (operation.confirmed === undefined) throw error;
    }
  }
  receive(patch: ClipFlagPatch) {
    for (const flag of ['pinned', 'favorite'] as const) {
      const operation = this.pending.get(`${patch.updated_id}/${flag}`);
      if (operation && typeof patch[flag] === 'boolean') operation.value = operation.confirmed = patch[flag];
    }
    this.publish(patch);
  }
  overlay(clips: Clip[]) {
    let next = clips;
    for (const operation of this.pending.values()) next = patchClipFlags(next, { updated_id: operation.id, [operation.flag]: operation.value });
    return next;
  }
}
