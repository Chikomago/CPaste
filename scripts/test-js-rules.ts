import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScriptRules, mergeScriptRules,newImageScriptCode,newRuleCode } from '../src/lib/js-rules';
import { textTools } from '../src/lib/text-tools';
import { runScript } from '../src/lib/js-runner';
import { runRegex } from '../src/lib/regex-runner';

test('generated editable JavaScript matches the source text algorithms',()=>{
  const samples=['  hello\n\n\nworld  ','一、准备\n二：执行\n③完成','第一句。第二句！版本3.14正常。','测试CPaste,内容!','http删s://githu除b.c我om/a','说明：https://example.com/a?x=1中文other.test/a_2。','`代码abc` https://example.com/a?x=1','很长的中文文本'.repeat(20)];
  for(const tool of textTools){const rule=defaultScriptRules().find(rule=>rule.id===tool.id)!;const transform=new Function(rule.code+'\nreturn transform;')();for(const text of samples)assert.equal(transform(text),tool.apply(text),tool.id);}
});
test('overrides replace defaults and new rules appear once',()=>{
  const original=defaultScriptRules()[0];const edited={...original,name:'changed',code:'function transform(text){return text;}'};const custom={id:'custom:test',name:'custom',code:edited.code,enabled:true};
  const merged=mergeScriptRules([edited,custom]);assert.equal(merged.filter(rule=>rule.id===edited.id).length,1);assert.equal(merged.find(rule=>rule.id===edited.id)!.name,'changed');assert.equal(merged.at(-1),custom);
});
test('script and regex execution call Rust with a record ID instead of executing in the WebView',async()=>{
  let request:any=null;(globalThis as any).window={__TAURI_INTERNALS__:{invoke:async(command:string,args:any)=>{request={command,args};return {text:'native result',html:null,rtf:null};}}};
  const code='function transform(text){return text.toUpperCase();}';
  assert.equal((await runScript(code,{text:'stale input'},false,42)).text,'native result');
  assert.equal(request.command,'execute_js_rule');assert.equal(request.args.id,42);assert.equal(request.args.code,code);assert.equal(request.args.validateOnly,false);assert.equal(request.args.text,undefined);
  await runScript(code,{text:'stale input'},true,42);assert.equal(request.args.validateOnly,true);
  const rule={pattern:'[a-z]+',flags:'g',mode:'extract' as const,replacement:''};await runRegex({text:'stale input'},rule,42);assert.equal(request.command,'execute_js_rule');assert.equal(request.args.id,42);assert.deepEqual(request.args.regexRule,rule);
});

test('custom JavaScript regex rules use the standard native validation and execution path',async()=>{
 const {applyScriptRule}=await import('../src/lib/js-execution');let request:any;
 (globalThis as any).window={__TAURI_INTERNALS__:{invoke:async(command:string,args:any)=>{request={command,args};return {text:'abc'};}}};
 const rule={id:'custom:regex-js',name:'提取',enabled:true,code:'function transform(text){return (text.match(/[a-z]+/g) ?? []).join("\\n");}',kind:'js' as const};
 await applyScriptRule(rule,{text:'abc123'},true,42);assert.equal(request.command,'execute_js_rule');assert.equal(request.args.id,42);assert.equal(request.args.validateOnly,true);assert.equal(request.args.regexRule,null);assert.equal(request.args.code,rule.code);
 await applyScriptRule(rule,{text:'abc123'},false,42);assert.equal(request.args.validateOnly,false);assert.equal(mergeScriptRules([rule]).at(-1)?.code,rule.code);
});

test('Settings test input is sent to Rust only when there is no history record ID',async()=>{
  let request:any;(globalThis as any).window={__TAURI_INTERNALS__:{invoke:async(command:string,args:any)=>{request={command,args};return {text:'SAMPLE'};}}};
  await runScript('function transform(text){return text.toUpperCase();}',{text:'sample'},false);
  assert.equal(request.args.id,null);assert.deepEqual(request.args.testInput,{text:'sample',html:null,rtf:null});
  await runScript('function transform(text){return text;}',{text:'sample'},false,1);assert.equal(request.args.testInput,null);
  await runScript('function transform(text){return text;}',{text:'sample'},true);assert.equal(request.args.testInput,null);
});

test('image rule templates and presets use only plain pixel data',()=>{
 assert.equal(defaultScriptRules().filter(rule=>rule.target==='image').length,7);assert.ok(defaultScriptRules().filter(rule=>rule.target==='image').every(rule=>!rule.code.includes('image.')));
 const input={width:2,height:1,data:new Uint8ClampedArray(8)};const transform=new Function(newImageScriptCode+'\nreturn transform;')();assert.equal(transform(input),input);assert.equal(newRuleCode('image'),newImageScriptCode);assert.doesNotMatch(newImageScriptCode,/image\./);
 const files=defaultScriptRules().find(rule=>rule.id==='files:names')!;assert.equal(new Function(files.code+'\nreturn transform;')()([{name:'a.txt'},{name:'b.pdf'}]),'a.txt\nb.pdf');
 const custom={id:'custom:pixels',name:'自定义像素',target:'image' as const,enabled:true,code:newImageScriptCode};assert.equal(mergeScriptRules([custom]).at(-1),custom);
});

test('media editor validates and dry-runs through Rust without mutating history',async()=>{
 const {applyScriptRule}=await import('../src/lib/js-execution');let request:any;
 (globalThis as any).window={__TAURI_INTERNALS__:{invoke:async(command:string,args:any)=>{request={command,args};return {text:'{"action":"rotate_right"}',token:null,path:null};}}};
 const image={id:'custom:pixels',name:'自定义像素',target:'image' as const,enabled:true,code:newImageScriptCode};
 await applyScriptRule(image,{text:''},true);assert.equal(request.command,'execute_media_rule');assert.equal(request.args.validateOnly,true);assert.equal(request.args.dryRun,true);assert.equal(request.args.testContext,null);
 await applyScriptRule(image,{text:'{"width":100,"height":50}'},false);assert.deepEqual(request.args.testContext,{width:100,height:50});assert.equal(request.args.id,null);
 await applyScriptRule(image,{text:'not JSON'},false,42);assert.equal(request.args.id,42);assert.equal(request.args.testContext,null);
 await assert.rejects(applyScriptRule(image,{text:'not JSON'},false),/JSON/);
});

test('pure JS image presets rotate and flip exact RGBA pixels',()=>{
 const input={width:3,height:2,data:Uint8ClampedArray.from([1,2,3,4,5,6].flatMap(value=>[value,value+10,value+20,value+30]))};
 const expected:Record<string,number[]>={rotate_right:[4,1,5,2,6,3],rotate_left:[3,6,2,5,1,4],flip_horizontal:[3,2,1,6,5,4],flip_vertical:[4,5,6,1,2,3]};
 for(const [name,values]of Object.entries(expected)){const rule=defaultScriptRules().find(rule=>rule.id===`image:${name}`)!;const transform=new Function(rule.code+'\nreturn transform;')();const output=transform(input);assert.deepEqual(Array.from(output.data),values.flatMap(value=>[value,value+10,value+20,value+30]),name);assert.equal(output.width,name.startsWith('rotate')?2:3);assert.equal(output.height,name.startsWith('rotate')?3:2);assert.deepEqual(Array.from(input.data),[1,2,3,4,5,6].flatMap(value=>[value,value+10,value+20,value+30]));}
});

test('JS resize preserves alpha without dark fringes; output rules only declare encoding',()=>{
 const resize=defaultScriptRules().find(rule=>rule.id==='image:resize')!;const run=new Function(resize.code+'\nreturn transform;')();
 assert.deepEqual(run({width:2,height:1,data:new Uint8ClampedArray([255,0,0,255,0,0,255,0])}),{width:1,height:1,data:new Uint8ClampedArray([255,0,0,128])});
 assert.deepEqual(run({width:1,height:1,data:new Uint8ClampedArray([1,2,3,255])}),{width:1,height:1,data:new Uint8ClampedArray([1,2,3,255])});
 for(const [id,format,quality]of [['convert','jpeg',undefined],['compress','jpeg',80]]as const){const rule=defaultScriptRules().find(rule=>rule.id===`image:${id}`)!;const source={width:1,height:1,data:new Uint8ClampedArray(4)};const result=new Function(rule.code+'\nreturn transform;')()(source,{format:"png"});assert.equal(result.data,source.data);assert.equal(result.encoding.format,format);assert.equal(result.encoding.quality,quality);}
});

test('only exact historical default image and file scripts are rewritten',()=>{
 const old={id:'image:rotate_right',name:'我的旋转',target:'image' as const,enabled:false,code:'function transform() {\n  return image.rotate90();\n}'};
 const migrated=mergeScriptRules([old]).find(rule=>rule.id===old.id)!;assert.equal(migrated.name,old.name);assert.equal(migrated.enabled,false);assert.match(migrated.code,/pixels/);assert.doesNotMatch(migrated.code,/image\./);
 const custom={...old,code:'function transform(pixels){pixels.data[0]=100;return pixels;}'};assert.equal(mergeScriptRules([custom]).find(rule=>rule.id===custom.id),custom);
 const oldFile={id:'files:names',name:'文件名',target:'files' as const,enabled:true,code:'function transform(text, context) {\n  return context.files.map(file => file.name).join("\\n");\n}'};assert.match(mergeScriptRules([oldFile]).find(rule=>rule.id===oldFile.id)!.code,/function transform\(files\)/);
});

test('image conversion upgrades the unchanged PNG default and preserves custom encoders',()=>{
 const original=defaultScriptRules().find(rule=>rule.id==='image:convert')!;
 const old={...original,code:'function transform(pixels) {\n  return { ...pixels, encoding: { format: "png" } };\n}'};
 assert.equal(mergeScriptRules([old]).find(rule=>rule.id===old.id)!.code,original.code);
 const custom={...old,code:'function transform(pixels){return {...pixels,encoding:{format:"webp"}};}'};
 assert.equal(mergeScriptRules([custom]).find(rule=>rule.id===custom.id)!.code,custom.code);
 const convert=new Function(original.code+';return transform;')();
 assert.equal(convert({width:1,height:1,data:[]},{format:'png'}).encoding.format,'jpeg');
 assert.equal(convert({width:1,height:1,data:[]},{format:'jpeg'}).encoding.format,'png');
});
