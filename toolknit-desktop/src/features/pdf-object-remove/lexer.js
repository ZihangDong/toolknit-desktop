import { removeError,REMOVE_LIMITS } from './core.js';
import { asciiSpace,scanAsciiFilter } from './ascii-filters.js';
import { inlinePrediction } from './inline-predictor.js';
import { scanRunLength } from './run-length.js';
import { scanLzw,inlineLzwSettings } from './lzw.js';
const space=character=>character!==undefined&&/[\x00\t\n\f\r ]/.test(character),delimiter=character=>character===undefined||space(character)||'()<>[]{}/%'.includes(character);
export function pdfLatin(bytes){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return text;}
const imageKeys = new Map([
 ['W','Width'],['Width','Width'],['H','Height'],['Height','Height'],
 ['BPC','BitsPerComponent'],['BitsPerComponent','BitsPerComponent'],
 ['CS','ColorSpace'],['ColorSpace','ColorSpace'],
 ['I','Interpolate'],['Interpolate','Interpolate'],
 ['F','Filter'],['Filter','Filter'],
 ['DP','DecodeParms'],['DecodeParms','DecodeParms'],
]);
const imageColors = new Map([
 ['G',['Gray',1]],['DeviceGray',['Gray',1]],['RGB',['RGB',3]],['DeviceRGB',['RGB',3]],
 ['CMYK',['CMYK',4]],['DeviceCMYK',['CMYK',4]],
]);
const imageFilters = new Map([
 ['AHx','ASCIIHexDecode'],['ASCIIHexDecode','ASCIIHexDecode'],
 ['A85','ASCII85Decode'],['ASCII85Decode','ASCII85Decode'],
]);
const inlineFlate = new Set(['Fl','FlateDecode']);
const inlineRunLength = new Set(['RL','RunLengthDecode']);
const inlineLzw = new Set(['LZW','LZWDecode']);

/** Bounds inline images; Flate samples are validated before inspection. */
export function parsePdfInstructions(bytes,{streamEnds=[bytes.length]}={}){
 const text=pdfLatin(bytes);let position=0,tokens=0;const instructions=[],operands=[];
 const flateEnd=/EI(?=[ \r\n])/g;
 let streamIndex=0;
 const fail=()=>{throw removeError('syntax');};
 function skip(){while(position<text.length){if(space(text[position])){position++;continue;}if(text[position]==='%'){while(position<text.length&&!/[\r\n]/.test(text[position]))position++;continue;}break;}}
 function operand(depth=0){
  if(depth>32||++tokens>REMOVE_LIMITS.operators*20)throw removeError('complex');skip();const start=position,character=text[position++];
  if(character==='/'){while(!delimiter(text[position]))position++;const raw=text.slice(start,position);return{type:'name',name:raw.slice(1).replace(/#([\da-f]{2})/ig,(_,hex)=>String.fromCharCode(parseInt(hex,16))),raw,start,end:position};}
  if(character==='('){let nesting=1;const value=[];while(position<text.length&&nesting){const char=text[position++];if(char==='\\'){let escaped=text[position++];if(escaped===undefined)fail();if(escaped==='\r'){if(text[position]==='\n')position++;continue;}if(escaped==='\n')continue;if(/[0-7]/.test(escaped)){let octal=escaped;for(let i=0;i<2&&/[0-7]/.test(text[position]||'x');i++)octal+=text[position++];value.push(parseInt(octal,8)&255);}else value.push(({n:10,r:13,t:9,b:8,f:12})[escaped]??escaped.charCodeAt(0));}else if(char==='('){nesting++;value.push(40);}else if(char===')'){if(--nesting)value.push(41);}else if(char==='\r'){if(text[position]==='\n')position++;value.push(10);}else value.push(char.charCodeAt(0));}if(nesting)fail();return{type:'string',value:new Uint8Array(value),raw:text.slice(start,position),start,end:position};}
  if(character==='<'&&text[position]!=='<'){const from=position;while(position<text.length&&text[position]!=='>')position++;if(position>=text.length)fail();let hex=text.slice(from,position++).replace(/[\x00\t\n\f\r ]/g,'');if(!/^[\da-f]*$/i.test(hex))fail();if(hex.length%2)hex+='0';return{type:'string',value:new Uint8Array(hex.match(/../g)?.map(part=>parseInt(part,16))||[]),raw:text.slice(start,position),start,end:position};}
  if(character==='['||(character==='<'&&text[position]==='<')){const dictionary=character==='<';if(dictionary)position++;const children=[];while(true){skip();if(dictionary?text.slice(position,position+2)==='>>':text[position]===']'){position+=dictionary?2:1;break;}if(position>=text.length)fail();children.push(operand(depth+1));}return{type:dictionary?'dict':'array',children,raw:text.slice(start,position),start,end:position};}
  while(!delimiter(text[position]))position++;const raw=text.slice(start,position);
  if(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)){const value=Number(raw);if(!Number.isFinite(value)||Math.abs(value)>1e12)throw removeError('complex');return{type:'number',value,raw,start,end:position};}
  if(['true','false','null'].includes(raw))return{type:'constant',raw,start,end:position};fail();
 }
 function inlineImage(start){
  const unsupported=()=>{throw removeError('inline');};
  if(operands.length)unsupported();
  while(streamEnds[streamIndex]<=start)streamIndex++;
  const streamEnd=streamEnds[streamIndex];
  if(streamEnd===undefined)unsupported();
  const fields=new Map();
  for(;;){
   skip();
   if(text.startsWith('ID',position)&&/[ \n]/.test(text[position+2]??'')){
    position+=3;
    break;
   }
   if(text[position]!=='/')unsupported();
   const key=imageKeys.get(operand().name);
   if(!key||fields.has(key))unsupported();
   skip();
   const initials=key==='DecodeParms'?'[<n':key==='Filter'?'/[':'/+-.0123456789tf';
   if(!initials.includes(text[position]??'\0'))unsupported();
   fields.set(key,operand());
  }
  const width=fields.get('Width')?.value,height=fields.get('Height')?.value;
  const bits=fields.get('BitsPerComponent')?.value;
  const color=imageColors.get(fields.get('ColorSpace')?.name);
  const interpolate=fields.get('Interpolate')?.raw??'false';
  if(![width,height].every(value=>Number.isSafeInteger(value)&&value>0)
     ||![1,2,4,8,16].includes(bits)||!color||!['true','false'].includes(interpolate))unsupported();
  const [device,components]=color;
  const length=Math.ceil(width*components*bits/8)*height;
  if(!Number.isSafeInteger(length)||length>REMOVE_LIMITS.streamBytes)unsupported();
  const filter=fields.get('Filter');
  const filters=filter?.type==='array'?filter.children.map(token=>token.name):filter?[filter.name]:[];
  const outerEncoding=imageFilters.get(filters[0]);
  const binaryFlate=filters.length===1&&inlineFlate.has(filters[0]);
  const wrappedFlate=!!outerEncoding&&filters.length===2&&inlineFlate.has(filters[1]);
  const flate=binaryFlate||wrappedFlate;
  const binaryRunLength=filters.length===1&&inlineRunLength.has(filters[0]);
  const wrappedRunLength=!!outerEncoding&&filters.length===2&&inlineRunLength.has(filters[1]);
  const runLength=binaryRunLength||wrappedRunLength;
  const binaryLzw=filters.length===1&&inlineLzw.has(filters[0]);
  const wrappedLzw=!!outerEncoding&&filters.length===2&&inlineLzw.has(filters[1]);
  const lzw=binaryLzw||wrappedLzw;
  if(filter&&!binaryFlate&&!binaryRunLength&&!binaryLzw&&!(outerEncoding&&(filters.length===1||wrappedFlate||wrappedRunLength||wrappedLzw)))unsupported();
  const lzwSettings=lzw?inlineLzwSettings(fields.get('DecodeParms'),filters.length,filter?.type==='array'):undefined;
  const earlyChange=lzwSettings?.earlyChange;
  const prediction=inlinePrediction(lzw?lzwSettings.predictionParameters:fields.get('DecodeParms'),lzw?1:filters.length,flate||lzw,{width,height,bits,components,length});
  const encodedLength=prediction?.encodedLength??length;
  const dataStart=position;
  let dataEnd=dataStart+length,marker=dataEnd+1;
  if(outerEncoding){
   const limit=flate||runLength||lzw?REMOVE_LIMITS.streamBytes:length;
   const payload=scanAsciiFilter(outerEncoding,text,dataStart,streamEnd,limit);
   if(!payload?.length||(!flate&&!runLength&&!lzw&&payload.length!==length)||!asciiSpace(text[payload.end]))unsupported();
   dataEnd=payload.end;
   marker=dataEnd+1;
   while(marker<streamEnd&&asciiSpace(text[marker]))marker++;
  }else if(binaryRunLength||binaryLzw){
   let payload;
   try{payload=binaryRunLength?scanRunLength(bytes,dataStart,streamEnd,REMOVE_LIMITS.streamBytes)
    :scanLzw(bytes,dataStart,streamEnd,REMOVE_LIMITS.streamBytes,earlyChange);}catch{unsupported();}
   if(!payload||payload.oversized||payload.length!==encodedLength||!asciiSpace(text[payload.end]))unsupported();
   dataEnd=payload.end;
   if(/EI(?=[ \r\n])/.test(text.slice(dataStart,dataEnd)))unsupported();
   marker=dataEnd+1;
   while(marker<streamEnd&&asciiSpace(text[marker]))marker++;
  }else if(binaryFlate){
   // Do not skip an early EI that another reader may treat as the end.
   flateEnd.lastIndex=dataStart;
   marker=flateEnd.exec(text)?.index??-1;
   dataEnd=marker-1;
   if(dataEnd<=dataStart||marker+2>=streamEnd||!/[ \n]/.test(text[dataEnd]))unsupported();
  }else{
   // Readers may mistake an earlier EI inside raw data for the terminator.
   if(!/[ \n]/.test(text[dataEnd]??'')||/EI(?=[ \r\n])/.test(text.slice(dataStart,dataEnd+1)))unsupported();
  }
  const end=marker+2;
  if(end>=streamEnd||!text.startsWith('EI',marker)||!/[ \r\n]/.test(text[end]??''))unsupported();
  position=end;
  const encoding=binaryFlate?'FlateDecode':wrappedFlate?outerEncoding+'/FlateDecode'
   :binaryRunLength?'RunLengthDecode':wrappedRunLength?outerEncoding+'/RunLengthDecode'
   :binaryLzw?'LZWDecode':wrappedLzw?outerEncoding+'/LZWDecode':outerEncoding;
  return {width,height,bits,device,interpolate,encoding,data:bytes.subarray(dataStart,dataEnd),
   ...(prediction?{prediction}:{}),...(flate?{flate:{outerEncoding,length}}:{}),...(runLength?{runLength:{outerEncoding,length}}:{}),
   ...(lzw?{lzw:{outerEncoding,length,earlyChange}}:{})};
 }
 while(true){skip();if(position>=text.length)break;const char=text[position];if('/([<+-.0123456789'.includes(char)||/^(?:true|false|null)(?=[\s\[\]()<>/%]|$)/.test(text.slice(position))){operands.push(operand());if(operands.length>64)throw removeError('complex');continue;}
  const operatorStart=position;while(!delimiter(text[position]))position++;if(position===operatorStart)fail();
  const name=text.slice(operatorStart,position);
  const image=name==='BI'?inlineImage(operatorStart):undefined;
  const args=operands.splice(0);
  instructions.push({name,args,start:args[0]?.start??operatorStart,operatorStart,end:position,...(image?{image}:{})});
  if(instructions.length>REMOVE_LIMITS.operators)throw removeError('complex');
 }
 if(operands.length)fail();return instructions;
}
