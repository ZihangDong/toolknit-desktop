import { PDFDocument,PDFName,PDFRawStream,PDFString,StandardFonts,degrees,rgb } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { deflateSync } from 'node:zlib';
const N=PDFName.of;
export async function removalFixture(withWatermarks=true){
 const document=await PDFDocument.create(),font=await document.embedFont(StandardFonts.Helvetica),canvas=createCanvas(120,40),context=canvas.getContext('2d');context.fillStyle='#c54039';context.fillRect(0,0,120,40);context.fillStyle='#f5e4b0';context.fillRect(4,4,112,32);context.fillStyle='#1d436a';context.font='20px sans-serif';context.fillText('SAMPLE',16,28);const image=await document.embedPng(canvas.toBuffer('image/png'));
 let form;if(withWatermarks){const donor=await PDFDocument.create(),donorFont=await donor.embedFont(StandardFonts.Helvetica),sheet=donor.addPage([180,40]);sheet.drawText('FORM-MARK',{x:3,y:10,size:22,font:donorFont,color:rgb(.15,.35,.6)});[form]=await document.embedPdf(await donor.save());}
 for(let index=0;index<3;index++){
  const page=document.addPage([400,500]);if(index===0)page.setCropBox(20,30,360,440);if(index===1)page.setRotation(degrees(90));if(index===2){page.setMediaBox(-20,-10,400,500);page.setCropBox(0,0,360,460);page.setRotation(degrees(270));}
  page.drawRectangle({x:-20,y:-10,width:440,height:530,color:rgb(.96,.91,.78)});page.drawRectangle({x:35,y:190,width:315,height:100,color:rgb(.75,.87,.83)});
  page.drawText(`Body page ${index+1} - preserve this paragraph`,{x:40,y:260,size:13,font});page.drawText('Amounts: 1250.00 / 3456.78',{x:40,y:235,size:13,font});page.drawText('DRAFT',{x:40,y:440,size:10,font});page.drawText(`Footer ${index+1} / 3`,{x:40,y:50,size:10,font});page.drawImage(image,{x:270,y:50,width:80,height:26.6667});
  if(withWatermarks){page.drawText('DRAFT',{x:90,y:210,size:36,font,rotate:degrees(25),opacity:.3,color:rgb(.6,.08,.08)});page.drawImage(image,{x:110,y:300,width:120,height:40,opacity:.4});page.drawPage(form,{x:80,y:125,width:180,height:40,opacity:.5});}
 }
 return document.save({useObjectStreams:true});
}
export async function rawRemovalFixture(){
 const document=await PDFDocument.create(),font=await document.embedFont(StandardFonts.Helvetica),page=document.addPage([400,400]);page.node.set(N('Resources'),document.context.obj({Font:{F0:font.ref}}));
 const prefix='0.9 0.95 0.8 rg 0 0 400 400 re f\n0 0 0 rg\n';
 const watermark='BT /F0 24 Tf 5 Tc 12 TL 1 0 0 1 20 300 Tm (DRAFT_STATE) Tj 3 7 (SECOND_MARK) " ET\n';
 const expectedState='BT /F0 24 Tf 5 Tc 12 TL 1 0 0 1 20 300 Tm 3 Tw 7 Tc T* ET\n';
 const body='BT 1 0 0 1 20 200 Tm (Body inherits spacing) Tj 0 -40 TD (Line one) Tj T* (Line two) Tj ET\n';
 page.node.set(N('Contents'),document.context.register(document.context.flateStream(prefix+watermark+body)));const source=await document.save();page.node.set(N('Contents'),document.context.register(document.context.flateStream(prefix+expectedState+body)));return{source,expected:await document.save()};
}
export async function sharedRemovalFixture(){
 const document=await PDFDocument.create(),font=await document.embedFont(StandardFonts.Helvetica),stream=document.context.register(document.context.flateStream('BT /F0 24 Tf 20 100 Td (SHARED_STAMP) Tj ET\n'));
 for(let i=0;i<2;i++){const page=document.addPage([240,160]);page.node.set(N('Resources'),document.context.obj({Font:{F0:font.ref}}));page.node.set(N('Contents'),stream);}return document.save();
}

export function encodeFixtureAscii85(bytes){
 let result='';
 for(let offset=0;offset<bytes.length;offset+=4){
  const word=bytes.subarray(offset,offset+4);
  let value=0;
  for(let i=0;i<4;i++)value=value*256+(word[i]??0);
  let group='';
  for(let i=0;i<5;i++){group=String.fromCharCode(value%85+33)+group;value=Math.floor(value/85);}
  result+=group.slice(0,word.length+1);
 }
 return Buffer.from(result.replace('EI','EI ')+'~>');
}

function encodedContent(context, content, filter, chain = false, entries = {}){
 const source = Buffer.from(content);
 const data = chain ? deflateSync(source) : source;
 const encoded = filter === 'ASCIIHexDecode'
  ? Buffer.from(data.toString('hex')+'>') : encodeFixtureAscii85(data);
 const options = chain
  ? { Filter:[N(filter),N('FlateDecode')], DecodeParms:[null,{ Predictor:1 }] }
  : { Filter:N(filter) };
 return PDFRawStream.of(context.obj({...entries,...options}),encoded);
}

export function encodeFixtureRunLength(bytes){
 const parts=[];let at=0;
 while(at<bytes.length){
  let repeated=1;
  while(repeated<128&&at+repeated<bytes.length&&bytes[at+repeated]===bytes[at])repeated++;
  if(repeated>=3){parts.push(Buffer.from([257-repeated,bytes[at]]));at+=repeated;continue;}
  const start=at++;
  while(at<bytes.length&&at-start<128){
   if(at+2<bytes.length&&bytes[at]===bytes[at+1]&&bytes[at]===bytes[at+2])break;
   at++;
  }
  parts.push(Buffer.from([at-start-1]),Buffer.from(bytes.subarray(start,at)));
 }
 return Buffer.concat([...parts,Buffer.from([128])]);
}

export function packFixtureLzwCodes(codes,earlyChange=1){
 const bytes=[];let cached=0,bits=0,width=9,next=258,previous=false;
 for(const code of codes){
  if(!Number.isInteger(code)||code<0||code>=2**width)throw new Error('Invalid fixture LZW code');
  cached=(cached<<width)|code;bits+=width;
  while(bits>=8){bits-=8;bytes.push((cached>>>bits)&255);}
  if(code===256){width=9;next=258;previous=false;}
  else if(code!==257){
   if(previous&&next<4096){next++;if(width<12&&next+earlyChange===2**width)width++;}
   previous=true;
  }
 }
 if(bits)bytes.push((cached<<(8-bits))&255);
 return Buffer.from(bytes);
}

export function encodeFixtureLzw(bytes,earlyChange=1,{resetOnFull=true}={}){
 let dictionary,next=258;
 const reset=()=>{dictionary=new Map(Array.from({length:256},(_,index)=>[String.fromCharCode(index),index]));next=258;};
 reset();const codes=[256];let phrase='';
 for(const byte of bytes){
  const character=String.fromCharCode(byte),extended=phrase+character;
  if(dictionary.has(extended)){phrase=extended;continue;}
  codes.push(dictionary.get(phrase));
  if(next<4096)dictionary.set(extended,next++);
  else if(resetOnFull){codes.push(256);reset();}
  phrase=character;
 }
 if(phrase)codes.push(dictionary.get(phrase));
 codes.push(257);
 return packFixtureLzwCodes(codes,earlyChange);
}

function unsupportedContent(context, content){
 // Deliberately reverse the allowed outer-ASCII order; viewers still render it.
 const hex=Buffer.from(Buffer.from(content).toString('hex')+'>');
 return PDFRawStream.of(context.obj({Filter:[N('RunLengthDecode'),N('ASCIIHexDecode')]}),encodeFixtureRunLength(hex));
}

export async function filteredContentFixture(withTarget=true){
 const document=await PDFDocument.create(),{context}=document;
 const font=await document.embedFont(StandardFonts.Helvetica);
 for(const filter of ['ASCIIHexDecode','ASCII85Decode']){
  for(const chain of [false,true]){
   const page=document.addPage([320,180]);
   page.node.set(N('Resources'),context.obj({Font:{F0:font.ref}}));
   const background='0.92 0.96 0.88 rg 0 0 320 180 re f\n0 0 0 rg\n';
   const target=withTarget?'BT /F0 24 Tf 32 100 Td (FILTERED DRAFT) Tj ET\n':'';
   const body='BT /F0 14 Tf 20 40 Td (Searchable filtered body) Tj ET\n';
   const stream=encodedContent(context,background+target+body,filter,chain);
   page.node.set(N('Contents'),context.register(stream));
  }
 }
 return document.save();
}

export function encodeFixturePrediction(data, { predictor, rowBytes, pixelBytes, bits=8, colors=pixelBytes, columns=rowBytes*8/(bits*colors) }) {
 if(predictor===1)return data;
 const rows=[];
 for(let offset=0;offset<data.length;offset+=rowBytes){
  if(predictor===2){
   // TIFF differences are between samples of the same channel, not bytes.
   // Each row starts a new channel history; leave unused row padding alone.
   const row=Buffer.from(data.subarray(offset,offset+rowBytes)),mask=2**bits-1;
   const sample=index=>{
    const bit=index*bits,byte=offset+Math.floor(bit/8);
    return bits===16?data.readUInt16BE(byte):(data[byte]>>>(8-bits-bit%8))&mask;
   };
   for(let index=0;index<columns*colors;index++){
    const value=(sample(index)-(index>=colors?sample(index-colors):0))&mask;
    const bit=index*bits,byte=Math.floor(bit/8);
    if(bits===16)row.writeUInt16BE(value,byte);
    else{const shift=8-bits-bit%8;row[byte]=(row[byte]&~(mask<<shift))|(value<<shift);}
   }
   rows.push(row);
   continue;
  }
  const tag=predictor===15?(offset/rowBytes)%5:predictor-10;
  const row=Buffer.alloc(rowBytes+1);
  row[0]=tag;
  for(let at=0;at<rowBytes;at++){
   const left=at>=pixelBytes?data[offset+at-pixelBytes]:0;
   const up=offset>=rowBytes?data[offset+at-rowBytes]:0;
   const corner=offset>=rowBytes&&at>=pixelBytes?data[offset+at-rowBytes-pixelBytes]:0;
   let prediction=0;
   if(tag===1)prediction=left;
   else if(tag===2)prediction=up;
   else if(tag===3)prediction=Math.floor((left+up)/2);
   else if(tag===4){
    const p=left+up-corner,dl=Math.abs(p-left),du=Math.abs(p-up),dc=Math.abs(p-corner);
    prediction=dl<=du&&dl<=dc?left:du<=dc?up:corner;
   }
   row[at+1]=(data[offset+at]-prediction+256)%256;
  }
  rows.push(row);
 }
 return Buffer.concat(rows);
}

export async function inlineRemovalFixture(withWatermark=true,encoding='raw',predictor=1,options={}){
 const document=await PDFDocument.create(),font=await document.embedFont(StandardFonts.Helvetica);
 const {width=2,height=2,bits=8,color='RGB',earlyChange=1,sampleBytes}=options;
 const [components,longColor]=({G:[1,'DeviceGray'],RGB:[3,'DeviceRGB'],CMYK:[4,'DeviceCMYK']})[color];
 const rowBytes=Math.ceil(width*components*bits/8),pixelBytes=Math.ceil(components*bits/8);
 // Contains PDF-like bytes and high bytes, without a viewer-ambiguous EI token.
 const samples=sampleBytes?Buffer.from(sampleBytes):Object.keys(options).length
  ?Buffer.from(Array.from({length:rowBytes*height},(_,at)=>(at*31+73)%256))
  :Buffer.from([0x25,0x42,0x54,0x45,0x49,0x90,0xff,0x80,0x12,0x33,0x77,0x88]);
 // The first ASCII85 group is EI!!!, with whitespace after EI in the encoded fixture.
 if(!Object.keys(options).length)samples.writeUInt32BE(36*85**4+40*85**3,0);
 const different=Buffer.from(samples);different[0]=Object.keys(options).length?different[0]^0x80:0xaa;
 const filters={
  raw:['',''],
  hex:[' /F /AHx',' /Filter [/ASCIIHexDecode]'],
  ascii85:[' /F /A85',' /Filter [/ASCII85Decode]'],
  flate:[' /F /Fl',' /Filter /FlateDecode'],
  'hex-flate':[' /F [/AHx /Fl]',' /Filter [/ASCIIHexDecode /FlateDecode]'],
  'ascii85-flate':[' /F [/A85 /Fl]',' /Filter [/ASCII85Decode /FlateDecode]'],
  runlength:[' /F /RL',' /Filter [/RunLengthDecode]'],
  'hex-runlength':[' /F [/AHx /RL]',' /Filter [/ASCIIHexDecode /RunLengthDecode]'],
  'ascii85-runlength':[' /F [/A85 /RL]',' /Filter [/ASCII85Decode /RunLengthDecode]'],
  lzw:[' /F /LZW',' /Filter [/LZWDecode]'],
  'hex-lzw':[' /F [/AHx /LZW]',' /Filter [/ASCIIHexDecode /LZWDecode]'],
  'ascii85-lzw':[' /F [/A85 /LZW]',' /Filter [/ASCII85Decode /LZWDecode]'],
 }[encoding];
 const encode=data=>{
  const predicted=encodeFixturePrediction(data,{predictor,rowBytes,pixelBytes,bits,colors:components,columns:width});
  const payload=encoding.endsWith('flate')?deflateSync(predicted):encoding.endsWith('runlength')?encodeFixtureRunLength(predicted)
   :encoding.endsWith('lzw')?encodeFixtureLzw(predicted,earlyChange):predicted;
  if(encoding.startsWith('hex'))return Buffer.from(payload.toString('hex')+'>');
  return encoding.startsWith('ascii85')?encodeFixtureAscii85(payload):payload;
 };
 const params=alternate=>{
  if(encoding.endsWith('lzw')){
   const geometry=predictor===1?'':` /Colors ${components} /Columns ${width} /BitsPerComponent ${bits}`;
   const dictionary=`<< /EarlyChange ${earlyChange} /Predictor ${predictor}${geometry} >>`;
   return ` /${alternate?'DecodeParms':'DP'} ${encoding==='lzw'?(alternate?`[${dictionary}]`:dictionary):`[null ${dictionary}]`}`;
  }
  if(predictor===1)return '';
  const dictionary=`<< /Predictor ${predictor} /Colors ${components} /Columns ${width} /${bits===8&&!alternate?'BPC':'BitsPerComponent'} ${bits} >>`;
  return ` /${alternate?'DecodeParms':'DP'} ${encoding==='flate'?dictionary:`[null ${dictionary}]`}`;
 };
 const writeImage=(data,x,y,alternate=false)=>Buffer.concat([
  Buffer.from(`q 60 0 0 40 ${x} ${y} cm\nBI ${alternate?`/ColorSpace /${longColor} /Height ${height} /Width ${width} /BitsPerComponent ${bits} /Interpolate false`:`/W ${width} /H ${height} /BPC ${bits} /CS /${color}`}${filters[Number(alternate)]}${params(alternate)} ID\n`),
  encode(data),Buffer.from('\nEI\nQ\n'),
 ]);
 for(let index=0;index<2;index++){
  const page=document.addPage([320,230]);
  page.node.set(N('Resources'),document.context.obj({Font:{F0:font.ref}}));
  const paint=[
   Buffer.from('0.9 0.95 0.85 rg 0 0 320 230 re f\n0 0 0 rg\n'),
   writeImage(samples,20,150),
   writeImage(different,120,95),
   ...(withWatermark?[writeImage(samples,120,95,index===1)]:[]),
   Buffer.from('BT /F0 18 Tf 20 40 Td (Body after inline images) Tj ET\n'),
  ];
  page.node.set(N('Contents'),document.context.register(document.context.flateStream(Buffer.concat(paint))));
 }
 return document.save();
}

export async function nestedFormRemovalFixture(removeTargetOnPages=[],removeImageOnPages=[],predictor=1,imageOptions={}){
 const document=await PDFDocument.create(),{context}=document;
 const font=await document.embedFont(StandardFonts.Helvetica);
 const form=(draw,resources)=>context.register(encodedContent(context,draw,'ASCII85Decode',true,{
  Type:N('XObject'),Subtype:N('Form'),FormType:1,BBox:[0,0,300,95],Matrix:[1,0,0,1,4,1],Resources:resources,
 }));
 const innerBody='0.1 0.4 0.7 rg 5 10 70 15 re f\n0 0 0 rg BT /F0 10 Tf 4 35 Td (Shared form text) Tj ET\n';
 const target='BT /F0 15 Tf 4 57 Td (NESTED DRAFT) Tj ET\n';
 const {lzw=false,earlyChange=1}=imageOptions;
 const predicted=encodeFixturePrediction(Buffer.from('zaQ'),{predictor,rowBytes:3,pixelBytes:3});
 const pixels=lzw?encodeFixtureLzw(predicted,earlyChange):deflateSync(predicted);
 const parameters=lzw?` /DP [null << /EarlyChange ${earlyChange} /Predictor ${predictor} /Colors 3 /Columns 1 /BitsPerComponent 8 >>]`
  :predictor===1?'':` /DP [null << /Predictor ${predictor} /Colors 3 /Columns 1 >>]`;
 const image=`q 16 0 0 13 85 11 cm\nBI /W 1 /H 1 /CS /RGB /BPC 8 /F [/A85 /${lzw?'LZW':'Fl'}]${parameters} ID\n${encodeFixtureAscii85(pixels)}\nEI\nQ\n`;
 const inner=form(innerBody+target+image,{Font:{F0:font.ref}});
 const cleanInner=form(innerBody+image,{Font:{F0:font.ref}});
 const textOnlyInner=form(innerBody+target,{Font:{F0:font.ref}});
 const cleanBoth=form(innerBody,{Font:{F0:font.ref}});
 const outerDraw='q 1 0 0 1 0 0 cm /First Do Q\nq 1 0 0 1 135 0 cm /Repeat Do Q\n';
 const makeOuter=first=>form(outerDraw,{XObject:{First:first,Repeat:inner,TKFormEdit0:inner}});
 const pageResources=chosen=>context.register(context.obj({
  Font:{F0:font.ref},XObject:{Outer:chosen,TKFormEdit0:outer},
 }));
 const outer=makeOuter(inner);
 const shared=pageResources(outer),clean=pageResources(makeOuter(cleanInner));
 const imageRemoved=pageResources(makeOuter(textOnlyInner)),bothRemoved=pageResources(makeOuter(cleanBoth));
 for(let index=0;index<3;index++){
  const page=document.addPage([375,235]);
  const textRemoved=removeTargetOnPages.includes(index);
  const removeImage=removeImageOnPages.includes(index);
  page.node.set(N('Resources'),removeImage?(textRemoved?bothRemoved:imageRemoved):(textRemoved?clean:shared));
  const x=index===2?35:12;
  const draw=`0.94 0.96 0.92 rg 0 0 375 235 re f\n0 0 0 rg\nBT /F0 16 Tf 20 185 Td (Page text ${index+1}) Tj ET\nq 1 0 0 1 ${x} 65 cm /Outer Do Q\n`;
  page.node.set(N('Contents'),context.register(context.flateStream(draw)));
 }
 return document.save();
}

export async function stampRemovalFixture(withTargets=true){
 const document=await PDFDocument.create();
 const {context}=document;
 const font=await document.embedFont(StandardFonts.Helvetica);
 const appearance=(paint)=>context.register(context.flateStream(paint,{
  Type:N('XObject'),Subtype:N('Form'),BBox:[0,0,80,30],Resources:{},
 }));
 const red=appearance('0.8 0.1 0.12 rg 0 0 80 30 re f\n');
 const blue=appearance('0.10 0.3 0.8 rg 0 0 80 30 re f\n');
 const placement=[135,85,215,115];
 const stamp=(rect,ap,extra={})=>context.register(context.obj({
  Type:N('Annot'),Subtype:N('Stamp'),Name:N('Draft'),Rect:rect,F:4,AP:{N:ap},...extra,
 }));
 for(let index=0;index<2;index++){
  const page=document.addPage([320,200]);
  page.node.set(N('Resources'),context.obj({Font:{F0:font.ref}}));
  const content=`0.96 0.94 0.88 rg 0 0 320 200 re f\n0 0 0 rg\nBT /F0 16 Tf 20 165 Td (Body on stamp page ${index+1}) Tj ET\n`;
  // The second page can be rendered, but its drawing filter is outside the rewrite whitelist.
  const stream=index===0?context.flateStream(content):unsupportedContent(context,content);
  page.node.set(N('Contents'),context.register(stream));
  const linked=stamp([20,20,100,50],red);
  const reply=context.register(context.obj({
   Type:N('Annot'),Subtype:N('Text'),Rect:[110,20,125,35],Contents:PDFString.of('A reply to the retained stamp'),IRT:linked,RT:N('R'),F:4,
  }));
  const locked=stamp([220,20,300,50],red,{F:132});
  const link=context.register(context.obj({
   Type:N('Annot'),Subtype:N('Link'),Rect:[18,141,92,153],Border:[0,0,0],Dest:[page.ref,N('Fit')],
  }));
  const entries=[link,stamp([20,85,100,115],red),stamp(placement,blue),linked,reply,locked];
  if(withTargets)entries.push(stamp(placement,red));
  page.node.set(N('Annots'),context.register(context.obj(entries)));
 }
 return document.save();
}

export async function unsupportedRemovalFixture(){
 const document=await PDFDocument.create(),font=await document.embedFont(StandardFonts.Helvetica);
 const add=(text,unsupported=false)=>{const page=document.addPage([200,200]);page.node.set(N('Resources'),document.context.obj({Font:{F0:font.ref}}));const stream=unsupported?unsupportedContent(document.context,text):document.context.flateStream(text);page.node.set(N('Contents'),document.context.register(stream));};
 add('BT /F0 12 Tf 20 100 Td (SUPPORTED) Tj ET\n');add('q BI /W 1 /H 1 /CS /RGB /BPC 8 /F /AHx /D [0 1 0 1 0 1] ID\n616263>\nEI Q\n');add('q BT /F0 12 Tf (UNBALANCED) Tj ET\n');add('BT /F0 12 Tf 20 100 Td (RUNLENGTH_BODY) Tj ET\n',true);add('BT /F0 12 Tf 7 Tr (CLIP_TEXT) Tj ET\n');add('/Span << /ActualText (semantic watermark) >> BDC BT /F0 12 Tf (TAGGED) Tj ET EMC\n');add('/Artifact BMC BT /F0 12 Tf 10 20 Td (ARTIFACT) Tj ET EMC\n');return document.save();
}
