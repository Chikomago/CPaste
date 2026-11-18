const chinese = '零〇一二三四五六七八九十百千两壹贰叁肆伍陆柒捌玖拾佰仟';
const token = `(?:[0-9０-９]{1,6}|[${chinese}]{1,8}|[IVXLCDMivxlcdm]{1,8}|[A-Za-z]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅬⅭⅮⅯⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻⅼⅽⅾⅿ]+)`;
const bracketed = new RegExp(`^([ \\t]*)([（(\\[【〔{])(${token})([）)\\]】〕}])[.．、:：]?[ \\t]*(?=\\S)`,'u');
const ordinal = new RegExp(`^([ \\t]*)第([0-9０-９${chinese}]{1,8})(?:条|项|步|章|节)?(?:[.．、:：][ \\t]*|[ \\t]+)(?=\\S)`,'u');
const plain = new RegExp(`^([ \\t]*)(${token})(?:([.．、:：;；)）\\]】])[ \\t]*|([ \\t]+))(?=\\S)`,'u');
type Marker = { length: number; indent: string; strong: boolean; values: Map<string,number> };

function valuesOf(raw: string) {
  const value=raw.normalize('NFKC');const values=new Map<string,number>();
  if(/^\d+$/.test(value)) {values.set('number',Number(value));return values;}
  if(new RegExp(`^[${chinese}]+$`,'u').test(value)) {
    const normalized=value.replace(/[〇两壹贰叁肆伍陆柒捌玖拾佰仟]/g,char=>({'〇':'零','两':'二','壹':'一','贰':'二','叁':'三','肆':'四','伍':'五','陆':'六','柒':'七','捌':'八','玖':'九','拾':'十','佰':'百','仟':'千'}[char]!));
    const digits='零一二三四五六七八九';let number=0;
    if(!/[十百千]/.test(normalized))number=Number([...normalized].map(char=>digits.indexOf(char)).join(''));
    else {let digit=0;for(const char of normalized){const unit=({'十':10,'百':100,'千':1000} as Record<string,number>)[char];if(unit){number+=(digit||1)*unit;digit=0;}else digit=digits.indexOf(char);}number+=digit;}
    values.set('chinese',number);return values;
  }
  if(/^[A-Za-z]$/.test(value))values.set(raw===value?'letter':'unicode-roman',value.toUpperCase().charCodeAt(0)-64);
  if((value===value.toUpperCase()||value===value.toLowerCase())&&/^(?=.)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(value)) {
    let total=0,previous=0;for(const char of [...value.toUpperCase()].reverse()){const n=({I:1,V:5,X:10,L:50,C:100,D:500,M:1000} as Record<string,number>)[char];total+=n<previous?-n:n;previous=n;}
    values.set(raw===value?'roman':'unicode-roman',total);
  }
  return values;
}
function parseMarker(line: string): Marker | null {
  let match=line.match(/^([ \t]*)([\u2460-\u249b\u24ea-\u24ff\u2776-\u2793\u3251-\u325f\u32b1-\u32bf\u3220-\u3229\u3280-\u3289\u24b6-\u24e9])[.．、:：]?[ \t]*(?=\S)/u);
  if(match)return {length:match[0].length,indent:match[1],strong:true,values:new Map()};
  match=line.match(bracketed);
  if(match){const pairs:Record<string,string>={'（':'）','(':')','[':']','【':'】','〔':'〕','{':'}'};if(pairs[match[2]]!==match[4])return null;const values=valuesOf(match[3]);return {length:match[0].length,indent:match[1],strong:values.has('number')||values.has('chinese')||values.has('unicode-roman'),values};}
  match=line.match(ordinal);
  if(match)return {length:match[0].length,indent:match[1],strong:true,values:valuesOf(match[2])};
  match=line.match(plain);
  if(match){
    const values=valuesOf(match[2]);const delimiter=match[3];
    // Numeric clocks, decimals, versions and dates are content, not prefixes.
    if(values.has('number')&&!/[ \t]$/.test(match[0])&&delimiter&&/[.．:：]/.test(delimiter)&&/^[0-9０-９]/.test(line.slice(match[0].length)))return null;
    return {length:match[0].length,indent:match[1],strong:Boolean(delimiter)&&(values.has('number')||values.has('chinese')||values.has('unicode-roman')),values};
  }
  match=line.match(/^([ \t]*)(?:[-+*—–][ \t]+|[•●○◦▪▫◆◇‣⁃►▸➤→][ \t]*)(?=\S)/u);
  if(match)return {length:match[0].length,indent:match[1],strong:true,values:new Map()};
  match=line.match(/^([ \t]*)[:：][ \t]*(?=\S)/u);
  if(match)return {length:match[0].length,indent:match[1],strong:false,values:new Map([['colon',0]])};
  return null;
}
function consecutive(left: Marker | null, right: Marker | null) {
  if(!left||!right)return false;
  return [...left.values].some(([kind,value])=>right.values.get(kind)===(kind==='colon'?value:value+1));
}
export function stripLineNumbers(text: string) {
  const lines=text.split(/\r?\n/);const markers=lines.map(parseMarker);
  const nonempty=lines.flatMap((line,index)=>line.trim()?[index]:[]);
  const contextual=new Set<number>();
  for(let i=1;i<nonempty.length;i++)if(consecutive(markers[nonempty[i-1]],markers[nonempty[i]])){contextual.add(nonempty[i-1]);contextual.add(nonempty[i]);}
  return lines.map((line,index)=>{
    const marker=markers[index];if(!marker)return line;
    // Ambiguous letter/Roman/space-only prefixes need neighboring list evidence.
    if(!marker.strong&&!contextual.has(index))return line;
    return marker.indent+line.slice(marker.length);
  }).join(text.includes('\r\n')?'\r\n':'\n');
}
