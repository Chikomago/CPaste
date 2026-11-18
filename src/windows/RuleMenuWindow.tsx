import {useEffect,useRef,useState} from 'react';
import {emitTo,listen} from '@tauri-apps/api/event';
import {call} from '../lib/api';
import {animateSurface,applyTheme} from '../lib/theme';
import type {Preferences} from '../types';
type MenuData={id:number;entries:{id:string;label:string}[]};
declare global {interface Window {__ruleMenu?:MenuData}}
export function RuleMenuWindow(){
 const pointer=useRef<[number,number]|null>(null);
 const updatePointer=()=>{const point=pointer.current;const target=point?document.elementFromPoint(point[0],point[1])?.closest<HTMLButtonElement>('[data-rule-id]'):null;setHovered(target?.dataset.ruleId??null);};
 const [hovered,setHovered]=useState<string|null>(null);
 const [menu,setMenu]=useState<MenuData|undefined>(window.__ruleMenu);
 useEffect(()=>{
  document.body.classList.add('rule-menu-root');
  const update=()=>{setHovered(null);setMenu(window.__ruleMenu);void call<Preferences>('get_preferences').then(p=>{applyTheme(p.theme, p.accent_color, p.disable_animations);animateSurface(document.querySelector('.rule-menu-panel'));});};
  window.addEventListener('rule-menu-ready',update);update();
  const preferences=listen('preferences-changed',()=>{void call<Preferences>('get_preferences').then(p=>applyTheme(p.theme,p.accent_color,p.disable_animations));});
  const position=listen<[number,number]|null>('rule-pointer',event=>{pointer.current=event.payload;updatePointer();});
  const sub=listen<MenuData>('rule-menu-changed',event=>{window.__ruleMenu=event.payload;update();});
  return()=>{window.removeEventListener('rule-menu-ready',update);document.body.classList.remove('rule-menu-root');void sub.then(off=>off());void position.then(off=>off());void preferences.then(off=>off());};
 },[]);
 return <div className="rule-menu-panel" onScroll={updatePointer} onMouseLeave={()=>setHovered(null)} onKeyDown={event=>{if(event.key==='Escape')void call('hide_rule_menu');}}>{menu?.entries.map(entry=><button key={entry.id} data-rule-id={entry.id} type="button" className={hovered===entry.id?"is-hovered":""} onMouseMove={()=>setHovered(entry.id)} onMouseEnter={()=>setHovered(entry.id)} onMouseDown={event=>event.preventDefault()} onClick={()=>{void emitTo('main','clip-menu-action',{id:menu.id,action:`rule-${entry.id}`});void call('hide_rule_menu');}}>{entry.label}</button>)}</div>;
}
