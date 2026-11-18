import type {ScriptRule} from './js-rules';

const remap=(destination:string,swapDimensions=false)=>`function transform(pixels) {
  const { width, height, data: source } = pixels;
  const data = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = ${destination};
      data[to] = source[from];
      data[to + 1] = source[from + 1];
      data[to + 2] = source[from + 2];
      data[to + 3] = source[from + 3];
    }
  }
  return { width: ${swapDimensions?'height':'width'}, height: ${swapDimensions?'width':'height'}, data };
}`;
const resize=`function transform(pixels) {
  const scale = 0.5;
  const width = Math.max(1, Math.round(pixels.width * scale));
  const height = Math.max(1, Math.round(pixels.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  const source = pixels.data;
  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, Math.min(pixels.height - 1, (y + 0.5) * pixels.height / height - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, pixels.height - 1), fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(pixels.width - 1, (x + 0.5) * pixels.width / width - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, pixels.width - 1), fx = sx - x0;
      const a = (y0 * pixels.width + x0) * 4, b = (y0 * pixels.width + x1) * 4;
      const c = (y1 * pixels.width + x0) * 4, d = (y1 * pixels.width + x1) * 4;
      const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
      const aa = source[a + 3] * wa, ab = source[b + 3] * wb, ac = source[c + 3] * wc, ad = source[d + 3] * wd;
      const alpha = aa + ab + ac + ad, to = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        data[to + channel] = alpha ? (source[a + channel] * aa + source[b + channel] * ab + source[c + channel] * ac + source[d + channel] * ad) / alpha : 0;
      }
      data[to + 3] = alpha;
    }
  }
  return { width, height, data };
}`;
export const imageRuleDefaults:ScriptRule[]=[
 {id:'image:rotate_left',name:'向左旋转 90°',code:remap('((width - 1 - x) * height + y) * 4',true)},
 {id:'image:rotate_right',name:'向右旋转 90°',code:remap('(x * height + height - 1 - y) * 4',true)},
 {id:'image:flip_horizontal',name:'水平翻转',code:remap('(y * width + width - 1 - x) * 4')},
 {id:'image:flip_vertical',name:'垂直翻转',code:remap('((height - 1 - y) * width + x) * 4')},
 {id:'image:resize',name:'缩放',code:resize},
 {id:'image:convert',name:'格式转换',code:'function transform(pixels, context) {\n  const format = context.format === "png" ? "jpeg" : "png";\n  return { ...pixels, encoding: { format } };\n}'},
 {id:'image:compress',name:'压缩',code:'function transform(pixels) {\n  return { ...pixels, encoding: { format: "jpeg", quality: 80 } };\n}'},
].map(rule=>({...rule,target:'image',kind:'js',enabled:true}));

// Only replace exact historical defaults; user-written implementations are retained.
const oldBodies:Record<string,string[]>={
 rotate_left:['return image.rotate270();'],rotate_right:['return image.rotate90();'],
 flip_horizontal:['return image.flipHorizontal();'],flip_vertical:['return image.flipVertical();'],
 resize:['return image.resizeExact(context.params.width ?? Math.round(image.width / 2), context.params.height ?? Math.round(image.height / 2));','return image.resizeExact(Math.round(image.width / 2), Math.round(image.height / 2));'],
 convert:['return image.saveAs(context.params.format ?? "png", context.params.quality ?? 80);','return image.saveAs("png", 80);'],
 compress:['return image.saveAs("jpeg", context.params.quality ?? 80);','return image.saveAs("jpeg", 80);'],
};
const legacyCodes=new Map<string,Set<string>>();
for(const [action,bodies]of Object.entries(oldBodies)){
 const extra=action==='resize'?', width: context.params.width ?? Math.round(context.width / 2), height: context.params.height ?? Math.round(context.height / 2)':action==='convert'?', format: context.params.format ?? "png", quality: context.params.quality ?? 80':action==='compress'?', quality: context.params.quality ?? 80':'';
 bodies.push(`return { action: "${action}"${extra} };`);
 legacyCodes.set(`image:${action}`,new Set(bodies.flatMap(body=>['text, context',''].map(args=>`function transform(${args}) {\n  ${body}\n}`))));
}
export function rewriteOriginalImageRule(rule:ScriptRule):ScriptRule{
 const original=imageRuleDefaults.find(item=>item.id===rule.id);
 const oldOutput=original?.code.replace("encoding:","saveAs:");
 return original&&(legacyCodes.get(rule.id)?.has(rule.code)||rule.code===oldOutput||rule.id==='image:convert'&&['encoding','saveAs'].some(field=>rule.code===`function transform(pixels) {\n  return { ...pixels, ${field}: { format: "png" } };\n}`))?{...rule,code:original.code}:rule;
}
