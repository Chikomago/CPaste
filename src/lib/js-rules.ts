import { builtinScriptCode } from './builtin-scripts.generated';
import {imageRuleDefaults,rewriteOriginalImageRule} from './image-rules';
import { textTools } from './text-tools';
export type RuleTarget='text'|'image'|'files';
export type ScriptRule = { id:string; name:string; code:string; enabled:boolean; kind?:'js'; target?:RuleTarget };
export const newScriptCode = `function transform(text) {
  return text.trim();
}`;
export const newImageScriptCode=`function transform(pixels) {\n  return pixels;\n}`;
export const mediaRuleDefaults:ScriptRule[]=[
 {id:'files:names',name:'提取文件名',target:'files',kind:'js',enabled:true,code:`function transform(files) {\n  return files.map(file => file.name).join("\\n");\n}`},
];
export function newRuleCode(target:RuleTarget){return target==='text'?newScriptCode:target==='image'?newImageScriptCode:mediaRuleDefaults.find(rule=>rule.id==='files:names')!.code;}
const formatNames:Record<string,string>={plain:'转纯文本','to-markdown':'转 Markdown','to-rich':'转富文本','strip-markdown':'去掉 Markdown 标记'};
export function defaultScriptRules():ScriptRule[]{
  return [
    ...Object.entries(formatNames).map(([id,name])=>({id,name,enabled:true,code:`function transform(_text, context) {\n  return context.converted;\n}`})),
    ...textTools.map(tool=>({id:tool.id,name:tool.label,enabled:true,code:builtinScriptCode[tool.id]})),
    ...imageRuleDefaults,
    ...mediaRuleDefaults,
  ];
}
export function mergeScriptRules(overrides:ScriptRule[]){
  const previousFileCode='function transform(text, context) {\n  return context.files.map(file => file.name).join("\\n");\n}';
  overrides=overrides.map(rule=>rule.id==='files:names'&&rule.code===previousFileCode?{...rule,code:mediaRuleDefaults[0].code}:rewriteOriginalImageRule(rule));
  const defaults=defaultScriptRules(),ids=new Set(defaults.map(rule=>rule.id));
  return [...defaults.map(rule=>overrides.find(item=>item.id===rule.id)??rule),...overrides.filter(rule=>!ids.has(rule.id))];
}
