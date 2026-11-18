export function toolHistoryAction(event: Pick<KeyboardEvent,'key'|'metaKey'|'ctrlKey'|'shiftKey'|'altKey'>): 'undo' | 'redo' | null {
  if(event.altKey)return null;
  const key=event.key.toLowerCase();
  if((event.metaKey||event.ctrlKey)&&key==='z')return event.shiftKey?'redo':'undo';
  if(event.ctrlKey&&!event.metaKey&&!event.shiftKey&&key==='y')return 'redo';
  return null;
}
