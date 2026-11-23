import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ScriptRule } from '../lib/js-rules';
import { tr } from '../i18n';

export function RuleListPopover({anchor,rules,onClose,onSelect}:{anchor:HTMLElement;rules:ScriptRule[];onClose:()=>void;onSelect:(index:number)=>void}) {
 const root=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState({left:0,top:0,maxHeight:0});
 useLayoutEffect(()=>{
  const align=()=>{
   if(!anchor.isConnected){onClose();return;}
   const box=anchor.getBoundingClientRect(),height=Math.min(360,Math.max(36,rules.length*33+10));
   const below=window.innerHeight-box.bottom-8,above=box.top-8;
   const down=below>=height||below>=above;
   const maxHeight=Math.max(0,Math.min(height,down?below:above));
   setPosition({left:Math.max(6,Math.min(box.left,window.innerWidth-182)),top:down?box.bottom+4:Math.max(6,box.top-maxHeight-4),maxHeight});
  };
  align();window.addEventListener('resize',align);document.addEventListener('scroll',align,true);
  const observer=new ResizeObserver(align);observer.observe(anchor);
  return()=>{window.removeEventListener('resize',align);document.removeEventListener('scroll',align,true);observer.disconnect();};
 },[anchor,rules.length,onClose]);
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target)&&!anchor.contains(event.target))onClose();};
  document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);
 },[anchor,onClose]);
 return <div ref={root} className="inline-rule-list" role="menu" aria-label={tr('快捷处理')} style={position} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}}>{rules.length?rules.map((rule,index)=><button type="button" role="menuitem" key={rule.id} onMouseDown={event=>event.preventDefault()} onClick={()=>onSelect(index)}>{tr(rule.name)}</button>):<p>{tr('没有可用规则')}</p>}</div>;
}
