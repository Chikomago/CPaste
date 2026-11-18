import {useRef,useState,type ReactNode} from 'react';
import {tr} from '../i18n';

const initialRatio=.62;
export function RuleEditorSplit({code,test,testColumns=1}:{code:ReactNode;test:ReactNode;testColumns?:1|2}){
 const root=useRef<HTMLDivElement>(null),drag=useRef<{id:number;top:number;height:number}|null>(null);
 const [ratio,setRatio]=useState(initialRatio),[resizing,setResizing]=useState(false);
 const geometry=()=>{const rect=root.current?.getBoundingClientRect();return {top:rect?.top??0,height:Math.max(240,(rect?.height??250)-10)};};
 const update=(pixels:number,height:number)=>setRatio(Math.max(120,Math.min(height-120,pixels))/height);
 return <div ref={root} className={`rule-editor-split ${resizing?'is-resizing':''}`} style={{gridTemplateRows:`minmax(120px,${ratio}fr) 10px minmax(120px,${1-ratio}fr)`}}>
  <div className="rule-code-pane">{code}</div>
  <div role="separator" tabIndex={0} aria-label={tr('调整代码和测试区高度')} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio*100)} className="rule-editor-divider"
   onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();drag.current={id:event.pointerId,...geometry()};event.currentTarget.setPointerCapture?.(event.pointerId);setResizing(true);}}
   onPointerMove={event=>{const current=drag.current;if(current?.id===event.pointerId)update(event.clientY-current.top-5,current.height);}}
   onPointerUp={event=>{if(drag.current?.id!==event.pointerId)return;drag.current=null;setResizing(false);if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
   onPointerCancel={()=>{drag.current=null;setResizing(false);}}
   onLostPointerCapture={()=>{drag.current=null;setResizing(false);}}
   onDoubleClick={()=>setRatio(initialRatio)}
   onKeyDown={event=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const {height}=geometry();update(event.key==='Home'?120:event.key==='End'?height-120:ratio*height+(event.key==='ArrowUp'?-20:20),height);}}/>
  <div className="rule-test-pane" style={{gridTemplateColumns:`repeat(${testColumns},minmax(0,1fr))`}}>{test}</div>
 </div>;
}
