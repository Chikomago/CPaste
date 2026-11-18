import {tr} from '../i18n';
import {defaultScriptRules,type ScriptRule} from '../lib/js-rules';

type Props={disabled:boolean;onApply:(id:string)=>void;rules?:ScriptRule[]};
export function QuickTextTools({disabled,onApply,rules}:Props){
 const entries=(rules??defaultScriptRules().filter(rule=>(rule.target??'text')==='text')).filter(rule=>rule.enabled);
 return <div className="editor-quick-tools" role="group" aria-label={tr('快捷处理')}><div className="quick-tool-list">{entries.map(rule=><div className="quick-rule-row" key={rule.id}><button className="quick-rule-main" type="button" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>onApply(rule.id)}>{tr(rule.name)}</button></div>)}</div></div>;
}
