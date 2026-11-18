import { mockRuleIpc } from './mock-rule-ipc';
import { toolHistoryAction } from '../src/lib/history-shortcuts';
import { transformRegex } from '../src/lib/regex-transform';
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { autoLineBreaks, togglePunctuation, applyTextTool, applicableTools, cleanLinks, clearInvisible, extractLinks, fullwidthPunctuation, halfwidthPunctuation, spaceChineseEnglish, stripLineNumbers } from '../src/lib/text-tools';
const { window } = new JSDOM('<!doctype html><html><body></body></html>',{pretendToBeVisual:true,url:'http://localhost'});
Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});
Object.assign(globalThis,{ window,document:window.document,Node:window.Node,Element:window.Element,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,DOMParser:window.DOMParser,requestAnimationFrame:window.requestAnimationFrame.bind(window),cancelAnimationFrame:window.cancelAnimationFrame.bind(window),IS_REACT_ACT_ENVIRONMENT:true });
const { convertFormat, rtfToHtml } = await import('../src/lib/format-conversions');
const { createRoot } = await import('react-dom/client');
const { QuickActionsPanel } = await import('../src/components/QuickActionsPanel');
const settle = () => new Promise(resolve => setTimeout(resolve,35));

test('cleanup, deduplication and natural line sorting preserve intended content', () => {
  assert.equal(applyTextTool('trim',{text:' \nhello \n'}).text,'hello');
  assert.equal(applyTextTool('blank-lines',{text:'a\r\n \r\n\r\nb'}).text,'a\n\nb');
  assert.equal(applyTextTool('one-line',{text:' alpha\n beta\r\ngamma '}).text,' alpha betagamma ');
  assert.equal(applyTextTool('ordered-list',{text:'- one\n- two\n\nthree'}).text,'1. one\n2. two\n\n3. three');
  assert.equal(applyTextTool('unordered-list',{text:'1. one\n2. two'}).text,'- one\n- two');
  assert.equal(stripLineNumbers('1 first\n2 second'),'first\nsecond');
  assert.equal(stripLineNumbers('2026 年计划'),'2026 年计划');
  assert.equal(stripLineNumbers('1. first\n2. second'),'first\nsecond');
  assert.equal(applyTextTool('line-numbers',{text:'1.处理内容\n2、保存内容\n3)继续操作'}).text,'处理内容\n保存内容\n继续操作');
  assert.equal(stripLineNumbers('3.14\n12:30\n2026 年计划'),'3.14\n12:30\n2026 年计划');
});
test('Chinese typography protects URLs, code, numbers and emoji joining', () => {
  assert.equal(spaceChineseEnglish('使用CPaste复制2条 `中文code` https://a.test/中文path'),'使用 CPaste 复制 2 条 `中文code` https://a.test/中文path');
  assert.equal(fullwidthPunctuation('你好,世界! version 3.14'),'你好，世界！ version 3.14');
  assert.equal(fullwidthPunctuation('中文 "hello"...再见!'),'中文 “hello”...再见！');
  assert.equal(halfwidthPunctuation('你好，世界！（中文）'),'你好,世界!(中文)');
  assert.equal(clearInvisible('a\u200bb\uFEFF 👨‍👩‍👧‍👦'),'ab 👨‍👩‍👧‍👦');
});
test('punctuation toggles both ways and automatic lines protect decimals, URLs and code', () => {
  const source='你好,世界!(中文)';
  assert.equal(togglePunctuation(source),'你好，世界！（中文）');
  assert.equal(togglePunctuation(togglePunctuation(source)),source);
  assert.equal(togglePunctuation('3.14 https://a.test/a?x=1'),'3.14 https://a.test/a?x=1');
  assert.equal(autoLineBreaks('第一句。第二句！第三句？'),'第一句。\n第二句！\n第三句？');
  assert.equal(autoLineBreaks('版本3.14正常。下一句。'),'版本3.14正常。\n下一句。');
  const technical='`a.b()` https://example.com/a?x=1';assert.equal(autoLineBreaks(technical),technical);
  const long='这是一段没有标点的很长文本'.repeat(10);const broken=autoLineBreaks(long);
  assert.ok(broken.includes('\n'));assert.equal(broken.replaceAll('\n',''),long);assert.equal(autoLineBreaks(broken),broken);
});
test('link tools repair Chinese-obfuscated URLs and extract ASCII fragments', () => {
  assert.equal(cleanLinks('http删s://githu除b.c我om/onblog/miaomiao-bar/blob/main/docs/screenshots/panel-main-dark.png'),'https://github.com/onblog/miaomiao-bar/blob/main/docs/screenshots/panel-main-dark.png');
  assert.equal(cleanLinks('中文说明 https://example.com/?utm_source=test'),'中文说明 https://example.com/?utm_source=test');
  assert.equal(extractLinks('说明：https://example.com/a?x=1中文other.test/a_2。'),'https://example.com/a?x=1\nother.test/a_2');
  assert.equal(extractLinks('纯中文内容'),'');
  assert.ok(!applicableTools('纯中文内容').some(tool=>tool.id==='extract-links'));
});
test('custom regex extracts, replaces, and rejects empty or invalid results', () => {
  assert.equal(transformRegex('abc123中文def456',{pattern:'[a-z]+',flags:'g',mode:'extract',replacement:''}).text,'abc\ndef');
  assert.equal(transformRegex('a1 b2',{pattern:'([a-z])(\\d)',flags:'g',mode:'replace',replacement:'$2$1'}).text,'1a 2b');
  assert.throws(()=>transformRegex('abc',{pattern:'[',flags:'g',mode:'extract',replacement:''}));
  assert.throws(()=>transformRegex('abc',{pattern:'xyz',flags:'g',mode:'extract',replacement:''}));
});
test('Markdown and HTML convert headings, emphasis, links, code and tables', async () => {
  const markdown = '# Title\n\n**bold** and *italic* [site](https://example.com)\n\n```js\nconst a = 1;\n```';
  const rich = await convertFormat('to-rich',{text:markdown});
  assert.equal(rich.text,markdown); assert.match(rich.html!,/<strong>bold<\/strong>/); assert.match(rich.html!,/<code/);
  const back = await convertFormat('to-markdown',rich);
  assert.match(back.text,/# Title/); assert.match(back.text,/\*\*bold\*\*/); assert.match(back.text,/\[site\]\(https:\/\/example.com\)/);
  const table = await convertFormat('to-markdown',{text:'Name Value\na 1',html:'<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>a</td><td>1</td></tr></tbody></table>'});
  assert.match(table.text,/\| Name \| Value \|/);
  const plain = await convertFormat('strip-markdown',{text:markdown});
  assert.match(plain.text,/bold and italic site/); assert.doesNotMatch(plain.text,/\*\*|```/);
});
test('Word inline formatting and RTF Unicode survive rich-text conversion', async () => {
  const word = await convertFormat('to-markdown',{text:'Bold Italic',html:'<p><span style="font-weight:700">Bold</span> <span style="font-style:italic">Italic</span></p>'});
  assert.match(word.text,/\*\*Bold\*\*/); assert.match(word.text,/\*Italic\*/);
  const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\uc1\u20320?\u22909? \b bold\b0\par\i italic\i0 \u-10179?\u-8704?}`;
  const html = rtfToHtml(rtf); assert.match(html,/你好/); assert.match(html,/<strong>bold<\/strong>/); assert.match(html,/😀/); assert.doesNotMatch(html,/Arial/);
  assert.match(rtfToHtml(String.raw`{\rtf1\ansi\ansicpg936 \'c4\'e3\'ba\'c3}`),/你好/);
  const result = await convertFormat('to-markdown',{text:'你好 bold italic 😀',rtf});
  assert.match(result.text,/\*\*bold\*\*/); assert.match(result.text,/\*italic\*/);
});
test('conversion strips executable markup and can recover plain text from HTML-only content', async () => {
  const value = await convertFormat('to-rich',{text:'<script>alert(1)</script><img src="https://example.test/image.png" onerror="alert(2)"><a href="javascript:alert(3)">link</a>\n\n**safe**'});
  assert.doesNotMatch(value.html!,/<script|onerror|javascript:/i); assert.match(value.html!,/<strong>safe<\/strong>/);
  assert.equal((await convertFormat('plain',{text:'',html:'<p>Hello</p><p>world</p>'})).text,'Hello\nworld');
});
test('quick actions immediately update the record, offer no editor, and undo with Cmd/Ctrl+Z', async () => {
  let value:any={text:' hello\nhello '};
  const history:any[]=[];const future:any[]=[]; let revision=0;let sourceReads=0;
  const clip:any={id:30001,kind:'text',plain_text:value.text,sensitive_masked:false};
  mockRuleIpc([],command=>{if(command==='get_transform_source'){sourceReads++;return value;}});
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  const render=()=>root.render(<QuickActionsPanel clip={{...clip,plain_text:value.text,updated_at:String(revision)}} busy={false} canUndo={history.length>0} canRedo={future.length>0} onClose={()=>{}} onApply={async(id,source)=>{future.length=0;history.push(source);value=applyTextTool(id,source);clip.plain_text=value.text;revision++;render();return value;}} onRedo={async()=>{history.push(value);value=future.pop();clip.plain_text=value.text;revision++;render();return value;}} onUndo={async()=>{future.push(value);value=history.pop();clip.plain_text=value.text;revision++;render();return value;}}/>);
  await act(async()=>{render();await settle();});
  const button=(label:string)=>[...container.querySelectorAll('button')].find(button=>button.textContent===label) as HTMLButtonElement;
  assert.equal(container.querySelector('textarea'),null);
  for(const label of ['去掉行号','去重行','标点转全角','标点转半角'])assert.equal(button(label),undefined);
  for(const label of ['转纯文本','转 Markdown','转富文本','去掉 Markdown 标记','去首尾空白','合并空行','移除换行','中英文间加空格','半角全角互转','自动分行','有序列表','无序列表','净化链接','提取链接'])assert.ok(button(label),label);
  assert.equal(button('添加自定义规则'),undefined);assert.equal(button('添加自定义 JS'),undefined);assert.equal(container.querySelector('details'),null);const toolBody=container.querySelector('.quick-actions-body')!;toolBody.scrollTop=80;
  await act(async()=>{button('去首尾空白').click();await settle();});assert.equal(clip.plain_text,'hello\nhello');
  await act(async()=>{button('有序列表').click();await settle();});assert.equal(clip.plain_text,'1. hello\n2. hello');
  const panel=container.querySelector('section')!;
  await act(async()=>{panel.dispatchEvent(new window.KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true,cancelable:true}));await settle();});assert.equal(clip.plain_text,'hello\nhello');
  await act(async()=>{panel.dispatchEvent(new window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));await settle();});assert.equal(clip.plain_text,' hello\nhello ');
  assert.equal(container.querySelector('textarea'),null);
  for (const keys of [{key:'z',metaKey:true,shiftKey:true},{key:'z',ctrlKey:true,shiftKey:true}]) {
    await act(async()=>{panel.dispatchEvent(new window.KeyboardEvent('keydown',{...keys,bubbles:true,cancelable:true}));await settle();});
  }
  assert.equal(clip.plain_text,'1. hello\n2. hello');
  await act(async()=>{panel.dispatchEvent(new window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));await settle();});
  await act(async()=>{panel.dispatchEvent(new window.KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true,cancelable:true}));await settle();});
  assert.equal(clip.plain_text,'1. hello\n2. hello');
  await act(async()=>{panel.dispatchEvent(new window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));await settle();});
  await act(async()=>{button('移除换行').click();await settle();});
  assert.equal(future.length,0);
  assert.equal((container.querySelector('[aria-label="重做上一步处理"]') as HTMLButtonElement).disabled,true);
  assert.equal(sourceReads,1,'applying, undoing and redoing must not reload the source');
  assert.equal(container.querySelector('.quick-actions-body'),toolBody);assert.equal(toolBody.scrollTop,80);
  await act(async()=>root.unmount());container.remove();
});

test('text rules remain clickable without content applicability filtering', async () => {
  const { QuickTextTools } = await import('../src/components/QuickTextTools');
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);let calls=0;
  await act(async()=>root.render(<QuickTextTools disabled={false} onApply={()=>{calls++;}}/>));
  const button=[...container.querySelectorAll('button')].find(button=>button.textContent==='提取链接')!;
  assert.equal(button.disabled,false);
  await act(async()=>button.click());assert.equal(calls,1);
  await act(async()=>root.render(<QuickTextTools disabled onApply={()=>{calls++;}}/>));assert.ok([...container.querySelectorAll('button')].every(button=>button.disabled));
  await act(async()=>root.unmount());container.remove();
});

test('numbered Chinese instructions and ordinary words are not link fragments', async () => {
  const text='1. 处理后可继续编辑、撤销、复制或粘贴。2. 点击“保存”才更新原条目，支持保留转换后的富文本。3. 独立“文字工具”入口已移除。4. 工具整合至“编辑内容 → 快捷处理”。';
  assert.equal(extractLinks(text),'');
  assert.equal(extractLinks('2026/11/16 123 3.14 hello world'),'');
  assert.equal(extractLinks('网址 github.com/onblog 路径 /docs/panel.png 参数 ?id=12'),'github.com/onblog\n/docs/panel.png\n?id=12');
  const { QuickTextTools } = await import('../src/components/QuickTextTools');
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);let calls=0;
  await act(async()=>root.render(<QuickTextTools disabled={false} onApply={()=>{calls++;}}/>));
  const button=[...container.querySelectorAll('button')].find(button=>button.textContent==='提取链接')!;
  assert.equal(button.disabled,false);await act(async()=>button.click());assert.equal(calls,1);
  await act(async()=>root.unmount());container.remove();
});

test('automatic lines keep numbered prefixes attached to the supplied Chinese instructions', () => {
  const text='1.处理后可继续编辑、撤销、复制或粘贴。2.点击“保存”才更新原条目，支持保留转换后的富文本。3.独立“文字工具”入口已移除。4.工具整合至“编辑内容 → 快捷处理”，默认收起。测试和构建通过。点击条目的编辑按钮即可查看。第 2 步（共 2 步）完成，开发版已更新。';
  const expected=['1.处理后可继续编辑、撤销、复制或粘贴。','2.点击“保存”才更新原条目，支持保留转换后的富文本。','3.独立“文字工具”入口已移除。','4.工具整合至“编辑内容 → 快捷处理”，默认收起。','测试和构建通过。','点击条目的编辑按钮即可查看。','第 2 步（共 2 步）完成，开发版已更新。'].join('\n');
  assert.equal(autoLineBreaks(text),expected);
  assert.equal(autoLineBreaks(expected),expected);
  for (const numbered of ['1. 第一项。2. 第二项。','1. First item. 2. Second item.','1)第一项。2)第二项。','1、第一项。2、第二项。']) {
    const result=autoLineBreaks(numbered);
    assert.ok(!result.split('\n').some(line=>/^\d+[.)、]\s*$/.test(line)),result);
    assert.match(result,/1[.)、] ?(?:第一项|First item)/);
    assert.match(result,/2[.)、] ?(?:第二项|Second item)/);
  }
});

test('content patches update only one record and duplicate native replies preserve references', async () => {
  const { patchClipContent }=await import('../src/lib/clip-content');
  const first:any={id:1,kind:'text',title:'old',plain_text:'old',updated_at:'before',sensitive_masked:false,pinned:true,favorite:true};
  const second:any={...first,id:2};const clips=[first,second];
  const patch:any={updated_id:1,kind:'rich',title:'new',plain_text:'new',updated_at:'after',sensitive_masked:false};
  const next=patchClipContent(clips,patch);
  assert.equal(next[1],second);assert.equal(next[0].plain_text,'new');assert.equal(next[0].pinned,true);assert.equal(next[0].favorite,true);
  assert.equal(patchClipContent(next,patch),next);
});

test('history shortcuts support standard undo and redo modifiers', () => {
  const event={key:'z',metaKey:false,ctrlKey:true,shiftKey:false,altKey:false};
  assert.equal(toolHistoryAction(event),'undo');
  assert.equal(toolHistoryAction({...event,shiftKey:true}),'redo');
  assert.equal(toolHistoryAction({...event,ctrlKey:false,metaKey:true,shiftKey:true}),'redo');
  assert.equal(toolHistoryAction({...event,key:'y'}),'redo');
  assert.equal(toolHistoryAction({...event,altKey:true}),null);
  assert.equal(toolHistoryAction({...event,ctrlKey:false}),null);
});

test('line-number removal recognizes Chinese, brackets, Unicode markers and colon lists conservatively', () => {
  for (const [text,expected] of [
    ['一、准备\n二：执行\n三．完成','准备\n执行\n完成'],
    ['（一）准备\n(二)：执行\n【3】完成\n[４]：检查','准备\n执行\n完成\n检查'],
    ['第一步：准备\n第二项、执行\n第三：完成','准备\n执行\n完成'],
    ['①准备\n❷执行\n⑶完成\n⒈检查\n㈠继续\nⒶ结束','准备\n执行\n完成\n检查\n继续\n结束'],
    ['１：准备\n２．执行\n３)完成','准备\n执行\n完成'],
    ['壹、准备\n贰：执行\n叁、完成','准备\n执行\n完成'],
    ['A. Prepare\nB: Execute\nC) Finish','Prepare\nExecute\nFinish'],
    ['I. Prepare\nII. Execute\nIII. Finish','Prepare\nExecute\nFinish'],
    ['A. Prepare\n\nB. Execute','Prepare\n\nExecute'],
    ['Ⅰ．准备\nⅡ．执行','准备\n执行'],
    ['• 准备\n- 执行\n* 完成\n→ 检查','准备\n执行\n完成\n检查'],
    ['：准备\n：执行','准备\n执行'],
    ['一 准备\n二 执行\n三 完成','准备\n执行\n完成'],
    ['1. 123\n2. 456','123\n456'],
    ['  （一）准备\r\n  （二）执行','  准备\r\n  执行'],
  ]) assert.equal(stripLineNumbers(text),expected,text);
  const protectedText='时间：12:30\n12:30\n１２：３０\n3.14\n2026.11.16\n2026 年计划\n说明：这是正文\nhttps://example.com/a:123\nI. am a sentence\nA: a single field\n-12\n--flag value\n*ptr\n：单独一行正文\n第一天开始工作';
  assert.equal(stripLineNumbers(protectedText),protectedText);
});

test('Settings rule management synchronizes enable and deletion to an open sidebar without rereading history',async()=>{
  const {RuleManager}=await import('../src/components/RuleManager');
  const custom={id:'custom:sync',name:'同步规则',code:'function transform(text){return text;}',enabled:true,kind:'js' as const};
  const native=mockRuleIpc([custom],command=>{if(command==='get_transform_source')return {text:'hello'};throw Error('Unexpected call: '+command);});
  const manager=document.createElement('div'),sidebar=document.createElement('div');document.body.append(manager,sidebar);const a=createRoot(manager),b=createRoot(sidebar);
  await act(async()=>{a.render(<RuleManager/>);b.render(<QuickActionsPanel clip={{id:10,kind:'text',plain_text:'hello',updated_at:'now'} as any} busy={false} canUndo={false} onClose={()=>{}} onApply={async(_id,source)=>source} onUndo={async()=>{}}/>);await settle();});
  const inSidebar=()=>[...sidebar.querySelectorAll('button')].some(button=>button.textContent==='同步规则');
  const toggle=()=>manager.querySelector<HTMLInputElement>('[aria-label="启用规则：同步规则"]')!;
  assert.ok(inSidebar());assert.ok(Array.from(manager.querySelectorAll('.rule-manager-description small')).every(node=>!node.textContent?.includes('JavaScript')));assert.equal(toggle().checked,true);assert.equal(native.listeners.size,2);
  await act(async()=>{toggle().click();await settle();});assert.equal(toggle().checked,false);assert.equal(inSidebar(),false);
  await act(async()=>{toggle().click();await settle();});assert.equal(inSidebar(),true);
  await act(async()=>{manager.querySelector<HTMLButtonElement>('[aria-label="删除规则：同步规则"]')!.click();});
  const confirm=document.querySelector('[role="alertdialog"]')!;assert.ok(confirm.textContent?.includes('不会删除剪贴板记录'));
  await act(async()=>{confirm.querySelectorAll<HTMLButtonElement>('button').item(1).click();await settle();});
  assert.equal(inSidebar(),false);assert.equal(toggle(),null);assert.equal(native.rules.length,0);
  assert.equal(native.calls.filter(call=>call.command==='get_js_rules').length,2);
  assert.equal(native.calls.filter(call=>call.command==='get_transform_source').length,1);
  assert.equal(native.calls.some(call=>call.command==='list_clips'||call.command==='delete_clip'),false);
  await act(async()=>{a.unmount();b.unmount();await settle();});assert.equal(native.listeners.size,0);manager.remove();sidebar.remove();
});

test('media rule editor tests JSON directly without file selection or drag listeners',async()=>{
 const {CustomRuleEditor}=await import('../src/components/CustomRuleEditor');const {newImageScriptCode}=await import('../src/lib/js-rules');
 const ipc=mockRuleIpc([],async(command,args)=>command==='execute_media_rule'?{text:args.target==='image'?'2 × 2':args.testContext.files.map((file:any)=>file.name).join('\n')}:null);
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const rule={id:'custom:pixels',name:'像素规则',target:'image' as const,enabled:true,code:newImageScriptCode};
 await act(async()=>{root.render(<CustomRuleEditor rule={rule} source={{text:''}} onClose={()=>{}} onSave={async()=>{}} onDelete={async()=>{}}/>);await settle();});
 const dialog=()=>document.querySelector('[role="dialog"]')!;const button=(text:string)=>Array.from(dialog().querySelectorAll('button')).find(button=>button.textContent===text)as HTMLButtonElement;
 const input=dialog().querySelector('textarea[aria-label="测试数据（JSON）"]')as HTMLTextAreaElement;assert.ok(input);const source=JSON.parse(input.value);assert.equal(source.data.length,source.width*source.height*4);
 const pane=dialog().querySelector('.rule-test-pane')as HTMLElement;const resultPane=pane.querySelector('.rule-test-result');const split=dialog().querySelector('.rule-editor-split')as HTMLElement;const rows=split.style.gridTemplateRows;assert.equal(pane.children.length,2);assert.equal(pane.style.gridTemplateColumns,'repeat(2,minmax(0,1fr))');assert.ok(resultPane?.querySelector('.rule-test-placeholder'));
 assert.doesNotMatch(dialog().textContent!,/拖入|选择文件|高级 JSON|使用图片／文件/);assert.equal(dialog().querySelector('[type="file"]'),null);assert.equal(ipc.listeners.size,0);
 await act(async()=>{button('试运行').click();await settle();});const request=ipc.calls.find(call=>call.command==='execute_media_rule')!;assert.deepEqual(request.args.testContext,source);assert.equal(request.args.dryRun,true);assert.equal(request.args.id,null);assert.match(dialog().querySelector('[aria-label="试运行结果"]')!.textContent!,/2 × 2/);assert.equal(pane.querySelector('.rule-test-result'),resultPane);assert.equal(pane.children.length,2);assert.equal(dialog().querySelector('textarea[aria-label="测试数据（JSON）"]'),input);assert.equal(split.style.gridTemplateRows,rows);
 await act(async()=>button('文件').click());assert.ok(dialog().querySelector('textarea[aria-label="测试数据（JSON）"]'));
 await act(async()=>{button('试运行').click();await settle();});assert.equal(ipc.calls.filter(call=>call.command==='execute_media_rule').at(-1)!.args.target,'files');assert.match(dialog().querySelector('[aria-label="试运行结果"]')!.textContent!,/example.txt/);
 assert.ok(ipc.calls.every(call=>call.command==='execute_media_rule'));await act(async()=>root.unmount());container.remove();
});

test('rule editor divider resizes with pointer and keyboard without remounting inputs',async()=>{
 const {RuleEditorSplit}=await import('../src/components/RuleEditorSplit');const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>root.render(<RuleEditorSplit code={<textarea defaultValue="keep code"/>} test={<textarea defaultValue="keep JSON"/>}/>));
 const split=container.querySelector('.rule-editor-split')as HTMLElement;split.getBoundingClientRect=()=>({top:10,left:0,width:500,height:410,bottom:420,right:500,x:0,y:10,toJSON:()=>({})});
 const divider=container.querySelector('[role="separator"]')as HTMLElement;const code=container.querySelector('textarea');const testInput=container.querySelectorAll('textarea')[1];
 let capture=false;(divider as any).setPointerCapture=()=>{capture=true;};(divider as any).hasPointerCapture=()=>capture;(divider as any).releasePointerCapture=()=>{capture=false;};
 const pointer=(type:string,y:number)=>{const event=new window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientY:y});Object.defineProperty(event,'pointerId',{value:7});divider.dispatchEvent(event);};
 const before=split.style.gridTemplateRows;
 await act(async()=>{pointer('pointerdown',250);pointer('pointermove',150);});assert.notEqual(split.style.gridTemplateRows,before);assert.equal(capture,true);assert.equal(divider.getAttribute('aria-valuenow'),'34');
 await act(async()=>pointer('pointermove',-1000));assert.equal(divider.getAttribute('aria-valuenow'),'30');
 await act(async()=>{pointer('pointermove',10000);pointer('pointerup',10000);});assert.equal(divider.getAttribute('aria-valuenow'),'70');assert.equal(capture,false);
 const finished=split.style.gridTemplateRows;await act(async()=>pointer('pointermove',150));assert.equal(split.style.gridTemplateRows,finished);
 await act(async()=>divider.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true})));assert.equal(divider.getAttribute('aria-valuenow'),'30');
 await act(async()=>divider.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})));assert.equal(divider.getAttribute('aria-valuenow'),'35');
 await act(async()=>divider.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true})));assert.equal(divider.getAttribute('aria-valuenow'),'62');
 assert.equal(container.querySelector('textarea'),code);assert.equal(container.querySelectorAll('textarea')[1],testInput);assert.equal(code?.value,'keep code');assert.equal(testInput.value,'keep JSON');
 await act(async()=>root.unmount());container.remove();
});

test('rule names are consistent in Chinese and English while retaining existing translation keys',async()=>{
 const {setLanguage,tr,trNotice}=await import('../src/i18n');
 setLanguage('zh-CN');assert.equal(tr('快捷处理'),'规则');assert.equal(tr('快捷处理规则'),'规则');assert.equal(tr('在设置中启用快捷处理规则'),'在设置中启用规则');assert.equal(trNotice('操作未完成：记录内容已变化，请重新打开快捷处理'),'操作未完成：记录内容已变化，请重新打开规则');
 setLanguage('en-US');assert.equal(tr('快捷处理'),'Rules');assert.equal(tr('快捷处理规则'),'Rules');setLanguage('zh-CN');
});

test('rule backup exports complete rules and restoring waits for explicit confirmation',async()=>{
 const {RuleManager}=await import('../src/components/RuleManager');
 const imported=[{id:'custom:imported',name:'Imported',code:'function transform(text){return text;}',enabled:false,target:'text'}];
 const ipc=mockRuleIpc([],command=>command==='choose_rules_backup'?imported:undefined);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>{root.render(<RuleManager/>);await settle();});
 const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent===text)!;
 await act(async()=>{button('备份规则').click();await settle();});
 const backup=ipc.calls.find(call=>call.command==='backup_rules')!;assert.ok(backup.args.rules.some((rule:any)=>rule.id==='image:convert'));
 await act(async()=>{button('恢复规则').click();await settle();});
 assert.equal(ipc.calls.some(call=>call.command==='restore_rules'),false);
 assert.match(document.querySelector('[role="alertdialog"]')!.textContent!,/覆盖当前全部规则/);
 await act(async()=>{document.querySelector<HTMLButtonElement>('[role="alertdialog"] .destructive')!.click();await settle();});
 assert.deepEqual(ipc.calls.find(call=>call.command==='restore_rules')!.args.rules,imported);
 await act(async()=>root.unmount());host.remove();
});

test('developer logging records outcomes and timings without command payloads',async()=>{
 const {call}=await import('../src/lib/api');
 let enabled=false;
 const ipc=mockRuleIpc([],command=>{if(command==='get_preferences')return {developer_mode:enabled};if(command==='bad_operation')throw Error('secret clipboard text');return null;});
 await call('get_preferences');await call('copy_clip',{text:'private text'});
 assert.equal(ipc.calls.filter(call=>call.command==='record_diagnostic').length,0);
 enabled=true;await call('get_preferences');await call('copy_clip',{text:'private text'});
 await assert.rejects(call('bad_operation',{code:'private rule'}));
 const logs=ipc.calls.filter(call=>call.command==='record_diagnostic');
 assert.ok(logs.some(call=>call.args.command==='copy_clip'&&call.args.phase==='ok'));
 assert.ok(logs.some(call=>call.args.command==='bad_operation'&&call.args.phase==='error'));
 assert.equal(JSON.stringify(logs).includes('private'),false);assert.equal(JSON.stringify(logs).includes('secret'),false);
 await call('save_preferences',{preferences:{developer_mode:false}});const count=ipc.calls.filter(call=>call.command==='record_diagnostic').length;
 await call('copy_clip');assert.equal(ipc.calls.filter(call=>call.command==='record_diagnostic').length,count);
});
