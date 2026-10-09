const IDENTITY = [1, 0, 0, 1, 0, 0];
const point = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function multiply(a, b) {
  const origin = point(a, b[4], b[5]);
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], ...origin];
}

// PDF.js 6 exposes numeric DrawOPS paths. Ignore curves, clipping paths and
// large fills; only painted straight rules can be evidence of a table grid.
export function extractPdfRules(operatorList, ops) {
  const lines = [];
  const stack = [];
  let matrix = [...IDENTITY];
  const add = (a, b) => {
    if (!a || !b || lines.length >= 3000) return;
    const p = point(matrix, ...a), q = point(matrix, ...b);
    if (!p.concat(q).every(Number.isFinite)) return;
    if (Math.abs(p[1]-q[1]) <= 0.8 && Math.abs(p[0]-q[0]) >= 8) {
      lines.push({ axis: 'h', at: (p[1]+q[1])/2, from: Math.min(p[0],q[0]), to: Math.max(p[0],q[0]) });
    } else if (Math.abs(p[0]-q[0]) <= 0.8 && Math.abs(p[1]-q[1]) >= 8) {
      lines.push({ axis: 'v', at: (p[0]+q[0])/2, from: Math.min(p[1],q[1]), to: Math.max(p[1],q[1]) });
    }
  };
  for (let i=0; i<(operatorList?.fnArray.length || 0) && i<200000; i++) {
    const op = operatorList.fnArray[i], args = operatorList.argsArray[i] || [];
    if (op === ops.save || op === ops.paintFormXObjectBegin) {
      stack.push([...matrix]);
      if (op === ops.paintFormXObjectBegin && args[0]) matrix = multiply(matrix, args[0]);
    } else if (op === ops.restore || op === ops.paintFormXObjectEnd) matrix = stack.pop() || [...IDENTITY];
    else if (op === ops.transform) matrix = multiply(matrix, args);
    else if (op === ops.constructPath) {
      const [paint, data, bounds] = args;
      const stroke = [ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke].includes(paint);
      const thinFill = [ops.fill, ops.eoFill].includes(paint) && bounds
        && Math.min(bounds[2]-bounds[0], bounds[3]-bounds[1]) <= 2;
      if (!stroke && !thinFill) continue;
      const path = data?.[0];
      if (!Array.isArray(path) && !ArrayBuffer.isView(path)) continue;
      let cursor = null, start = null;
      for (let j=0; j<path.length;) {
        const command = path[j++];
        if (command === 0) start = cursor = [path[j++], path[j++]];
        else if (command === 1) { const next = [path[j++], path[j++]]; add(cursor, next); cursor = next; }
        else if (command === 2) { cursor = [path[j+4],path[j+5]]; j += 6; }
        else if (command === 3) { cursor = [path[j+2],path[j+3]]; j += 4; }
        else if (command === 4) { add(cursor,start); cursor = start; }
        else break;
      }
    }
  }
  return lines;
}

function coordinates(values) {
  const result = [];
  for (const value of values.sort((a,b)=>a-b)) {
    if (!result.length || value-result.at(-1)>2) result.push(value);
  }
  return result;
}

function unionSet(count) {
  const parents = Array.from({length: count}, (_,i)=>i);
  const find = i => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i=parents[i]; } return i; };
  return { find, join: (a,b) => { parents[find(b)] = find(a); } };
}

function cellText(items) {
  const rows = [];
  for (const item of [...items].sort((a,b)=>b.baseline-a.baseline || a.x-b.x)) {
    let row = rows.find(row=>Math.abs(row.y-item.baseline)<Math.max(2,item.fontSize*.4));
    if (!row) { row = {y:item.baseline,items:[]}; rows.push(row); }
    row.items.push(item);
  }
  return rows.map(row=> {
    let text='', previous=null;
    for (const item of row.items.sort((a,b)=>a.x-b.x)) {
      const gap = previous ? item.x-previous.right : 0;
      const spaced = previous && (gap>item.fontSize*.25 || /[a-z0-9]$/i.test(text) && /^[a-z0-9]/i.test(item.text));
      text += (spaced ? ' ' : '') + item.text.trim(); previous=item;
    }
    return text.trim();
  }).filter(Boolean).join('\n');
}

export function detectRuledTables(items, rules=[]) {
  const h = rules.filter(line=>line.axis==='h'), v = rules.filter(line=>line.axis==='v');
  const all = [...h,...v], set = unionSet(all.length);
  h.forEach((a,i)=>v.forEach((b,j)=> {
    if (b.at>=a.from-2 && b.at<=a.to+2 && a.at>=b.from-2 && a.at<=b.to+2) set.join(i,h.length+j);
  }));
  const groups = new Map();
  all.forEach((line,i)=> { const key=set.find(i); if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(line); });
  const tables = [];
  for (const group of groups.values()) {
    const horizontal = group.filter(line=>line.axis==='h'), vertical = group.filter(line=>line.axis==='v');
    const xs = coordinates(vertical.map(line=>line.at)), ys = coordinates(horizontal.map(line=>line.at)).reverse();
    const cols=xs.length-1, rows=ys.length-1;
    if (cols<2 || rows<2 || cols>32 || rows>500 || cols*rows>10000) continue;
    const covered = (lines,at,from,to)=> {
      let end=from;
      for (const line of lines.filter(line=>Math.abs(line.at-at)<=2).sort((a,b)=>a.from-b.from)) {
        if (line.from>end+2) break;
        end=Math.max(end,line.to);
        if (end>=to-2) return true;
      }
      return false;
    };
    if (!covered(horizontal,ys[0],xs[0],xs.at(-1)) || !covered(horizontal,ys.at(-1),xs[0],xs.at(-1))
      || !covered(vertical,xs[0],ys.at(-1),ys[0]) || !covered(vertical,xs.at(-1),ys.at(-1),ys[0])) continue;
    const cells=unionSet(rows*cols);
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
      if (r+1<rows && !covered(horizontal,ys[r+1],xs[c],xs[c+1])) cells.join(r*cols+c,(r+1)*cols+c);
      if (c+1<cols && !covered(vertical,xs[c+1],ys[r+1],ys[r])) cells.join(r*cols+c,r*cols+c+1);
    }
    const buckets = new Map(), consumed = new Set();
    for (const item of items) {
      const x=(item.x+item.right)/2, y=item.baseline+item.fontSize*.3;
      const c=xs.findIndex((edge,i)=>i<cols && x>=edge && x<xs[i+1]);
      const r=ys.findIndex((edge,i)=>i<rows && y<=edge && y>ys[i+1]);
      if (c<0 || r<0) continue;
      const key=cells.find(r*cols+c);
      if (!buckets.has(key)) buckets.set(key,[]);
      buckets.get(key).push(item); consumed.add(item);
    }
    if (consumed.size<4 || buckets.size<4) continue;
    const spans=new Map();
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
      const key=cells.find(r*cols+c);
      if (!spans.has(key)) spans.set(key,[]);
      spans.get(key).push({r,c});
    }
    if ([...spans.values()].some(span=> {
      const rs=span.map(cell=>cell.r), cs=span.map(cell=>cell.c);
      return (Math.max(...rs)-Math.min(...rs)+1)*(Math.max(...cs)-Math.min(...cs)+1)!==span.length;
    })) continue;
    const content=Array.from({length:rows},()=>Array(cols).fill(''));
    let merged=false;
    for (const [key,span] of spans) {
      const text=cellText(buckets.get(key) || []), left=Math.min(...span.map(cell=>cell.c));
      merged ||= span.length>1;
      // GFM has no rowspan/colspan. Repeat vertical labels and retain a
      // horizontal merged cell at its first column without inventing values.
      for (const {r,c} of span) if (c===left) content[r][c]=text;
    }
    tables.push({rows:content,columns:cols,xs,top:ys[0],bottom:ys.at(-1),consumed,merged});
  }
  return tables.sort((a,b)=>b.top-a.top || a.xs[0]-b.xs[0]);
}
