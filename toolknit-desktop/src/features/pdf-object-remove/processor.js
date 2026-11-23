import { PDFDocument,PDFName,PDFArray,PDFBool,PDFDict,PDFRef,PDFNumber,PDFRawStream } from 'pdf-lib';
import { REMOVE_LIMITS as LIMITS,removeError } from './core.js';
import { parsePdfInstructions,pdfLatin } from './lexer.js';
import { collectStampCandidates,removePageStamps } from './stamps.js';
import { formEditTree,rewriteFormCalls } from './form-edits.js';
import { decodeRemovalStream,validateInlineImageSamples } from './content-stream.js';
const N=PDFName.of;
const known=new Set('q Q cm w J j M d ri i gs CS cs SC SCN sc scn G g RG rg K k m l c v y h re S s f F f* B B* b b* n W W* BT ET Tc Tw Tz TL Tf Tr Ts Td TD Tm T* Tj TJ Do BI sh MP DP BMC BDC EMC BX EX'.split(' ').concat(["'",'"']));
const textOperators=new Set(['Tc','Tw','Tz','TL','Tf','Tr','Ts','Td','TD','Tm','T*','Tj','TJ',"'",'"']);
const textPosition=new Set(['Td','TD','Tm','T*']);
const pathPaint=new Set(['S','s','f','F','f*','B','B*','b','b*','sh']);
const graphics=new Set('w J j M d ri i CS cs SC SCN sc scn G g RG rg K k Tc Tw Tz TL Tr Ts'.split(' '));
const arity=Object.fromEntries(Object.entries({0:'q Q h S s f F f* B B* b b* n W W* BT ET T* EMC BX EX',1:'w J j M ri i gs CS cs G g Tc Tw Tz TL Tr Ts Do sh MP',2:'m l d Tf Td TD BDC DP',3:'RG rg',4:'v y re K k',6:'cm c Tm'}).flatMap(([count,names])=>names.split(' ').map(name=>[name,Number(count)])));
function validateInstruction(op){const {name,args}=op;if(arity[name]!==undefined&&args.length!==arity[name])throw removeError('syntax');if(['cm','c','m','l','v','y','re','w','J','j','M','i','G','g','RG','rg','K','k','Tc','Tw','Tz','TL','Tr','Ts','Td','TD','Tm'].includes(name)&&args.some(token=>token.type!=='number'))throw removeError('syntax');if(['gs','CS','cs','ri','Do','sh','MP','BMC'].includes(name)&&args[0]?.type!=='name')throw removeError('syntax');if(name==='BMC'&&args.length!==1)throw removeError('syntax');if(['BDC','DP'].includes(name)&&(args[0]?.type!=='name'||!['dict','name'].includes(args[1]?.type)))throw removeError('syntax');if(name==='d'&&(args[0]?.type!=='array'||args[0].children.some(token=>token.type!=='number')||args[1]?.type!=='number'))throw removeError('syntax');}
const clone=value=>JSON.parse(JSON.stringify(value));
const concat=arrays=>{const result=new Uint8Array(arrays.reduce((sum,array)=>sum+array.length,0));let offset=0;for(const array of arrays){result.set(array,offset);offset+=array.length;}return result;};
function objectValue(object,depth=0){
 if(depth>16)throw removeError('complex');if(object instanceof PDFRef)return `ref:${object}`;
 if(object instanceof PDFDict||object instanceof PDFArray){const dictionary=object instanceof PDFDict,entries=dictionary?object.entries().sort(([a],[b])=>String(a).localeCompare(String(b))):object.asArray();if(entries.length>512)throw removeError('complex');const parts=[];let length=0;for(const entry of entries){const value=dictionary?`${entry[0]}:${objectValue(entry[1],depth+1)}`:objectValue(entry,depth+1);length+=value.length;if(length>65536)throw removeError('complex');parts.push(value);}return(dictionary?'{':'[')+parts.join(',')+(dictionary?'}':']');}
 if(object?.getContents)throw removeError('resource');const value=String(object);if(value.length>65536)throw removeError('complex');return value;
}
function resource(resources,category,name){const dictionary=resources?.lookupMaybe(N(category),PDFDict);const raw=dictionary?.get(N(name));if(!raw)return null;const object=dictionary.context.lookup(raw);return{raw,object,key:category+':'+(category==='ExtGState'?objectValue(object):objectValue(raw))};}
function canonicalOperand(token){if(token.type==='array'||token.type==='dict')return(token.type==='array'?'[':'<<')+token.children.map(canonicalOperand).join(' ')+(token.type==='array'?']':'>>');if(token.type==='name')return '/'+token.name;if(token.type==='number')return String(token.value);return token.raw;}
function canonical(instruction,resources){const args=instruction.args.map(canonicalOperand),first=instruction.args[0];let category=({Tf:'Font',Do:'XObject',gs:'ExtGState',CS:'ColorSpace',cs:'ColorSpace'})[instruction.name];if(category&&first?.type==='name'){const ref=resource(resources,category,first.name);if(ref)args[0]=ref.key;else if(!['DeviceGray','DeviceRGB','DeviceCMYK','Pattern'].includes(first.name))throw removeError('resource');}
 if(['SCN','scn'].includes(instruction.name)&&instruction.args.at(-1)?.type==='name'){const ref=resource(resources,'Pattern',instruction.args.at(-1).name);if(!ref)throw removeError('resource');args[args.length-1]=ref.key;}
 return args.join(' ')+' '+instruction.name;
}
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),byte=>byte.toString(16).padStart(2,'0')).join('');
function multiply(a,b){const values=[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];if(!values.every(Number.isFinite))throw removeError('complex');return values;}
function fontInfo(resources,name){const ref=resource(resources,'Font',name);if(!ref)return{mode:null};const type=String(ref.object.lookup?.(N('Subtype'))),encoding=String(ref.object.lookup?.(N('Encoding'))),base=String(ref.object.lookup?.(N('BaseFont')));let mode=null;if(['/Type1','/TrueType'].includes(type)&&!ref.object.has?.(N('ToUnicode'))){if(encoding==='/WinAnsiEncoding')mode='ansi';else if(['undefined','/StandardEncoding'].includes(encoding)&&/^\/(?:Helvetica(?:-.*)?|Times-(?:Roman|Bold|Italic|BoldItalic)|Courier(?:-.*)?)$/.test(base))mode='ascii';}return{mode};}
function stringLabel(bytes,font){if(font?.mode==='ascii'&&bytes.every(byte=>byte>=32&&byte<=126))return pdfLatin(bytes);if(font?.mode==='ansi'){const text=new TextDecoder('windows-1252').decode(bytes);if(!/[\p{Cc}\p{Cf}]/u.test(text))return text;}return '';}
function artifact(instruction,resources){if(instruction.args[0]?.name!=='Artifact')return false;const property=instruction.args[1];if(!property)return true;if(property.type==='dict')return !property.children.some(token=>token.type==='name'&&token.name==='ActualText');if(property.type==='name'){const ref=resource(resources,'Properties',property.name);return !!ref&&ref.object instanceof PDFDict&&!ref.object.has(N('ActualText'));}return false;}

async function inspect(instructions,resources,resolveDo,pageIndex,{collect=true,initialState,visitForm}={}){
 let state=initialState||{matrix:[1,0,0,1,0,0],values:{},font:null,renderMode:0,clipped:false},block=null;const stack=[],marks=[],candidates=[],paints=[];let compatibility=0;
 const fingerprintState=()=>JSON.stringify({matrix:state.matrix,values:state.values});
 for(let index=0;index<instructions.length;index++){
  const op=instructions[index],{name,args}=op;if(!known.has(name))throw removeError('operator');validateInstruction(op);
  const normalized=canonical(op,resources);
  if(name==='q'){if(args.length||stack.length>=64)throw removeError('syntax');stack.push(clone(state));}
  else if(name==='Q'){if(args.length||!stack.length)throw removeError('syntax');state=stack.pop();}
  else if(name==='cm'){if(args.length!==6||args.some(arg=>arg.type!=='number'))throw removeError('syntax');state.matrix=multiply(state.matrix,args.map(arg=>arg.value));}
  else if(name==='BMC'||name==='BDC'){marks.push(artifact(op,resources));if(marks.length>64)throw removeError('complex');if(block&&!marks.at(-1))block.unsafe=true;}
  else if(name==='EMC'){if(!marks.length)throw removeError('syntax');marks.pop();}
  else if(name==='BX')compatibility++;else if(name==='EX'){if(--compatibility<0)throw removeError('syntax');}
  else if(name==='BT'){if(block||args.length)throw removeError('syntax');block={startIndex:index,start:op.start,entry:fingerprintState(),clipped:state.clipped,unsafe:marks.some(value=>!value),ranges:[],labels:[],shows:0};}
  else if(name==='ET'){
   if(!block||args.length)throw removeError('syntax');
   if(block.shows){const label=block.labels.join(' ').replace(/\s+/g,' ').trim().slice(0,120);paints.push(block.unsafe?{kind:'complex'}:{kind:'text',label});if(!block.unsafe&&collect)candidates.push({kind:'text',label,ranges:block.ranges,signature:block.entry+'|'+instructions.slice(block.startIndex,index+1).map(item=>canonical(item,resources)).join('\n')+(block.clipped?`|unique:${pageIndex}:${block.start}`:'')});}
   block=null;
  }else if(name==='Tf'){
   if(args.length!==2||args[0].type!=='name'||args[1].type!=='number')throw removeError('syntax');state.font=fontInfo(resources,args[0].name);state.values.Tf=normalized;
  }else if(['Tj','TJ',"'",'"'].includes(name)){
   if(!block)throw removeError('syntax');let strings=[],replacement='';
   if(name==='TJ'){if(args.length!==1||args[0].type!=='array'||args[0].children.some(token=>!['string','number'].includes(token.type)))throw removeError('syntax');strings=args[0].children.filter(token=>token.type==='string');}
   else if(name==='"'){if(args.length!==3||args[0].type!=='number'||args[1].type!=='number'||args[2].type!=='string')throw removeError('syntax');strings=[args[2]];replacement=`${args[0].raw} Tw\n${args[1].raw} Tc\nT*\n`;state.values.Tw=args[0].raw+' Tw';state.values.Tc=args[1].raw+' Tc';}
   else{if(args.length!==1||args[0].type!=='string')throw removeError('syntax');strings=[args[0]];if(name==="'")replacement='T*\n';}
   if(state.renderMode<0||state.renderMode>2)block.unsafe=true;
   block.shows+=strings.some(token=>token.value.length)?1:0;block.labels.push(...strings.map(token=>stringLabel(token.value,state.font)));block.ranges.push({start:op.start,end:op.end,replacement});
  }else if(name==='BI'){
   const {width,height,bits,device,interpolate,encoding,data}=op.image;
   const colorSpaces=resources?.lookupMaybe(N('ColorSpace'),PDFDict);
   if(colorSpaces?.has(N('Default'+device)))throw removeError('inline');
   const info={kind:'inline-image',label:'',width,height};
   paints.push(info);
   if(block)block.unsafe=true;
   if(collect&&!block&&!marks.some(value=>!value)){
    const imageSignature=JSON.stringify([width,height,bits,device,interpolate,encoding,await digest(data),op.image.prediction??null,op.image.lzw?.earlyChange??null]);
    candidates.push({...info,ranges:[{start:op.start,end:op.end,replacement:''}],
     signature:fingerprintState()+'|BI|'+imageSignature+(state.clipped?`|unique:${pageIndex}:${op.start}`:'')});
   }
  }else if(name==='Do'){
   if(args.length!==1||args[0].type!=='name')throw removeError('syntax');const info=await resolveDo(resources,args[0].name);paints.push(!block&&!marks.some(value=>!value)&&info?info:{kind:'complex'});if(block)block.unsafe=true;
   if(collect&&!block&&!marks.some(value=>!value)){
    if(info)candidates.push({...info,ranges:[{start:op.start,end:op.end,replacement:''}],signature:fingerprintState()+'|'+normalized+(state.clipped?`|unique:${pageIndex}:${op.start}`:'')});
    else if(visitForm&&!compatibility){
     for (const candidate of await visitForm(resources,op,state,fingerprintState())) {
      if(candidates.length>=LIMITS.candidates)throw removeError('complex');
      candidates.push(candidate);
     }
    }
   }
  }else if(pathPaint.has(name)){paints.push({kind:'vector'});if(block)block.unsafe=true;}
  else if(name==='W'||name==='W*')state.clipped=true;
  else if(graphics.has(name)){state.values[name]=normalized;if(name==='Tr'){if(args.length!==1||args[0].type!=='number'||!Number.isInteger(args[0].value))throw removeError('syntax');state.renderMode=args[0].value;}}
  else if(name==='gs'){
   if(args.length!==1||args[0].type!=='name')throw removeError('syntax');const ref=resource(resources,'ExtGState',args[0].name);if(!(ref?.object instanceof PDFDict))throw removeError('resource');
   for(const [key,value]of ref.object.entries())state.values['gs'+key]=objectValue(value);if(ref.object.has(N('Font')))state.font=null;
  }else if(textPosition.has(name)){
   if(!block)throw removeError('syntax');
   if(name==='TD'){if(args.length!==2||args.some(token=>token.type!=='number'))throw removeError('syntax');state.values.TL=String(-args[1].value)+' TL';}
  }
  if(textOperators.has(name)&&!block&&name!=='Tf'&&!['Tc','Tw','Tz','TL','Tr','Ts'].includes(name))throw removeError('syntax');
 }
 if(block||stack.length||marks.length||compatibility)throw removeError('syntax');return{candidates,paints};
}

const MAX_FORM_DEPTH=4;
const skippedFormKeys=['StructParent','StructParents','OC','Ref','OPI','Alternates','F','FFilter','FDecodeParms'].map(N);
const transparencyKeys=new Set(['Type','S','CS','I','K']);
const transparencyDeviceSpaces=new Set(['DeviceGray','DeviceRGB','DeviceCMYK'].map(N));
const defaultGroupCallerState=new Map([
 ['gs/Type','/ExtGState'],['gs/BM','/Normal'],['gs/ca','1'],['gs/CA','1'],['gs/SMask','/None'],
]);
const complexBackdropPaints=new Set(['Do','sh','CS','cs','SCN','scn']);
function transparencyGroupMode(dict){
 const group=dict.lookup(N('Group'));
 if(!(group instanceof PDFDict)||group.keys().some(key=>!transparencyKeys.has(key.decodeText())))return null;
 if(group.has(N('Type'))&&group.lookup(N('Type'))!==N('Group'))return null;
 if(group.lookup(N('S'))!==N('Transparency'))return null;
 const isolated=group.lookup(N('I'));
 const knockout=group.lookup(N('K'));
 if(isolated===PDFBool.True&&transparencyDeviceSpaces.has(group.lookup(N('CS')))
   &&(!group.has(N('K'))||knockout instanceof PDFBool))return 'isolated';
 if(!group.has(N('CS'))&&(!group.has(N('I'))||isolated===PDFBool.False)){
  if(knockout===PDFBool.True)return 'backdrop';
  if(!group.has(N('K'))||knockout===PDFBool.False)return 'ordinary-backdrop';
 }
 return null;
}
function ordinaryBackdropPaints(form){
 // Keep the direct-to-backdrop preview path free of nested compositing and pattern paints.
 return form.ops.every(({name,args})=>{
  if(complexBackdropPaints.has(name))return false;
  if(name!=='gs')return true;
  const dict=resource(form.local,'ExtGState',args[0]?.name)?.object;
  return dict instanceof PDFDict&&dict.entries().every(([key,value])=>{
   if(key===N('Type'))return value===N('ExtGState');
   if(key===N('BM'))return value===N('Normal')||value===N('Multiply');
   return (key===N('ca')||key===N('CA'))&&value instanceof PDFNumber&&value.asNumber()>=0&&value.asNumber()<=1;
  });
 });
}
function formNumbers(dict,key,count){
 const items=dict.lookup(N(key));
 if(!(items instanceof PDFArray)||items.size()!==count)return null;
 const values=items.asArray().map(item=>dict.context.lookup(item));
 if(!values.every(item=>item instanceof PDFNumber))return null;
 const numbers=values.map(item=>item.asNumber());
 return numbers.every(value=>Number.isFinite(value)&&Math.abs(value)<=1e12)?numbers:null;
}
function editableFormMatrix(dict,groupMode=null){
 if(skippedFormKeys.some(key=>dict.has(key)))return null;
 // A group is only editable through an inner occurrence, never as a plain Do candidate.
 if(dict.has(N('Group'))&&!groupMode)return null;
 const type=dict.lookup(N('FormType'));
 if(dict.has(N('FormType'))&&(!(type instanceof PDFNumber)||type.asNumber()!==1))return null;
 const box=formNumbers(dict,'BBox',4);
 if(!box||box[2]<=box[0]||box[3]<=box[1])return null;
 return dict.has(N('Matrix'))?formNumbers(dict,'Matrix',6):[1,0,0,1,0,0];
}

export async function analyzeRemovalPdf(bytes,{progress=()=>{},check=()=>{}}={}){
 let document;try{document=await PDFDocument.load(bytes.slice(),{updateMetadata:false,throwOnInvalidObject:true});}catch(error){throw removeError(/encrypt|password/i.test(String(error))?'password':'decode');}
 check();if(document.getPageCount()>LIMITS.pages)throw removeError('pages');if(document.context.enumerateIndirectObjects().length>LIMITS.objects)throw removeError('complex');if(new Set(document.getPages().map(page=>page.node)).size!==document.getPageCount())throw removeError('structure');
 const budget={bytes:0,operators:0},pages=[],candidates=[],formCache=new Map(),decodedForms=new Map();
 const stamps=collectStampCandidates(document,check);
 function countOperators(ops){
  budget.operators+=ops.length;
  if(budget.operators>LIMITS.totalOperators)throw removeError('complex');
 }
 async function readForm(ref){
  const key=String(ref.raw);
  if(decodedForms.has(key))return decodedForms.get(key);
  const local=ref.object.dict.lookup(N('Resources'));
  if(!(local instanceof PDFDict))return null;
  const raw=await decodeRemovalStream(ref.object,budget);
  const result={bytes:raw,ops:parsePdfInstructions(raw),local};
  await validateInlineImageSamples(result.ops,document.context,budget);
  decodedForms.set(key,result);
  return result;
 }
 async function resolveDo(resources,name,depth=0){
  if(depth>MAX_FORM_DEPTH)return null;const ref=resource(resources,'XObject',name);if(!ref?.object?.dict)return null;const type=String(ref.object.dict.lookup(N('Subtype')));
  if(type==='/Image'){return{kind:'image',label:'',width:ref.object.dict.lookup(N('Width'))?.asNumber?.()||0,height:ref.object.dict.lookup(N('Height'))?.asNumber?.()||0};}
  if(type!=='/Form'||!(ref.raw instanceof PDFRef)||!(ref.object instanceof PDFRawStream)
     ||!editableFormMatrix(ref.object.dict))return null;
  const key=ref.key+'@'+depth;if(formCache.has(key))return formCache.get(key);formCache.set(key,null);
  try{const form=await readForm(ref);if(!form)return null;countOperators(form.ops);
   const result=await inspect(form.ops,form.local,(r,n)=>resolveDo(r,n,depth+1),-1,{collect:false});if(result.paints.length!==1||!['text','image','text-form','image-form'].includes(result.paints[0].kind))return null;
   const info={...result.paints[0],kind:result.paints[0].kind.startsWith('text')?'text-form':'image-form'};formCache.set(key,info);return info;
  }catch(error){if(/pdf-remove:(decoded|complex)/.test(String(error)))throw error;return null;}
 }
 async function visitForm(resources,op,entryState,entrySignature,pageIndex,ordinaryAllowed,path=[],signatures=[]){
  check();
  if(path.length>=MAX_FORM_DEPTH)return [];
  const name=op.args[0].name,ref=resource(resources,'XObject',name);
  if(!(ref?.raw instanceof PDFRef)||!(ref.object instanceof PDFRawStream)
     ||String(ref.object.dict.lookup(N('Subtype')))!=='/Form')return [];
  const refKey=String(ref.raw);
  if(path.some(step=>step.refKey===refKey))return [];
  const dict=ref.object.dict;
  const groupMode=dict.has(N('Group'))?transparencyGroupMode(dict):null;
  const ordinary=groupMode==='ordinary-backdrop';
  if(ordinary&&(!ordinaryAllowed||['CS','cs','SCN','scn'].some(key=>key in entryState.values)
   ||Object.entries(entryState.values).some(([key,value])=>
   key.startsWith('gs/')&&defaultGroupCallerState.get(key)!==value)))return [];
  const matrix=editableFormMatrix(dict,groupMode);
  if(!matrix)return [];
  const step={name,refKey,start:op.start,end:op.end};
  const nextPath=[...path,step];
  // Clipping and a non-isolated backdrop can differ even at identical transforms.
  const unique=entryState.clipped||ordinary||groupMode==='backdrop';
  const signature=[refKey,entrySignature,unique?nextPath.map(item=>item.start):null];
  const nextSignatures=[...signatures,unique?[pageIndex,...signature]:signature];
  try {
   const form=await readForm(ref);
   if(!form)return [];
   countOperators(form.ops);
   if(ordinary&&!ordinaryBackdropPaints(form))return [];
   const initialState=clone(entryState);
   initialState.matrix=multiply(initialState.matrix,matrix);
   const result=await inspect(form.ops,form.local,(r,n)=>resolveDo(r,n,nextPath.length),pageIndex,{
    initialState,visitForm:(r,call,state,key)=>visitForm(r,call,state,key,pageIndex,ordinaryAllowed&&!groupMode,nextPath,nextSignatures),
   });
   return result.candidates.map(candidate=>candidate.formPath?candidate:{
    ...candidate,formPath:nextPath,formDepth:nextPath.length,
    signature:JSON.stringify([nextSignatures,candidate.ranges[0]?.start,candidate.signature,
     candidate.signature.includes('|unique:')?nextPath.map(item=>item.start):null]),
   });
  } catch(error) {
   if(/pdf-remove:(decoded|complex|cancelled)/.test(String(error)))throw error;
   return [];
  }
 }
 for(let pageIndex=0;pageIndex<document.getPageCount();pageIndex++){
  check();const page=document.getPage(pageIndex),entry={pageIndex,candidates:[],reason:null,bytes:null};
  let drawingCandidates=[];
  try{
   const contents=page.node.Contents(),streams=contents instanceof PDFArray?contents.asArray():contents?[contents]:[],parts=[],streamEnds=[];
   let length=0;
   for(const ref of streams){const data=await decodeRemovalStream(document.context.lookup(ref),budget);if(parts.length){const prior=parts.at(-1);if(prior.length&&data.length&&!/[\x00\t\n\f\r ]/.test(String.fromCharCode(prior.at(-1)))&&!/[\x00\t\n\f\r ]/.test(String.fromCharCode(data[0])))throw removeError('boundary');parts.push(new Uint8Array([10]));length++;}parts.push(data);length+=data.length;streamEnds.push(length);}
   const data=concat(parts);if(data.length>LIMITS.streamBytes)throw removeError('decoded');const instructions=parsePdfInstructions(data,{streamEnds});countOperators(instructions);
   await validateInlineImageSamples(instructions,document.context,budget);
   const result=await inspect(instructions,page.node.Resources(),resolveDo,pageIndex,{
    visitForm:(resources,op,state,key)=>visitForm(resources,op,state,key,pageIndex,!page.node.has(N('Group'))),
   });
   entry.bytes=data;drawingCandidates=result.candidates;
  }catch(error){const code=/pdf-remove:([a-z-]+)/.exec(String(error))?.[1]||'decode';if(['decoded','complex'].includes(code))throw error;entry.reason=code;entry.bytes=null;entry.candidates=[];}
  for(const {signature,...candidate} of [...drawingCandidates,...stamps[pageIndex]]){
   if(candidates.length>=LIMITS.candidates)throw removeError('complex');
   const item={...candidate,id:`${pageIndex}:${entry.candidates.length}`,pageIndex,fingerprint:await digest(signature)};
   entry.candidates.push(item);candidates.push(item);
  }
  pages.push(entry);progress({done:pageIndex+1,total:document.getPageCount()});await new Promise(resolve=>setTimeout(resolve,0));
 }
 const summary={pageCount:pages.length,candidates:candidates.map(({ranges,annotationIndex,popupAnnotationIndex,formPath,...item})=>item),pages:pages.map(({bytes,candidates,...item})=>({...item,count:candidates.length}))};
 return{bytes:bytes.slice(),pages,candidates,summary,decodedForms};
}
export async function buildRemovalPdf(analysis,ids,{check=()=>{},progress=()=>{}}={}){
 const selected=new Set(ids);if(selected.size!==ids.length||selected.size>LIMITS.candidates||ids.some(id=>!analysis.candidates.some(candidate=>candidate.id===id)))throw removeError('selection');check();
 const document=await PDFDocument.load(analysis.bytes.slice(),{updateMetadata:false,throwOnInvalidObject:true});
 const budget={bytes:0};
 for(const page of analysis.pages){
  check();
  const edits=page.candidates.filter(candidate=>selected.has(candidate.id));
  if(!edits.length)continue;
  const target=document.getPage(page.pageIndex);
  const tree=formEditTree(edits);
  if(tree.ranges.length||tree.children.size){
   if(!page.bytes)throw removeError('selection');
   const result=rewriteFormCalls(document.context,target.node.Resources(),page.bytes,tree,analysis.decodedForms,budget,check);
   target.node.set(N('Contents'),document.context.register(document.context.flateStream(result.bytes)));
   if(tree.children.size)target.node.set(N('Resources'),result.resources);
  }
  const annotationIndexes=new Set(edits.filter(candidate=>candidate.kind==='stamp').flatMap(candidate=>
   candidate.popupAnnotationIndex===undefined?[candidate.annotationIndex]:[candidate.annotationIndex,candidate.popupAnnotationIndex]));
  if(annotationIndexes.size)removePageStamps(target,annotationIndexes);
  progress({done:page.pageIndex+1,total:analysis.pages.length});await new Promise(resolve=>setTimeout(resolve,0));
 }
 check();const bytes=await document.save({updateFieldAppearances:false});check();if(bytes.length>LIMITS.outputBytes)throw removeError('output');return bytes;
}
