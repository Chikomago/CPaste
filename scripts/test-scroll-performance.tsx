import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import {mockRuleIpc} from './mock-rule-ipc';
import { MediaCache } from '../src/lib/media-cache';
import type { Clip, TriggerEdge } from '../src/types';

const window = new Window();
Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});
Object.assign(globalThis, { window, document: window.document,  HTMLElement: window.HTMLElement,
  HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,HTMLSelectElement:window.HTMLSelectElement,
  Element: window.Element, Node: window.Node, getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true });
let viewport = { width: 350, height: 500 };
const size = (node: HTMLElement) => node.classList.contains('virtual-clip-list') ? viewport : {
  width: parseFloat(node.style.width) || viewport.width,
  height: parseFloat(node.style.height) || 74,
};
for (const [property, axis] of [['offsetWidth', 'width'], ['clientWidth', 'width'], ['offsetHeight', 'height'], ['clientHeight', 'height']] as const) {
  Object.defineProperty(window.HTMLElement.prototype, property, { get() { return size(this)[axis]; } });
}
Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { get() { return 100000; } });
Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', { get() { return 100000; } });
window.HTMLElement.prototype.getBoundingClientRect = function () { const { width, height } = size(this); return { width, height, x: 0, y: 0, top: 0, left: 0, bottom: height, right: width, toJSON() {} }; };
window.HTMLElement.prototype.scrollTo = function (options: ScrollToOptions | number, y?: number) {
  if (typeof options === 'number') { this.scrollLeft = options; this.scrollTop = y ?? 0; }
  else { if (options.top !== undefined) this.scrollTop = options.top; if (options.left !== undefined) this.scrollLeft = options.left; }
  this.dispatchEvent(new window.Event('scroll'));
};
const resizeObservers = new Set<ResizeObserver>();
class ResizeObserver {
  private nodes = new Set<HTMLElement>();
  constructor(private callback: (entries: unknown[]) => void) { resizeObservers.add(this); }
  trigger() { this.callback([...this.nodes].map(node => ({ target: node, contentRect: node.getBoundingClientRect(), borderBoxSize: [{ inlineSize: size(node).width, blockSize: size(node).height }] }))); }
  observe(node: HTMLElement) { this.nodes.add(node); queueMicrotask(() => this.trigger()); }
  unobserve(node: HTMLElement) { this.nodes.delete(node); }
  disconnect() { this.nodes.clear(); resizeObservers.delete(this); }
}
Object.assign(globalThis, { ResizeObserver });
Object.assign(window, { ResizeObserver });
const { createRoot } = await import('react-dom/client');
const { VirtualClipList } = await import('../src/components/VirtualClipList');
const clips = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, kind: i % 3 === 0 ? 'image' : i % 3 === 1 ? 'rich' : 'text' } as Clip));
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

test('300 mixed records mount only the viewport; keyboard selection reaches the last record in all layouts', async () => {
  for (const edge of ['none', 'left', 'right', 'top', 'bottom'] as TriggerEdge[]) {
    viewport = edge === 'top' || edge === 'bottom' ? { width: 1000, height: 220 } : { width: 350, height: 500 };
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const render = (selectedId: number | null, resetKey = 'initial') => <VirtualClipList clips={clips} edge={edge} columns={2} selectedId={selectedId} resetKey={resetKey} maxLines={2} className="result-list" renderRow={clip => <div key={clip.id} className="result-item" data-clip-id={clip.id}>Record {clip.id}</div>}/>;
    await act(async () => { root.render(render(null)); await settle(); });
    const count = container.querySelectorAll('.result-item').length;
    assert.ok(count > 0 && count < 45, `${edge}: mounted ${count}, expected a bounded viewport`);
    assert.ok(container.querySelector('[data-clip-id="1"]'));
    await act(async () => { root.render(render(300)); await settle(); });
    await act(settle);
    assert.ok(container.querySelector('[data-clip-id="300"]'), `${edge}: last item must mount after keyboard selection`);
    await act(async () => { root.render(render(null, 'new-search')); await settle(); });
    await act(settle);
    assert.ok(container.querySelector('[data-clip-id="1"]'), `${edge}: search resets position`);
    console.log(`${edge}: ${count}/300 cards mounted`);
    await act(async () => root.unmount()); container.remove();
  }
});

test('thumbnail requests deduplicate, cap concurrency and skip cancelled off-screen work', async () => {
  const started: number[] = []; const resolvers: ((value: string | null) => void)[] = [];
  const cache = new MediaCache<number>(id => { started.push(id); return new Promise(resolve => resolvers.push(resolve)); }, 100, 10, 2);
  const a = new AbortController(), b = new AbortController();
  const first = cache.get(1, a.signal), duplicate = cache.get(1, b.signal);
  assert.equal(first, duplicate);
  const second = cache.get(2, a.signal);
  const cancelled = new AbortController();
  const third = cache.get(3, cancelled.signal); cancelled.abort();
  await Promise.resolve(); assert.deepEqual(started, [1, 2]);
  resolvers[0]('one'); resolvers[1]('two');
  assert.deepEqual(await Promise.all([first, duplicate, second, third]), ['one', 'one', 'two', null]);
  assert.deepEqual(started, [1, 2]);
});

test('thumbnail cache evicts by bytes and least recent use; failures can retry', async () => {
  const started: number[] = [];
  const cache = new MediaCache<number>(async id => { started.push(id); if (id === 9 && started.filter(x => x === 9).length === 1) throw Error('temporary'); return '1234'; }, 16, 2);
  const signal = new AbortController().signal;
  for (const id of [1, 2, 1, 3, 2]) await cache.get(id, signal);
  assert.deepEqual(started, [1, 2, 3, 2]);
  assert.equal(await cache.get(9, signal), null);
  assert.equal(await cache.get(9, signal), '1234');
  const tooLarge = new MediaCache<number>(async id => { started.push(id); return 'oversized'; }, 2);
  await tooLarge.get(8, signal); await tooLarge.get(8, signal);
  assert.equal(started.filter(x => x === 8).length, 2);
});

test('cached thumbnails render immediately after remount and stay hidden when masked', async () => {
  let loads = 0;
  (window as any).__TAURI_INTERNALS__ = { convertFileSrc:(path:string)=>'asset://localhost/'+encodeURIComponent(path), invoke: async () => { loads += 1; return 'cached-png'; } };
  class IntersectionObserver {
    constructor(private callback: (entries: unknown[]) => void) {}
    observe() { queueMicrotask(() => this.callback([{ isIntersecting: true }])); }
    disconnect() {}
  }
  Object.assign(globalThis, { IntersectionObserver });
  const { ImageThumbnail } = await import('../src/components/ClipMedia');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const clip = { id: 10001, kind: 'image', sensitive_masked: false } as Clip;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ImageThumbnail clip={clip}/>); await settle(); });
  assert.ok(container.querySelector('img'));
  await act(async () => root.unmount()); container.remove();
  // Server render runs no effects: a cached image must exist in the very first render.
  assert.match(renderToStaticMarkup(<ImageThumbnail clip={clip}/>), /<img/);
  assert.doesNotMatch(renderToStaticMarkup(<ImageThumbnail clip={{ ...clip, sensitive_masked: true }}/>), /<img/);
  assert.equal(loads, 1);
});

test('completed off-screen thumbnails are retained for the next visit', async () => {
  const controller = new AbortController();
  let finish!: (value: string) => void;
  const cache = new MediaCache<number>(() => new Promise(resolve => { finish = resolve; }));
  const request = cache.get(1, controller.signal);
  await Promise.resolve(); controller.abort(); finish('png'); await request;
  assert.equal(cache.peek(1), 'png');
});

test('large image previews reuse the original after close/reopen without another IPC read', async () => {
  let loads = 0;
  (window as any).__TAURI_INTERNALS__ = { convertFileSrc:(path:string)=>'asset://localhost/'+encodeURIComponent(path), invoke: async () => { loads += 1; return 'cached-original'; } };
  const { ContentPreview } = await import('../src/components/ContentPreview');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const clip = { id: 10002, kind: 'image', sensitive_masked: false, created_at: '2026-11-15T00:00:00Z', source_app: '', files: [], file_sizes: [], plain_text: '' } as any;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ContentPreview clip={clip}/>); await settle(); });
  assert.ok(container.querySelector('img'));
  await act(async () => root.unmount());
  const nextRoot = createRoot(container);
  await act(async () => { nextRoot.render(<ContentPreview clip={clip}/>); await settle(); });
  assert.ok(container.querySelector('img'));
  assert.equal(loads, 1);
  assert.match(renderToStaticMarkup(<ContentPreview clip={clip}/>), /cached-original/);
  assert.doesNotMatch(renderToStaticMarkup(<ContentPreview clip={{ ...clip, sensitive_masked: true }}/>), /<img/);
  await act(async () => nextRoot.unmount()); container.remove();
});


test('hiding and reopening the panel preserves already-mounted image nodes', async () => {
  viewport = { width: 350, height: 500 };
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<VirtualClipList clips={clips} edge="none" columns={1} selectedId={null} resetKey="same" maxLines={2} className="result-list" renderRow={clip => <div className="result-item" key={clip.id}><img data-clip-id={clip.id} src="data:image/png;base64,cached"/></div>}/>);
    await settle();
  });
  const image = container.querySelector('[data-clip-id="1"]');
  assert.ok(image);
  await act(async () => { viewport = { width: 0, height: 0 }; [...resizeObservers].forEach(observer => observer.trigger()); await settle(); });
  await act(settle);
  assert.equal(container.querySelector('[data-clip-id="1"]'), image, 'hide must not unmount a decoded image');
  await act(async () => { viewport = { width: 350, height: 500 }; [...resizeObservers].forEach(observer => observer.trigger()); await settle(); });
  await act(settle);
  assert.equal(container.querySelector('[data-clip-id="1"]'), image, 'reopen must reuse the same decoded image node');
  await act(async () => root.unmount()); container.remove();
});

test('closing and reopening the same large preview preserves its decoded image element', async () => {
  let loads = 0;
  (window as any).__TAURI_INTERNALS__ = { convertFileSrc:(path:string)=>'asset://localhost/'+encodeURIComponent(path), invoke: async () => { loads += 1; return 'retained-original'; } };
  const { RetainedPreview } = await import('../src/components/ContentPreview');
  const clip = { id: 10003, kind: 'image', sensitive_masked: false, created_at: '2026-11-15T00:00:00Z', source_app: '', files: [], file_sizes: [], plain_text: '' } as any;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<RetainedPreview clip={clip} active={true}/>); await settle(); });
  const image = container.querySelector('img'); assert.ok(image);
  await act(async () => { root.render(<RetainedPreview clip={null} active={false}/>); await settle(); });
  assert.equal(container.querySelector('img'), image);
  assert.ok(container.querySelector('[hidden]'));
  await act(async () => { root.render(<RetainedPreview clip={clip} active={true}/>); await settle(); });
  assert.equal(container.querySelector('img'), image);
  assert.equal(loads, 1);
  await act(async () => root.unmount()); container.remove();
});

test('details sidebar actions follow selection, item type, language and busy state', async () => {
  const { ClipDetails } = await import('../src/components/ClipDetails');
  const { setLanguage } = await import('../src/i18n');
  setLanguage('zh-CN');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); const actions: unknown[] = [];
  const clip = { id: 20001, kind: 'rich', sensitive_masked: false, created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-15T00:00:00Z', source_app: 'Source', files: [], file_sizes: [], plain_text: 'Selected text', pinned: false, favorite: false, use_count: 3 } as any;
  const render = (value = clip, busy = false) => <ClipDetails clip={value} active expanded busy={busy} onAction={(id, action) => actions.push([id, action])}/>;
  await act(async () => root.render(render()));
  assert.match(container.textContent!, /Selected text/);
  await act(async () => (container.querySelector('button[aria-label="更多粘贴方式"]') as HTMLButtonElement).click());
  assert.ok(container.querySelector('[role="menuitem"][title="粘贴为纯文本"]'));
  assert.ok(container.querySelector('button[title="编辑内容"]'));
 const rulesButton=container.querySelector('button[aria-label="规则"]')!;assert.equal(rulesButton.querySelectorAll('svg').length,1);assert.ok(rulesButton.querySelector('.lucide-workflow'));assert.equal(container.querySelector('.favorite-action svg')?.getAttribute('fill'),'none');
  await act(async () => (container.querySelector('button[title="复制"]') as HTMLButtonElement).click());
  assert.deepEqual(actions, [[20001, 'copy']]);
  await act(async () => root.render(render({ ...clip, id: 20002, kind: 'files', plain_text: '', files: ['/tmp/example.txt'], file_sizes: [12], pinned: true, favorite: true })));
  await act(async () => (container.querySelector('button[aria-label="更多粘贴方式"]') as HTMLButtonElement).click());
  assert.ok(container.querySelector('button[title="粘贴文件路径"]'));
  assert.equal(container.querySelector('button[title="编辑内容"]'), null);
  assert.equal(container.querySelector('button[title="取消置顶"]')?.getAttribute('aria-pressed'), 'true');assert.equal(container.querySelector('.favorite-action.is-active svg')?.getAttribute('fill'),'currentColor');
  await act(async () => (container.querySelector('button[title="删除"]') as HTMLButtonElement).click());
  assert.deepEqual(actions[1], [20002, 'delete']);
  await act(async () => root.render(render(clip, true)));
  assert.ok([...container.querySelectorAll('.clip-details-actions button')].every(button => (button as HTMLButtonElement).disabled));
  setLanguage('en-US');
  await act(async () => root.render(render()));
  await act(async () => (container.querySelector('button[aria-label="Paste options"]') as HTMLButtonElement).click());
  assert.ok(container.querySelector('button[title="Paste plain text"]'));
  assert.equal(container.querySelector('button[aria-label="Collapse sidebar"]'), null);
  assert.equal(container.querySelector('.clip-details-header')?.textContent, '');
  assert.deepEqual([...container.querySelectorAll('.clip-details-toolbar button')].map(button => button.getAttribute('aria-label')), ['Pin', 'Favorites', 'Edit content', 'Delete']);
  setLanguage('zh-CN');
  await act(async () => root.unmount()); container.remove();
});

test('a one-pixel viewport width change does not reset normal-list measured heights', async () => {
  viewport = { width: 350, height: 500 };
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<VirtualClipList clips={clips} edge="none" columns={1} selectedId={null} resetKey="same" maxLines={2} className="result-list" renderRow={clip => <div className="result-item" key={clip.id}>Record {clip.id}</div>}/>); await settle(); });
  await act(settle);
  const height = (container.querySelector('.virtual-list-content') as HTMLElement).style.height;
  await act(async () => { viewport = { width: 351, height: 500 }; [...resizeObservers].forEach(observer => observer.trigger()); await settle(); });
  await act(settle);
  assert.equal((container.querySelector('.virtual-list-content') as HTMLElement).style.height, height, 'normal list must retain measured heights across an insignificant viewport change');
  await act(async () => root.unmount()); container.remove();
});

test('pin/favorite update before persistence finishes, without rereading history', async () => {
  const { ClipFlagMutations, patchClipFlags } = await import('../src/lib/clip-flags');
  const original = [{ ...clips[0], pinned: false, favorite: false }, { ...clips[1], pinned: false, favorite: false }];
  let state = original;
  let finish!: (value: boolean) => void;
  const commands: string[] = [];
  const mutations = new ClipFlagMutations(patch => { state = patchClipFlags(state, patch); }, (command, id) => { commands.push(command); assert.equal(id, original[0].id); return new Promise(resolve => { finish = resolve; }); });
  const pending = mutations.toggle(state[0], 'pinned');
  assert.equal(state[0].pinned, true, 'icon must update while the save is still pending');
  assert.equal(state[1], original[1], 'unrelated records retain identity');
  assert.equal(mutations.overlay(original)[0].pinned, true, 'an older full refresh cannot overwrite the pending state');
  await mutations.toggle(state[0], 'pinned');
  assert.deepEqual(commands, ['toggle_pin']);
  mutations.receive({ updated_id: state[0].id, pinned: true });
  const confirmed = state;
  finish(true); await pending;
  assert.equal(state, confirmed, 'matching event and response do not trigger duplicate state updates');
});

test('failed favorites roll back only that flag; confirmed saves survive a lost response', async () => {
  const { ClipFlagMutations, patchClipFlags } = await import('../src/lib/clip-flags');
  let state = [{ ...clips[0], pinned: true, favorite: false }];
  let reject!: (error: Error) => void;
  const mutations = new ClipFlagMutations(patch => { state = patchClipFlags(state, patch); }, () => new Promise((_, fail) => { reject = fail; }));
  const failed = mutations.toggle(state[0], 'favorite');
  assert.equal(state[0].favorite, true);
  reject(new Error('save failed')); await assert.rejects(failed, /save failed/);
  assert.equal(state[0].favorite, false); assert.equal(state[0].pinned, true);
  const confirmed = mutations.toggle(state[0], 'favorite');
  mutations.receive({ updated_id: state[0].id, favorite: true });
  reject(new Error('response lost')); await confirmed;
  assert.equal(state[0].favorite, true);
});

test('embedded editor stays in its region, preserves drafts while hidden and reports save errors', async () => {
  const { ClipEditor } = await import('../src/components/ClipEditor');
  const clip = { ...clips[1], kind: 'rich', plain_text: 'Original draft' } as Clip;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); let saved = ''; let fail = true; let cancelled = false;
  const render = (active: boolean) => <div hidden={!active}><ClipEditor embedded active={active} clip={clip} busy={false} onCancel={() => { cancelled = true; }} onSave={async content => { if (fail) throw Error('write failed'); saved = content; }}/></div>;
  await act(async () => root.render(render(true)));
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.ok(container.querySelector('[role="region"][aria-label="编辑内容"]'));
  const input = container.querySelector('textarea')!;
  assert.equal(input.value, 'Original draft');
  assert.equal(container.querySelector('.editor-shortcut-bar'), null);
  assert.equal(container.querySelector('#editor-quick-tools'), null);
  await act(async () => root.render(render(false)));
  await act(async () => root.render(render(true)));
  assert.equal(container.querySelector('textarea'), input);
  await act(async () => (container.querySelector('.primary') as HTMLButtonElement).click());
  assert.match(container.querySelector('[role="alert"]')!.textContent!, /write failed/);
  fail = false;
  await act(async () => (container.querySelector('.primary') as HTMLButtonElement).click());
  assert.equal(saved, 'Original draft');
  assert.equal(container.querySelector('button[aria-label="返回详情"]'),null);
  await act(async () => (container.querySelector('.clip-edit-actions button:not(.primary)') as HTMLButtonElement).click());
  assert.equal(cancelled, true);
  await act(async () => root.unmount()); container.remove();
});

test('embedded segmentation composes and submits in the sidebar without a modal', async () => {
  (window as any).__TAURI_INTERNALS__ = { convertFileSrc:(path:string)=>'asset://localhost/'+encodeURIComponent(path), invoke: async (command: string) => { assert.equal(command, 'segment_text'); return ['剪贴板', '内容']; } };
  const { TokenDialog } = await import('../src/components/TokenDialog');
  const clip = { ...clips[1], kind: 'text', plain_text: '剪贴板内容' } as Clip;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); let submitted = '';let copied=''; let closed = false;
  await act(async () => { root.render(<TokenDialog embedded clip={clip} dictionaryKey="test" busy={false} onClose={() => { closed = true; }} onSubmit={async text => { submitted = text; }} onCopy={async text=>{copied=text;}}/>); await settle(); });
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(container.querySelector('.clip-edit-backdrop'), null);
  const word = [...container.querySelectorAll('.token-list button')].find(button => button.textContent === '剪贴板') as HTMLButtonElement;
  await act(async () => word.click());
  assert.equal(container.querySelector('[aria-label="组词区域"]')!.textContent, '剪贴板');
  await act(async()=>{(container.querySelector('.token-transfer-actions button:not(.primary)')as HTMLButtonElement).click();await settle();});
  assert.equal(copied,'剪贴板');assert.equal(closed,false);
  await act(async () => (container.querySelector('.primary') as HTMLButtonElement).click());
  assert.equal(submitted, '剪贴板');
  await act(async () => (container.querySelector('button[aria-label="返回详情"]') as HTMLButtonElement).click());
  assert.equal(closed, true);
  await act(async () => root.unmount()); container.remove();
});

test('media tools use native processing, keep undo after reopening, and expose file actions in the intended rows',async()=>{
 const {MediaQuickTools}=await import('../src/components/MediaQuickTools');
 const {ClipDetails}=await import('../src/components/ClipDetails');
 const calls:any[]=[];let token=0;
 const ipc=mockRuleIpc([{id:'custom:pixels',name:'自定义像素',target:'image',enabled:true,kind:'js',code:'function transform(pixels){pixels.data[0]=42;return pixels;}'}],async(command,args)=>{calls.push({command,args});return command==='image_history'?{token:args.token??++token,path:null}:command==='execute_media_rule'?{token:args.target==='image'?++token:null,path:null,text:'a.txt\nb.pdf'}:null;});
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);const errors:string[]=[];
 const image={...clips[0],id:987654,kind:'image',sensitive_masked:false,file_sizes:[]}as any;
 const render=()=> <MediaQuickTools clip={image} busy={false} onBusy={()=>{}} onError={message=>errors.push(message)}/>;
 await act(async()=>root.render(render()));
 await act(async()=>{(Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='自定义像素')as HTMLButtonElement).click();await settle();});
 assert.equal(calls[0].command,'execute_media_rule');assert.equal(calls[0].args.target,'image');assert.match(calls[0].args.code,/pixels.data/);
 await act(async()=>root.render(<div/>));await act(async()=>root.render(render()));
 const undo=container.querySelector('button[aria-label="撤销"]')as HTMLButtonElement;assert.equal(undo.disabled,false);
 await act(async()=>{undo.click();await settle();});assert.equal(calls[1].args.action,'undo');assert.equal(calls[1].args.token,1);
 await act(async()=>{(container.querySelector('button[aria-label="重做"]')as HTMLButtonElement).click();await settle();});assert.equal(calls[2].args.action,'redo');
 assert.equal(container.querySelector('input[type="number"]'),null);
 assert.equal(container.querySelector('.media-tool-options'),null);assert.match(container.textContent!,/向右旋转/);
 await act(async()=>root.render(<ClipDetails clip={image} active expanded onAction={()=>{}}/>));
 assert.ok(container.querySelector('.clip-details-header button[aria-label="从系统打开"]'));
 assert.ok(container.querySelector('.clip-details-actions button[aria-label="图片另存为"]'));
 assert.ok(container.querySelector('.clip-details-actions button[aria-label="规则"]'));
 const file={...image,id:987655,kind:'files',files:['/tmp/a.txt','/tmp/b.pdf']};
 await act(async()=>root.render(<ClipDetails clip={file} active expanded onAction={()=>{}}/>));
 assert.ok(container.querySelector('.clip-details-header button[aria-label="打开文件位置"]'));
 await act(async()=>root.render(<MediaQuickTools clip={file} busy={false} onBusy={()=>{}} onError={message=>errors.push(message)}/>));
 await act(async()=>{(container.querySelector('button')as HTMLButtonElement).click();await settle();});
 assert.equal(calls.at(-1).command,'execute_media_rule');assert.equal(calls.at(-1).args.target,'files');assert.match(calls.at(-1).args.code,/files.map/);assert.deepEqual(errors,['已复制文件名']);
 await act(async()=>{ipc.emit({rule:{id:'files:names',name:'只取第一个文件',target:'files',kind:'js',enabled:true,code:'function transform(text,context){return context.files[0].name;}'}});await settle();});assert.match(container.textContent!,/只取第一个文件/);
 await act(async()=>{ipc.emit({rule:{id:'files:names',name:'只取第一个文件',target:'files',kind:'js',enabled:false,code:'function transform(text,context){return context.files[0].name;}'}});await settle();});assert.doesNotMatch(container.textContent!,/只取第一个文件/);
 await act(async()=>root.unmount());container.remove();
});

test('invalidated in-flight media is not retained as the current thumbnail',async()=>{
 let finish!:(value:string)=>void;let calls=0;
 const cache=new MediaCache<number>(()=>{calls++;return calls===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve('new image');});
 const first=cache.get(1,new AbortController().signal);await Promise.resolve();cache.invalidate(1);finish('old image');assert.equal(await first,null);assert.equal(cache.peek(1),null);assert.equal(await cache.get(1,new AbortController().signal),'new image');
});

test('quick rule dropdowns close outside the list for text, image and files, but keep inside and trigger clicks',async()=>{
 const {ClipDetails}=await import('../src/components/ClipDetails');const container=document.createElement('div');const outside=document.createElement('button');document.body.append(container,outside);const root=createRoot(container);
 const actions:string[]=[];const pointer=(node:Element)=>node.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true,cancelable:true}));
 for(const kind of ['text','image','files']){
  const clip={...clips[0],id:987650,kind,plain_text:'hello',sensitive_masked:false,files:[],file_sizes:[]}as any;
  const render=(open:boolean)=><ClipDetails clip={clip} active expanded toolsExpanded={open} toolsPanel={<div className="media-quick-tools"><button>自定义规则</button></div>} onAction={(_id,action)=>actions.push(action)}/>;
  await act(async()=>root.render(render(true)));actions.length=0;
  const menu=container.querySelector('#clip-quick-actions')!;const trigger=container.querySelector('[aria-label="规则"]')!;
  await act(async()=>{pointer(menu.querySelector('button')!);pointer(trigger);});assert.deepEqual(actions,[],kind);
  await act(async()=>pointer(container.querySelector('[aria-label="复制"]')!));assert.deepEqual(actions,['close_tools'],kind);
  actions.length=0;const content=container.querySelector('.clip-details-content')!;content.addEventListener('pointerdown',event=>event.stopPropagation(),{once:true});await act(async()=>pointer(content));assert.deepEqual(actions,['close_tools'],kind);
  actions.length=0;await act(async()=>pointer(outside));assert.deepEqual(actions,['close_tools'],kind);
  await act(async()=>root.render(render(false)));actions.length=0;await act(async()=>pointer(outside));assert.deepEqual(actions,[],kind);
 }
 await act(async()=>root.unmount());container.remove();outside.remove();
});

test('cache reset replaces same-ID images and rejects pre-restore in-flight results',async()=>{
 let version='old',resolveOld!:(value:string)=>void,calls=0;
 const cache=new MediaCache<number>(async()=>{calls++;if(calls===1)return new Promise(resolve=>{resolveOld=resolve;});return version;},1024,8,2);
 const old=cache.get(1,new AbortController().signal);await Promise.resolve();cache.clear();version='restored';const fresh=cache.get(1,new AbortController().signal);resolveOld('old');assert.equal(await old,null);assert.equal(await fresh,'restored');assert.equal(cache.peek(1),'restored');
 cache.clear();version='another backup';assert.equal(await cache.get(1,new AbortController().signal),'another backup');
});

test('mounted previews and thumbnails reload after restore even when IDs and timestamps match',async()=>{
 const {ImageThumbnail}=await import('../src/components/ClipMedia');const {ContentPreview}=await import('../src/components/ContentPreview');const {resetImageCaches}=await import('../src/lib/clip-images');let stored='old-original';
 mockRuleIpc([],command=>command==='get_clip_image_path'||command==='get_clip_thumbnail_path'?stored:null);
 const clip={id:987661,kind:'image',created_at:'2026-11-15T00:00:00Z',updated_at:'2026-11-15T00:00:00Z',sensitive_masked:false,files:[],file_sizes:[],plain_text:'',source_app:''}as any;
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);const render=(value:any)=><><ImageThumbnail clip={value}/><ContentPreview clip={value}/></>;
 await act(async()=>{root.render(render(clip));await settle();});assert.equal(container.querySelector('.image-thumbnail img')?.getAttribute('src'),'asset://localhost/old-original');
 stored='restored-original';resetImageCaches();await act(async()=>{root.render(render({...clip}));await settle();});assert.equal(container.querySelector('.image-thumbnail img')?.getAttribute('src'),'asset://localhost/restored-original');assert.equal(container.querySelector('.preview-body img')?.getAttribute('src'),'asset://localhost/restored-original');
 await act(async()=>root.unmount());container.remove();
});

test('a list refresh started before an image patch cannot restore an old preview revision',async()=>{
 const {Picker}=await import('../src/windows/Picker');const {defaults}=await import('../src/preferences');const {resetImageCaches}=await import('../src/lib/clip-images');resetImageCaches();
 const clip={image_size:2048,image_format:'PNG',id:987672,kind:'image',title:'图片',plain_text:'',html:null,rtf:null,files:[],source_app:'Test',source_path:'',created_at:'2026-11-15T00:00:00Z',updated_at:'2026-11-15T00:00:00Z',pinned:false,favorite:false,sensitive_masked:false,use_count:0};let stored='original',defer=false,finish!:(value:any)=>void;
 const ipc=mockRuleIpc([],command=>{if(command==='get_preferences')return {...defaults};if(command==='list_clips')return defer?new Promise(resolve=>{finish=resolve;}):[clip];if(command==='get_clip_image_path'||command==='get_clip_thumbnail_path')return stored;return null;});
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);await act(async()=>{root.render(<Picker/>);await settle();});
 assert.equal(container.querySelector('.image-file-info'),null);
 await act(async()=>{(container.querySelector('[aria-label="展开详情"]')as HTMLButtonElement).click();await settle();});assert.equal(container.querySelector('.preview-body img')?.getAttribute('src'),'asset://localhost/original');assert.ok(container.querySelector('.preview-stats')?.textContent?.includes('PNG'));assert.ok(container.querySelector('.preview-stats')?.textContent?.includes('2 KB'));
 defer=true;await act(async()=>{ipc.emit(null,'clips-changed');await settle();});assert.equal(typeof finish,'function');stored='modified';await act(async()=>{ipc.emit({id:clip.id,revision:'2026-11-15T00:00:01.123Z'},'image-content-changed');await settle();});assert.equal(container.querySelector('.preview-body img')?.getAttribute('src'),'asset://localhost/modified');
 await act(async()=>{finish([clip]);await settle();});assert.equal(container.querySelector('.preview-body img')?.getAttribute('src'),'asset://localhost/modified');await act(async()=>root.unmount());container.remove();
});

test('position shortcut candidates follow the viewport and exclude overscan rows', async () => {
  viewport = {width:350,height:500};
  const container=document.createElement('div');document.body.append(container);
  const root=createRoot(container);let ids:number[]=[];
  const update=(next:number[])=>{ids=next;};
  await act(async()=>{root.render(<VirtualClipList clips={clips} edge="none" columns={1} selectedId={null} resetKey="initial" maxLines={2} className="result-list" onVisibleIds={update} renderRow={clip=><div key={clip.id}>Record {clip.id}</div>}/>);await settle();});
  await act(settle);
  assert.equal(ids[0],1);
  const host=container.querySelector('.virtual-clip-list') as HTMLElement;
  await act(async()=>{host.scrollTo({top:1800});await settle();});
  await act(settle);
  assert.ok(ids.length>0&&ids[0]>1,'scrolling must replace the first shortcut candidate');
  assert.ok(!ids.includes(1),'off-screen records cannot retain number shortcuts');
  await act(async()=>root.unmount());container.remove();
});

test('panel shortcuts work without a selected record and preserve configurable bindings',async()=>{
 const {Picker}=await import('../src/windows/Picker');const {defaults}=await import('../src/preferences');
 const ipc=mockRuleIpc([],command=>command==='get_preferences'?{...defaults,action_shortcuts:{...defaults.action_shortcuts,sidebar:'CommandOrControl+B'}}:command==='list_clips'?[]:null);
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<Picker/>);await settle();});await act(settle);
 const press=async(code:string,key:string,altKey=false,shiftKey=false)=>act(async()=>{
  document.body.dispatchEvent(new window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,code,key,ctrlKey:true,altKey,shiftKey}));await settle();
 });
 await press('KeyF','f');
 assert.equal(document.activeElement,container.querySelector('input[aria-label="搜索剪贴板记录"]'));
 await press('KeyS','s',true);
 assert.ok(ipc.calls.some(call=>call.command==='open_settings'));
 await press('KeyB','b');
 assert.ok(container.querySelector('[aria-label="收起详情"]'));
 await press('Digit4','4',true);
 assert.equal(container.querySelector('.filter-scroll [aria-label="全部"]')?.getAttribute('aria-pressed'),'true');
 await press('ArrowRight','ArrowRight',true);
 assert.equal(container.querySelector('.filter-scroll [aria-label="文本"]')?.getAttribute('aria-pressed'),'true');
 await act(async()=>root.unmount());container.remove();
});

test('standalone rules highlight follows pointer movement and clears on leave',async()=>{
 const {RuleMenuWindow}=await import('../src/windows/RuleMenuWindow');const {defaults}=await import('../src/preferences');
 mockRuleIpc([],command=>command==='get_preferences'?{...defaults}:null);
 window.__ruleMenu={id:1,entries:[{id:'0',label:'第一条'},{id:'1',label:'第二条'}]};
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<RuleMenuWindow/>);await settle();});
 const buttons=container.querySelectorAll('button');
 await act(async()=>buttons[0].dispatchEvent(new window.MouseEvent('mousemove',{bubbles:true})));
 assert.ok(buttons[0].classList.contains('is-hovered'));
 await act(async()=>buttons[1].dispatchEvent(new window.MouseEvent('mousemove',{bubbles:true})));
 assert.ok(!buttons[0].classList.contains('is-hovered'));assert.ok(buttons[1].classList.contains('is-hovered'));
 await act(async()=>container.querySelector('.rule-menu-panel')!.dispatchEvent(new window.MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body})));
 assert.equal(container.querySelector('.is-hovered'),null);
 await act(async()=>root.unmount());container.remove();delete window.__ruleMenu;
});

test('standalone rules can highlight from native pointer coordinates without WebView mouse events',async()=>{
 const {RuleMenuWindow}=await import('../src/windows/RuleMenuWindow');const {defaults}=await import('../src/preferences');
 const ipc=mockRuleIpc([],command=>command==='get_preferences'?{...defaults}:null);
 window.__ruleMenu={id:1,entries:[{id:'0',label:'第一条'},{id:'1',label:'第二条'}]};
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<RuleMenuWindow/>);await settle();});
 const original=document.elementFromPoint;const buttons=container.querySelectorAll('button');let target=buttons[0];
 document.elementFromPoint=()=>target;
 await act(async()=>ipc.emit([12,18],'rule-pointer'));
 assert.ok(buttons[0].classList.contains('is-hovered'));
 target=buttons[1];await act(async()=>ipc.emit([12,50],'rule-pointer'));
 assert.ok(!buttons[0].classList.contains('is-hovered'));assert.ok(buttons[1].classList.contains('is-hovered'));
 await act(async()=>ipc.emit(null,'rule-pointer'));assert.equal(container.querySelector('.is-hovered'),null);
 document.elementFromPoint=original;await act(async()=>root.unmount());container.remove();delete window.__ruleMenu;
});

test('animation preference and system reduced motion gate programmatic effects',async()=>{
 const {applyTheme,animationsEnabled,animateSurface}=await import('../src/lib/theme');
 const previous=document.documentElement.dataset.disableAnimations,match=window.matchMedia;
 let reduced=false,calls=0;
 window.matchMedia=(()=>({matches:reduced})) as any;
 const node=document.createElement('div');node.animate=(()=>{calls++;return {};}) as any;
 applyTheme('light','#3569ed',true);assert.equal(animationsEnabled(),false);animateSurface(node);assert.equal(calls,0);
 applyTheme('light','#3569ed',false);assert.equal(animationsEnabled(),true);animateSurface(node);assert.equal(calls,1);
 reduced=true;assert.equal(animationsEnabled(),false);animateSurface(node);assert.equal(calls,1);
 window.matchMedia=match;if(previous===undefined)delete document.documentElement.dataset.disableAnimations;else document.documentElement.dataset.disableAnimations=previous;
});

test('updating an image revision does not scroll the list back to the selection',async()=>{
 viewport={width:350,height:500};const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const render=(items:typeof clips)=><VirtualClipList clips={items} edge="none" columns={1} selectedId={1} resetKey="same" maxLines={2} className="result-list" renderRow={clip=><div key={clip.id}>{clip.id}</div>}/>;
 await act(async()=>{root.render(render(clips));await settle();});await act(settle);
 const host=container.querySelector('.virtual-clip-list')as HTMLElement;
 await act(async()=>{host.scrollTo({top:1800});await settle();});await act(settle);const offset=host.scrollTop;
 await act(async()=>{root.render(render(clips.map(clip=>clip.id===1?{...clip,updated_at:'2026-11-18T03:00:00Z'}:clip)));await settle();});
 assert.equal(host.scrollTop,offset,'content updates must preserve the user scroll position');
 await act(async()=>root.unmount());container.remove();
});

test('sidebar copy stays local and usage patches do not reload the panel',async()=>{
 const {Picker}=await import('../src/windows/Picker');const {defaults}=await import('../src/preferences');
 const record={...clips[0],title:'Image',plain_text:'',files:[],source_app:'Test',source_path:'',created_at:'2026-11-18T00:00:00Z',updated_at:'2026-11-18T00:00:00Z',use_count:0,pinned:false,favorite:false,sensitive_masked:false};
 let finish!:(value:any)=>void;
 const ipc=mockRuleIpc([],command=>command==='get_preferences'?{...defaults,default_sidebar_open:true}:command==='list_clips'?[record]:['copy_clip','paste_clip'].includes(command)?new Promise(resolve=>{finish=resolve;}):null);
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<Picker/>);await settle();});await act(settle);
 await act(async()=>{(container.querySelector('[aria-label="展开详情"]')as HTMLButtonElement)?.click();await settle();});
 await act(async()=>{(container.querySelector('.clip-transfer-main[aria-label="复制"]')as HTMLButtonElement).click();await settle();});
 assert.equal((container.querySelector('.clip-details-toolbar button[aria-label="删除"]')as HTMLButtonElement).disabled,false,'copy must not lock unrelated sidebar actions');
 const reads=ipc.calls.filter(call=>call.command==='list_clips').length;
 await act(async()=>{ipc.emit({updated_id:clips[0].id,use_count:8},'clips-changed');finish(null);await settle();});
 assert.equal(ipc.calls.filter(call=>call.command==='list_clips').length,reads,'copy and usage count updates must not fetch the whole list');
 await act(async()=>{(container.querySelector('.clip-transfer-main[aria-label="粘贴"]')as HTMLButtonElement).click();await settle();});
 assert.equal((container.querySelector('.clip-details-toolbar button[aria-label="删除"]')as HTMLButtonElement).disabled,false,'paste must not lock unrelated sidebar actions');
 await act(async()=>{finish('pasted');await settle();});
 assert.equal(ipc.calls.filter(call=>call.command==='list_clips').length,reads);

 await act(async()=>root.unmount());container.remove();
});

test('image rule updates retain the displayed thumbnail and preview while replacement loads',async()=>{
 const {ContentPreview}=await import('../src/components/ContentPreview');const {ImageThumbnail}=await import('../src/components/ClipMedia');
 const {resetImageCaches,thumbnailCache}=await import('../src/lib/clip-images');resetImageCaches();let pending=false;const finish:((value:string)=>void)[]=[];
 mockRuleIpc([],command=>['get_clip_thumbnail_path','get_clip_image_path'].includes(command)?pending?new Promise(resolve=>finish.push(resolve)):'original':null);
 const clip={id:998877,kind:'image' as const,title:'Image',plain_text:'',files:[],file_sizes:[],source_app:'Test',source_path:'',created_at:'2026-11-18T00:00:00Z',updated_at:'2026-11-18T00:00:00Z',use_count:0,pinned:false,favorite:false,sensitive_masked:false};
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const render=(value:typeof clip)=><><ImageThumbnail clip={value}/><ContentPreview clip={value}/></>;
 await act(async()=>{root.render(render(clip));await settle();});await act(settle);
 assert.equal(container.querySelectorAll('img').length,2);
 pending=true;thumbnailCache.invalidate(clip.id);
 await act(async()=>{root.render(render({...clip,updated_at:'2026-11-18T00:00:01Z'}));await settle();});
 assert.equal(container.querySelectorAll('img').length,2,'pending replacements must keep the old image visible');
 assert.ok([...container.querySelectorAll('img')].every(img=>img.getAttribute('src')==='asset://localhost/original'));
 await act(async()=>{finish.forEach(resolve=>resolve('modified'));await settle();});
 assert.ok([...container.querySelectorAll('img')].every(img=>img.getAttribute('src')==='asset://localhost/modified'));
 await act(async()=>root.unmount());container.remove();
});

test('shortcut hints require a sustained modifier hold and cancel for shortcuts or release',async()=>{
 const {Picker}=await import('../src/windows/Picker');const {defaults}=await import('../src/preferences');
 const record={id:998899,kind:'text',title:'test',plain_text:'test',files:[],source_app:'Test',source_path:'',created_at:'2026-11-18T00:00:00Z',updated_at:'2026-11-18T00:00:00Z',use_count:0,pinned:false,favorite:false,sensitive_masked:false};
 mockRuleIpc([],command=>command==='get_preferences'?{...defaults}:command==='list_clips'?[record]:null);
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<Picker/>);await settle();});await act(settle);
 const key=(type:string,key:string,code:string,ctrlKey:boolean)=>document.body.dispatchEvent(new window.KeyboardEvent(type,{key,code,ctrlKey,bubbles:true,cancelable:true}));
 const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
 await act(async()=>{key('keydown','Control','ControlLeft',true);await wait(80);});
 assert.equal(container.querySelector('[data-shortcut-hint]'),null);
 await act(async()=>{key('keyup','Control','ControlLeft',false);await wait(430);});
 assert.equal(container.querySelector('[data-shortcut-hint]'),null);
 await act(async()=>{key('keydown','Control','ControlLeft',true);await wait(430);});
 assert.ok(container.querySelector('[data-shortcut-hint]'));
 await act(async()=>{key('keyup','Control','ControlLeft',false);});assert.equal(container.querySelector('[data-shortcut-hint]'),null);
 await act(async()=>{key('keydown','Control','ControlLeft',true);key('keydown','f','KeyF',true);await wait(430);});
 assert.equal(container.querySelector('[data-shortcut-hint]'),null);
 await act(async()=>{key('keyup','Control','ControlLeft',false);root.unmount();});container.remove();
});

test('clear current filter confirms a complete snapshot beyond 300 rows and preserves other scopes',async()=>{
 const {Picker}=await import('../src/windows/Picker');const {defaults}=await import('../src/preferences');
 const base={kind:'text',title:'scope',plain_text:'scope',files:[],source_app:'Test',source_path:'',created_at:'2026-11-18T00:00:00Z',updated_at:'2026-11-18T00:00:00Z',use_count:0,pinned:false,favorite:true,sensitive_masked:false};
 let records=[...Array.from({length:320},(_,i)=>({...base,id:i+1,pinned:i===0})),{...base,id:999,favorite:false}];
 const ipc=mockRuleIpc([], (command,args)=>{
  if(command==='get_preferences')return {...defaults};if(command==='list_clips')return records;
  if(command==='clear_clips'){assert.ok(Array.isArray(args.ids));records=records.filter(record=>!args.ids.includes(record.id));ipc.emit({deleted_ids:args.ids},'clips-changed');return null;}return null;
 });
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<Picker/>);await settle();});await act(settle);
 await act(async()=>{(container.querySelector('[data-shortcut-action="filter_favorite"]')as HTMLButtonElement).click();await settle();});
 const open=()=>act(async()=>{(container.querySelector('[aria-label="清空当前筛选"]')as HTMLButtonElement).click();await settle();});
 await open();assert.ok(document.querySelector('[role="alertdialog"]')?.textContent?.includes('320'));
 assert.equal(document.querySelector('#confirm-description')?.textContent,'将清空320条记录，含置顶和收藏，此操作无法恢复。');
 assert.equal(document.querySelector('.confirm-backdrop')?.parentElement,document.body);
 assert.equal(container.querySelector('.clear-scope-button')?.textContent,'');
 await act(async()=>{[...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button=>button.textContent==='取消')!.click();});
 assert.equal(ipc.calls.filter(call=>call.command==='clear_clips').length,0);
 await open();records=[...records,{...base,id:1000}];
 await act(async()=>{ipc.emit(null,'clips-changed');await settle();});
 await act(async()=>{[...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button=>button.textContent==='清空记录')!.click();await settle();});
 const deleted=ipc.calls.find(call=>call.command==='clear_clips')!.args.ids;
 assert.equal(deleted.length,320);assert.ok(deleted.includes(1));assert.ok(!deleted.includes(999));assert.ok(!deleted.includes(1000));
 assert.deepEqual(records.map(record=>record.id),[999,1000]);assert.equal(document.querySelector('[role="alertdialog"]'),null);
 await act(async()=>root.unmount());container.remove();
});

test('sidebar deletion keeps the sidebar open while a window-wide confirmation is shown',async()=>{
 const {Picker}=await import('../src/windows/Picker');const {defaults}=await import('../src/preferences');
 const record={id:9988776,kind:'text',title:'test',plain_text:'test',files:[],source_app:'Test',source_path:'',created_at:'2026-11-18T00:00:00Z',updated_at:'2026-11-18T00:00:00Z',use_count:0,pinned:false,favorite:false,sensitive_masked:false};
 const ipc=mockRuleIpc([],command=>command==='get_preferences'?{...defaults}:command==='list_clips'?[record]:null);
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<Picker/>);await settle();});await act(settle);
 await act(async()=>{(container.querySelector('[aria-label="展开详情"]')as HTMLButtonElement).click();await settle();});
 const sidebar=container.querySelector('aside')!;
 await act(async()=>{(container.querySelector('.clip-details-toolbar [aria-label="删除"]')as HTMLButtonElement).click();await settle();});
 assert.ok(container.querySelector('.picker-shell.with-details'));assert.equal(sidebar.hidden,false);
 assert.equal(document.querySelector('.confirm-backdrop')?.parentElement,document.body);
 assert.equal(document.querySelector('[role="alertdialog"]')?.closest('.picker'),null);
 await act(async()=>{[...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button=>button.textContent==='取消')!.click();});
 assert.ok(container.querySelector('.picker-shell.with-details'));assert.equal(ipc.calls.filter(call=>call.command==='delete_clip').length,0);
 await act(async()=>root.unmount());container.remove();
});

test('lightweight activity coalesces hidden work, cancels quick-hide timers and resumes when disabled',async()=>{
 const {WindowActivity,WINDOW_IDLE_MS}=await import('../src/lib/window-activity');assert.equal(WINDOW_IDLE_MS,5000);
 const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));let refreshes=0;const phases:boolean[]=[];
 const gate=new WindowActivity(()=>refreshes++,dormant=>phases.push(dormant),20);
 gate.hide();assert.equal(gate.deferWork(),false);gate.show();await wait(30);assert.deepEqual(phases,[]);
 gate.hide();await wait(30);assert.equal(gate.isDormant(),true);
 for(let i=0;i<100;i++)assert.equal(gate.deferWork(),true);
 assert.equal(refreshes,0);gate.show();assert.equal(refreshes,1);gate.show();assert.equal(refreshes,1);
 gate.hide();await wait(30);gate.show();assert.equal(refreshes,1,'unchanged warm data and image caches must not be reloaded');
 gate.hide();await wait(30);gate.deferWork();gate.setEnabled(false);assert.equal(refreshes,2);assert.equal(gate.isDormant(),false);assert.equal(gate.deferWork(),false);
 gate.setEnabled(true);await wait(10);assert.equal(gate.isDormant(),true);gate.show();gate.hide();gate.dispose();await wait(30);assert.equal(gate.isDormant(),false);
});

test('hidden lightweight picker defers capture refreshes and reconciles once without rebuilding the panel',async()=>{
 const {Picker}=await import('../src/windows/Picker');const {defaults}=await import('../src/preferences');
 let record={id:994422,kind:'text',title:'old',plain_text:'old',files:[],source_app:'Test',source_path:'',created_at:'2026-11-18T00:00:00Z',updated_at:'2026-11-18T00:00:00Z',use_count:0,pinned:false,favorite:false,sensitive_masked:false};
 const ipc=mockRuleIpc([],command=>command==='get_preferences'?{...defaults}:command==='list_clips'?[record]:null);
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<Picker/>);await settle();});await act(settle);
 const node=container.querySelector('.result-row');const reads=ipc.calls.filter(call=>call.command==='list_clips').length;
 await act(async()=>{ipc.emit(null,'picker-hidden');await new Promise(resolve=>setTimeout(resolve,5100));});
 assert.equal(document.documentElement.dataset.pickerDormant,'true');record={...record,title:'new',plain_text:'new'};
 await act(async()=>{for(let i=0;i<10;i++)ipc.emit(null,'clips-changed');await settle();});
 assert.equal(ipc.calls.filter(call=>call.command==='list_clips').length,reads);assert.ok(node?.textContent?.includes('old'));
 await act(async()=>{ipc.emit('none','picker-opened');await settle();});await act(settle);
 assert.equal(document.documentElement.dataset.pickerDormant,'false');assert.equal(ipc.calls.filter(call=>call.command==='list_clips').length,reads+1);
 assert.equal(container.querySelector('.result-row'),node);assert.ok(node?.textContent?.includes('new'));
 await act(async()=>root.unmount());container.remove();
});

test('storage breakdown groups history actions and omits temporary and web caches',async()=>{
  const {StorageUsage}=await import('../src/components/StorageUsage');
  const items=[{kind:'database',bytes:1024,included:true},{kind:'originals',bytes:2048,included:true},{kind:'thumbnails',bytes:512,included:true},{kind:'icons',bytes:256,included:true}];
  const ipc=mockRuleIpc([], (command,args)=>{
    if(command==='clear_storage_category')items.find(item=>item.kind===args.kind)!.bytes=0;
    if(command==='get_storage_breakdown'||command==='clear_storage_category')return {items:items.map(item=>({...item})),total:items.filter(item=>item.included).reduce((sum,item)=>sum+item.bytes,0)};
  });
  let clearRequests=0;
  const totals:number[]=[];const onTotal=(value:number)=>totals.push(value);
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  const button=(label:string)=>container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  await act(async()=>{root.render(<StorageUsage onTotal={onTotal} onClearHistory={()=>clearRequests++}/>);await settle();});
  assert.equal(container.textContent!.includes('其他占用'),false);assert.equal(container.textContent!.includes('网页缓存'),false);assert.equal(totals.at(-1),3840);
  const history=button('整理：历史数据').closest('.setting-row')!;assert.match(history.textContent!,/清空所有记录/);
  await act(async()=>history.querySelectorAll<HTMLButtonElement>('button')[1].click());assert.equal(clearRequests,1);
  await act(async()=>{button('清理：缩略图缓存').click();await settle();});
  assert.equal(totals.at(-1),3328);assert.equal(document.querySelector('[role="alertdialog"]'),null);
  await act(async()=>button('清理：图片原图').click());
  assert.match(document.querySelector('[role="alertdialog"]')!.textContent!,/含置顶和收藏/);
  await act(async()=>document.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!.click());
  assert.equal(ipc.calls.filter(call=>call.command==='clear_storage_category').length,1);
  assert.equal(container.textContent!.includes('迁移前备份'),false);
  await act(async()=>button('清理：图片原图').click());
  await act(async()=>{document.querySelector<HTMLButtonElement>('[role="alertdialog"] .destructive')!.click();await settle();});
  assert.equal(totals.at(-1),1280);assert.equal(button('清理：图片原图').disabled,true);
  await act(async()=>root.unmount());container.remove();
});

test('rules master switch hides row and sidebar entries and blocks the rules shortcut',async()=>{
 const {Picker}=await import('../src/windows/Picker');const {defaults}=await import('../src/preferences');
 let prefs={...defaults,rules_enabled:true};
 const record={id:778899,kind:'text',title:'hello',plain_text:'hello',files:[],source_app:'Test',source_path:'',created_at:'now',updated_at:'now',use_count:0,pinned:false,favorite:false,sensitive_masked:false};
 const ipc=mockRuleIpc([],command=>command==='get_preferences'?prefs:command==='list_clips'?[record]:null);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>{root.render(<Picker/>);await settle();});await act(settle);
 assert.ok(host.querySelector('[data-row-rules]'));
 prefs={...prefs,rules_enabled:false};
 await act(async()=>{ipc.emit(null,'preferences-changed');await settle();});
 assert.equal(host.querySelector('[data-row-rules]'),null);assert.equal(host.querySelector('.clip-tools-button[aria-label="规则"]'),null);
 const opens=ipc.calls.filter(call=>call.command==='show_rule_menu').length;
 await act(async()=>{host.querySelector('.picker')!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'r',metaKey:true,ctrlKey:true,bubbles:true}));await settle();});
 assert.equal(ipc.calls.filter(call=>call.command==='show_rule_menu').length,opens);
 prefs={...prefs,rules_enabled:true};await act(async()=>{ipc.emit(null,'preferences-changed');await settle();});assert.ok(host.querySelector('[data-row-rules]'));
 await act(async()=>root.unmount());host.remove();
});

test('panel layouts share actions and context menus, retain selection and resize with details',async()=>{
 const {Picker}=await import('../src/windows/Picker');const {defaults}=await import('../src/preferences');
 const {panelSize}=await import('../src/lib/panel-layout');
 const clips=[{id:901,kind:'rich',title:'Layout fixture',plain_text:'Shared clipboard content',files:[],source_app:'Test',source_path:'',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),use_count:1,pinned:false,favorite:false,sensitive_masked:false}];
 let preferences={...defaults};
 const ipc=mockRuleIpc([],async(command,args)=>{if(command==='get_preferences')return preferences;if(command==='list_clips')return clips;if(command==='get_preview_clip')return{...clips[0],file_sizes:[]};if(command==='is_picker_pinned')return false;return null;});
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<Picker/>);await settle();});await act(settle);
 for(const layout of ['sidebar','horizontal','columns'] as const){
  preferences={...preferences,panel_layout:layout};
  await act(async()=>{ipc.emit(null,'preferences-changed');await settle();});
  assert.ok(container.querySelector(`.picker-shell.layout-${layout}`));
  const row=container.querySelector('.result-row')as HTMLButtonElement;
  await act(async()=>{row.click();(container.querySelector('[aria-label="展开详情"]')as HTMLButtonElement).click();await settle();});
  assert.ok(container.querySelector('.result-row.selected'));
  assert.equal(container.querySelectorAll('.clip-transfer-main').length,2);
  const pin=container.querySelector('.clip-details-toolbar button[aria-label="置顶"]')as HTMLButtonElement;
  assert.ok(pin,`${layout}: existing management actions remain available`);
  assert.equal(!!pin.querySelector('span'),layout==='columns');
  const openingSize=ipc.calls.filter(call=>call.command==='resize_picker').at(-1)!.args;
  assert.equal(openingSize.width,panelSize(layout,true).width);
  assert.equal(openingSize.height,panelSize(layout,true).height);
  await act(async()=>{row.dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,clientX:40,clientY:150}));await settle();});
  assert.ok(container.querySelector('.context-menu'),'right-click still opens the existing context menu');
  await act(async()=>{(container.querySelector('[aria-label="收起详情"]')as HTMLButtonElement).click();await settle();});
  const closedSize=ipc.calls.filter(call=>call.command==='resize_picker').at(-1)!.args;
  assert.equal(closedSize.width,panelSize(layout,false).width);
  assert.equal(closedSize.height,panelSize(layout,false).height);
 }
 await act(async()=>root.unmount());container.remove();
});

test('Space toggles details and row rules remain anchored inside the picker without native popups',async()=>{
 const {Picker}=await import('../src/windows/Picker');const {defaults}=await import('../src/preferences');
 const clip={id:902,kind:'text',title:'Rule fixture',plain_text:'  example  ',files:[],source_app:'Test',source_path:'',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),use_count:0,pinned:false,favorite:false,sensitive_masked:false};
 const ipc=mockRuleIpc([],async command=>command==='get_preferences'?defaults:command==='list_clips'?[clip]:null);
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<Picker/>);await settle();});await act(settle);
 assert.equal(container.querySelector('.picker-brand'),null,'logo is replaced by window pin');
 assert.ok(container.querySelector('.picker-header .window-pin'));
 const search=container.querySelector('.search-box input')as HTMLInputElement;
 for(const expanded of [true,false]){
  await act(async()=>{search.dispatchEvent(new window.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));await settle();});
  assert.equal(container.querySelector('[aria-label="收起详情"]')!==null,expanded);
 }
 const trigger=container.querySelector('[data-row-rules]')as HTMLButtonElement;
 await act(async()=>{trigger.click();await settle();});
 assert.ok(container.querySelector('.inline-rule-list [role="menuitem"]'));
 assert.equal(container.querySelector('[aria-label="收起详情"]'),null,'rules do not open details');
 assert.equal(ipc.calls.some(call=>['show_rule_menu','show_preview'].includes(call.command)),false);
 await act(async()=>{trigger.click();await settle();});assert.equal(container.querySelector('.inline-rule-list'),null);
 await act(async()=>root.unmount());container.remove();
});

test('horizontal virtual rows keep their offsets through all 1000 records',async()=>{
 viewport={width:800,height:150};
 const records=Array.from({length:1000},(_,i)=>({...clips[0],id:i+1}));
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const render=(selectedId:number|null)=><VirtualClipList clips={records} edge="none" horizontal cardWidth={202} cardHeight={150} columns={1} selectedId={selectedId} resetKey="horizontal-thousand" maxLines={2} className="result-list" renderRow={clip=><div key={clip.id} className="result-item" data-clip-id={clip.id}>{clip.id}</div>}/>;
 await act(async()=>{root.render(render(null));await settle();});
 const host=container.querySelector('.virtual-clip-list')as HTMLElement;
 Object.defineProperty(host,'scrollWidth',{get(){return parseFloat((host.firstElementChild as HTMLElement).style.width);}});
 assert.ok(container.querySelectorAll('.result-item').length<30);
 await act(async()=>{root.render(render(1000));await settle();});await act(settle);
 const last=container.querySelector('[data-index="999"]')as HTMLElement;
 assert.ok(last?.querySelector('[data-clip-id="1000"]'));
 assert.equal(last.style.transform,'translateX(208791px)');
 assert.equal((container.querySelector('.virtual-list-content')as HTMLElement).style.height,'150px');
 assert.ok(container.querySelectorAll('.result-item').length<30);
 await act(async()=>root.unmount());container.remove();viewport={width:350,height:500};
});

test('hidden row actions reject shortcuts, while a hovered toolbar targets its own record',async()=>{
 const {Picker}=await import('../src/windows/Picker');const {defaults}=await import('../src/preferences');
 const record={id:987654,kind:'text',title:'Shortcut target',plain_text:'Shortcut target',files:[],source_app:'Test',source_path:'',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),use_count:0,pinned:false,favorite:false,sensitive_masked:false};
 const ipc=mockRuleIpc([],command=>command==='get_preferences'?defaults:command==='list_clips'?[record]:command==='toggle_pin'?true:null);
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<Picker/>);await settle();});await act(settle);
 const press=()=>document.body.dispatchEvent(new window.KeyboardEvent('keydown',{key:'p',code:'KeyP',ctrlKey:true,bubbles:true,cancelable:true}));
 await act(async()=>{press();await settle();});assert.equal(ipc.calls.filter(c=>c.command==='toggle_pin').length,0);
 const row=container.querySelector('.result-item')as HTMLElement;
 await act(async()=>{row.dispatchEvent(new window.MouseEvent('mouseover',{bubbles:true,relatedTarget:document.body}));await settle();});
 await act(async()=>{press();await settle();});assert.equal(ipc.calls.filter(c=>c.command==='toggle_pin').length,1);
 await act(async()=>{root.unmount();});container.remove();
});

test('image fit/fill controls preserve the decoded image and default new images to fit',async()=>{
 let reads=0;
 const ipc=mockRuleIpc([],command=>command==='get_clip_image_path'?(reads++,'fit-toggle-image'):null);
 const {ContentPreview}=await import('../src/components/ContentPreview');
 const clip={id:781234,kind:'image',sensitive_masked:false,created_at:'2026-11-15T00:00:00Z',source_app:'Test',files:[],file_sizes:[],plain_text:''}as any;
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>{root.render(<ContentPreview clip={clip} imageMetadata imageControls/>);await settle();});
 const image=container.querySelector('img');assert.ok(image);assert.equal(container.querySelector('.preview-image-card')?.getAttribute('data-image-fit'),'fit');
 await act(async()=>{(container.querySelector('.image-fit-button')as HTMLButtonElement).click();await settle();});
 assert.equal(container.querySelector('.preview-image-card')?.getAttribute('data-image-fit'),'fill');assert.equal(container.querySelector('.image-fit-button')?.getAttribute('aria-label'),'适应');
 assert.equal(container.querySelector('img'),image);assert.equal(reads,1);
 await act(async()=>{(container.querySelector('.image-fit-button')as HTMLButtonElement).click();await settle();});assert.equal(container.querySelector('.preview-image-card')?.getAttribute('data-image-fit'),'fit');
 await act(async()=>{(container.querySelector('.image-fit-button')as HTMLButtonElement).click();root.render(<ContentPreview clip={{...clip,id:781235}} imageMetadata imageControls/>);await settle();});
 assert.equal(container.querySelector('.preview-image-card')?.getAttribute('data-image-fit'),'fit');assert.equal(ipc.calls.filter(c=>c.command==='get_clip_image_path').length,2);
 await act(async()=>root.unmount());container.remove();
});
