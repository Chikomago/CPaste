import type { Clip } from '../types';
export type ClipContentPatch = Pick<Clip,'kind'|'title'|'plain_text'|'updated_at'|'sensitive_masked'> & { updated_id: number };
export function patchClipContent<T extends Clip>(clips: T[], patch: ClipContentPatch): T[] {
  let changed=false;
  const next=clips.map(clip=>{
    if(clip.id!==patch.updated_id)return clip;
    const {updated_id:_,...fields}=patch;
    if((Object.keys(fields) as (keyof typeof fields)[]).every(key=>clip[key]===fields[key]))return clip;
    changed=true;return {...clip,...fields};
  });
  return changed?next:clips;
}
