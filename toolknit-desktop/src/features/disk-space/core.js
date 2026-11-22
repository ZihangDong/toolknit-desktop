export const DISK_PAGE_SIZE = 100;
export function diskBytes(value) {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw new Error('disk:result');
  const bytes=BigInt(value);if(bytes>18446744073709551615n)throw new Error('disk:result');return bytes;
}
export function formatDiskBytes(value) {
  const bytes=diskBytes(String(value)),units=['B','KiB','MiB','GiB','TiB','PiB','EiB'];let index=0,divisor=1n;
  while(bytes>=divisor*1024n&&index<units.length-1){index++;divisor*=1024n;}
  if(!index)return `${bytes} B`;const whole=bytes/divisor,decimal=(bytes%divisor)*100n/divisor;
  return `${whole}${decimal?'.'+String(decimal).padStart(2,'0').replace(/0$/,''):''} ${units[index]}`;
}
export function diskPercent(value,total) {const numerator=diskBytes(String(value)),denominator=diskBytes(String(total));if(!denominator||!numerator)return '0%';const tenths=numerator*1000n/denominator;return tenths===0n?'<0.1%':`${Number(tenths)/10}%`;}
const integer=value=>Number.isSafeInteger(value)&&value>=0;
function validateNode(node) {
  if(!node||!integer(node.id)||!(node.parent===null||integer(node.parent))||typeof node.name!=='string'||typeof node.path!=='string'||!['file','directory','skipped'].includes(node.kind))throw Error('disk:result');
  diskBytes(node.bytes);diskBytes(node.logicalBytes);return node;
}
export function validateDiskSummary(summary,jobId) {
  if(!summary||summary.jobId!==jobId||!integer(summary.files)||!integer(summary.directories)||!integer(summary.skipped)||!Array.isArray(summary.issues)||summary.issues.length>100)throw Error('disk:result');
  validateNode(summary.root);if(summary.root.id!==0||summary.root.kind!=='directory')throw Error('disk:result');return summary;
}
export function validateDiskView(view,jobId) {
  if(!view||view.jobId!==jobId||!Array.isArray(view.items)||view.items.length>100||!Array.isArray(view.tiles)||view.tiles.length>60||!integer(view.total)||!integer(view.offset)||!Array.isArray(view.breadcrumbs)||view.breadcrumbs.length>65)throw Error('disk:result');
  validateNode(view.node);for(const node of [...view.items,...view.tiles,...view.breadcrumbs])validateNode(node);
  if(view.items.some(node=>node.parent!==view.node.id)||view.tiles.some(node=>node.parent!==view.node.id)||view.breadcrumbs.at(-1)?.id!==view.node.id)throw Error('disk:result');
  diskBytes(view.otherBytes);return view;
}
/** Binary treemap: recursive balanced weights, split along the longer dimension. */
export function diskTreemap(items,width,height) {
  if(!(width>0&&height>0))return [];
  const values=items.filter(item=>diskBytes(item.bytes)>0n).map(item=>({...item,weight:Number(diskBytes(item.bytes))})),rectangles=[];
  function split(group,x,y,w,h) {
    if(group.length===1){rectangles.push({...group[0],x,y,width:w,height:h});return;}
    const total=group.reduce((sum,item)=>sum+item.weight,0);let at=1,left=group[0].weight;
    while(at<group.length-1&&Math.abs(left+group[at].weight-total/2)<Math.abs(left-total/2)){left+=group[at].weight;at++;}
    const fraction=left/total;
    if(w>=h){split(group.slice(0,at),x,y,w*fraction,h);split(group.slice(at),x+w*fraction,y,w*(1-fraction),h);}
    else{split(group.slice(0,at),x,y,w,h*fraction);split(group.slice(at),x,y+h*fraction,w,h*(1-fraction));}
  }
  if(values.length)split(values,0,0,width,height);return rectangles;
}
export function diskCancelled() {return new DOMException('disk:cancelled','AbortError');}
