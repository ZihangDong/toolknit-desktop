import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
const executable=path.resolve(process.env.TOOLKNIT_FILE_SEARCH_IO_TEST_EXE||'src-tauri/target/debug/toolknit-desktop.exe');
const root=await mkdtemp(path.join(os.tmpdir(),'toolknit-thumbnail-helper-')),inside=path.join(root,'images'),outside=path.join(root,'outside');
await mkdir(inside);await mkdir(outside);
const encode=value=>[...Buffer.from(value,'utf16le')];
async function request(file,scope=inside) {
 const body=Buffer.from(JSON.stringify({action:'thumbnail',path:encode(file),root:encode(scope)}));
 const prefix=Buffer.alloc(4);prefix.writeUInt32LE(body.length);
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,['--file-search-filesystem'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const timer=setTimeout(()=>{child.kill();reject(Error('thumbnail helper deadline exceeded'));},6000);
  let data=Buffer.alloc(0),error='';
  child.stdout.on('data',chunk=>{data=Buffer.concat([data,chunk]);if(data.length>1024*1024){child.kill();reject(Error('unbounded thumbnail response'));}});
  child.stderr.on('data',chunk=>error+=chunk.toString());
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('close',code=>{
   clearTimeout(timer);const frames=[];
   try {while(data.length){assert.ok(data.length>=4);const count=data.readUInt32LE(0);assert.ok(count>0&&count<=512*1024&&count<=data.length-4);frames.push(JSON.parse(data.subarray(4,4+count)));data=data.subarray(4+count);}resolve({code,frames,error});}catch(e){reject(e);}
  });
  child.stdin.end(Buffer.concat([prefix,body]));
 });
}
try {
 const canvas=createCanvas(480,240),ctx=canvas.getContext('2d');ctx.fillStyle='#f01815';ctx.fillRect(0,0,240,240);ctx.fillStyle='#1548e5';ctx.fillRect(240,0,240,240);
 const source=canvas.toBuffer('image/png');canvas.width=canvas.height=1;
 const file=path.join(inside,'合同, photo 🖼.png');await writeFile(file,source);
 const value=await request(file);assert.equal(value.code,0,value.error);assert.equal(value.frames[0].kind,'thumbnail');assert.equal(value.frames.at(-1).kind,'done');
 const image=Buffer.from(value.frames[0].image);assert.ok(image.length<=72*1024);
 const decoded=await loadImage(image);assert.equal(decoded.width,128);assert.equal(decoded.height,64);
 const pixels=createCanvas(128,64),p=pixels.getContext('2d');p.drawImage(decoded,0,0);
 assert.ok(p.getImageData(20,30,1,1).data[0]>200&&p.getImageData(100,30,1,1).data[2]>200);pixels.width=pixels.height=1;
 assert.deepEqual(await readFile(file),source);
 const svg=path.join(inside,'vector, 图形.svg');
 const svgBytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect width="120" height="120" fill="red"/><rect x="120" width="120" height="120" fill="blue"/></svg>');
 await writeFile(svg,svgBytes);const vector=await request(svg);assert.equal(vector.code,0,vector.error);assert.equal(vector.frames[0].kind,'thumbnail');
 const svgImage=await loadImage(Buffer.from(vector.frames[0].image));assert.equal(svgImage.width,128);assert.equal(svgImage.height,64);
 const v=createCanvas(128,64),vc=v.getContext('2d');vc.drawImage(svgImage,0,0);assert.ok(vc.getImageData(20,30,1,1).data[0]>200&&vc.getImageData(100,30,1,1).data[2]>200);v.width=v.height=1;
 assert.deepEqual(await readFile(svg),svgBytes);
 const broken=path.join(inside,'broken.png');await writeFile(broken,'invalid');assert.equal((await request(broken)).frames[0].image,null);
 const foreign=path.join(outside,'outside.png');await writeFile(foreign,source);assert.notEqual((await request(foreign)).code,0,'unapproved paths cannot be decoded');
 await symlink(outside,path.join(inside,'junction'),'junction');assert.equal((await request(path.join(inside,'junction','outside.png'))).frames[0].image,null,'directory junctions cannot borrow the approved scope');
 console.log('Real ordinary-user thumbnail helper passed: UTF-16/Unicode paths, bounded PNG and real SVG pixels, unchanged source, invalid files, scope and junction rejection.');
} finally {assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('toolknit-thumbnail-helper-'));await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
