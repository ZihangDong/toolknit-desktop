/* ============================================================
 * rubiks-cube-core.js —— 图论与魔方 · 核心逻辑
 * 移植自 HBuilderX 版 app.js，按 ToolKnit 项目风格拆分为 core 模块
 * 模型：物理小方块（缩放 2 倍整数坐标，偶数阶精确）
 * 2D 展开图与 3D 视图共享同一份状态，实时联动
 * 依赖：three（npm 依赖，ES module import）
 * 导出：initRubiksCube(rootEl) / disposeRubiksCube()
 * ============================================================ */
'use strict';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/* ---------- 常量 ---------- */
const DIRV = {'+x':[1,0,0],'-x':[-1,0,0],'+y':[0,1,0],'-y':[0,-1,0],'+z':[0,0,1],'-z':[0,0,-1]};
const AXIS_IDX = {x:0, y:1, z:2};
const AXES = ['x','y','z'];
const FACES = ['U','D','F','B','L','R'];
const FACE_CN = {U:'上', D:'下', F:'前', B:'后', L:'左', R:'右'};
const FACE_COLOR = {U:'#ffd500', D:'#f5f5f5', F:'#0051ba', B:'#009b48', R:'#c41e3a', L:'#ff5800', K:'#141a2c'};
const FACE_ANGLE = {U:-90, D:90, R:-90, L:90, F:-90, B:90};
const FACE_AXIS =  {U:'y', D:'y', R:'x', L:'x', F:'z', B:'z'};

/* ---------- 状态 ---------- */
let N = 3;
let cubies = [];
let selected = null;
let layerMem = {};
let uiAxis = 'y';
let moveCount = 0;
let scrambleCount = 0;
let skipMoves = 0;
let initialized = false;
let rootEl = null;

/* ---------- DOM（init 时绑定） ---------- */
let stageEl = null, canvasEl = null, netSvg = null, graphSvg = null;
let formulaModal = null, formulaTabs = null, formulaBody = null;

function $(sel) { return rootEl.querySelector(sel); }
function $all(sel) { return rootEl.querySelectorAll(sel); }

/* ---------- 模型（已验证） ---------- */
function faceKey(axis, sgn, coord, max) {
  const atMax = Math.abs(coord - max) < 1e-9;
  const atMin = Math.abs(coord + max) < 1e-9;
  if (!atMax && !atMin) return 'K';
  const map = {x:{1:'R','-1':'L'}, y:{1:'U','-1':'D'}, z:{1:'F','-1':'B'}};
  return map[axis][sgn];
}
function axisVec(axis) {
  return new THREE.Vector3(axis==='x'?1:0, axis==='y'?1:0, axis==='z'?1:0);
}
function buildCubeData() {
  const max = N - 1;
  const list = [];
  for (let x=-max; x<=max; x+=2)
    for (let y=-max; y<=max; y+=2)
      for (let z=-max; z<=max; z+=2) {
        const colors = {};
        for (const d of Object.keys(DIRV)) {
          const axis = d[1], sgn = d[0]==='+'?1:-1;
          colors[d] = faceKey(axis, sgn, {x,y,z}[axis], max);
        }
        list.push({x, y, z, q: new THREE.Quaternion(), colors, mesh: null});
      }
  return list;
}
function layerVal(layerIdx) { return 2*layerIdx - (N-1); }
function cubieAt(x,y,z) {
  for (const c of cubies) {
    if (Math.abs(c.x-x)<1e-9 && Math.abs(c.y-y)<1e-9 && Math.abs(c.z-z)<1e-9) return c;
  }
  return null;
}
function applyMoveLogical(axis, layerIdx, angleDeg) {
  const val = layerVal(layerIdx);
  const q = new THREE.Quaternion().setFromAxisAngle(axisVec(axis), angleDeg*Math.PI/180);
  const ai = AXIS_IDX[axis];
  for (const c of cubies) {
    const coord = [c.x,c.y,c.z][ai];
    if (Math.abs(coord-val)>1e-9) continue;
    const v = new THREE.Vector3(c.x,c.y,c.z).applyQuaternion(q);
    c.x = Math.round(v.x); c.y = Math.round(v.y); c.z = Math.round(v.z);
    c.q.premultiply(q);
  }
}
function netColor(face, r, c) {
  const max = N-1;
  let x,y,z,dir;
  switch (face) {
    case 'U': x=-max+2*c; y=max; z=-max+2*r; dir='+y'; break;
    case 'D': x=-max+2*c; y=-max; z=max-2*r; dir='-y'; break;
    case 'F': x=-max+2*c; y=max-2*r; z=max; dir='+z'; break;
    case 'B': x=max-2*c; y=max-2*r; z=-max; dir='-z'; break;
    case 'L': x=-max; y=max-2*r; z=-max+2*c; dir='-x'; break;
    case 'R': x=max; y=max-2*r; z=max-2*c; dir='+x'; break;
  }
  const c0 = cubieAt(x,y,z);
  if (!c0) return 'K';
  const wd = new THREE.Vector3(...DIRV[dir]);
  for (const ld of Object.keys(DIRV)) {
    if (new THREE.Vector3(...DIRV[ld]).applyQuaternion(c0.q).distanceTo(wd) < 1e-6) return c0.colors[ld];
  }
  return 'K';
}
function isSolved() {
  for (const face of FACES) {
    const ref = netColor(face,0,0);
    for (let r=0;r<N;r++) for (let c=0;c<N;c++) if (netColor(face,r,c)!==ref) return false;
  }
  return true;
}

/* ---------- 3D 渲染 ---------- */
let renderer, scene, camera, controls, cubeGroup, selBox, selEdge;
let resizeObserver = null;
let winResize3d = null, winResizeNet = null;

function init3D() {
  renderer = new THREE.WebGLRenderer({canvas: canvasEl, antialias:true, alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

  scene.add(new THREE.AmbientLight(0xffffff, 0.88));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(5, 9, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45);
  fill.position.set(-7, -3, -5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.4);
  rim.position.set(-3, 5, -8);
  scene.add(rim);

  cubeGroup = new THREE.Group();
  scene.add(cubeGroup);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.enablePan = false;
  controls.minDistance = N*1.2 + 1.5;
  controls.maxDistance = N*4 + 8;

  const boxGeo = new THREE.BoxGeometry(1,1,1);
  selBox = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({
    color: 0x5cd6ff, transparent:true, opacity:0.16, depthWrite:false
  }));
  selBox.visible = false;
  scene.add(selBox);
  selEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeo),
    new THREE.LineBasicMaterial({color:0x66e0ff, transparent:true, opacity:1.0})
  );
  selEdge.visible = false;
  scene.add(selEdge);

  resize();
  winResize3d = () => resize();
  window.addEventListener('resize', winResize3d);
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stageEl);
  animate();
}
function resize() {
  const w = stageEl.clientWidth, h = Math.max(stageEl.clientHeight, 260);
  renderer.setSize(w, h, false);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}
function frameCamera() {
  const d = N*1.7 + 3.4;
  camera.position.set(d*0.72, d*0.6, d*0.86);
  camera.lookAt(0,0,0);
  controls.target.set(0,0,0);
  controls.minDistance = N*1.2 + 1.5;
  controls.maxDistance = N*4 + 8;
  controls.update();
}
function mat(color) {
  return new THREE.MeshPhongMaterial({color: new THREE.Color(color), shininess: 120, specular: 0x333333});
}
const matCache = {};
function matFor(key) { return matCache[key] || (matCache[key] = mat(FACE_COLOR[key])); }

function createMeshes() {
  while (cubeGroup.children.length) {
    const child = cubeGroup.children.pop();
    if (child.geometry) child.geometry.dispose();
  }
  const geo = new THREE.BoxGeometry(0.94, 0.94, 0.94);
  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({color:0x66e0ff, transparent:true, opacity:0.95});
  for (const c of cubies) {
    const order = ['+x','-x','+y','-y','+z','-z'];
    const hasColor = order.some(d => c.colors[d] !== 'K');
    if (!hasColor) continue;
    const mats = order.map(d => matFor(c.colors[d]));
    c.mesh = new THREE.Mesh(geo, mats);
    c.mesh.position.set(c.x/2, c.y/2, c.z/2);
    c.mesh.quaternion.copy(c.q);
    c.edges = new THREE.LineSegments(edgeGeo, edgeMat);
    c.edges.visible = false;
    c.mesh.add(c.edges);
    cubeGroup.add(c.mesh);
  }
}
function syncMeshes() {
  for (const c of cubies) {
    if (!c.mesh) continue;
    c.mesh.position.set(c.x/2, c.y/2, c.z/2);
    c.mesh.quaternion.copy(c.q);
  }
}
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

/* ---------- 转动动画（枢轴方案） ---------- */
let moveQueue = [];
let busy = false;
let curPivot = null;
let curLayer = null;
let curMove = null;
let rafId = null;

function easeInOut(t) { return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }

function animateMove(axis, layerIdx, angleDeg, speed, done) {
  const q = new THREE.Quaternion().setFromAxisAngle(axisVec(axis), angleDeg*Math.PI/180);
  const val = layerVal(layerIdx);
  const pivot = new THREE.Group();
  cubeGroup.add(pivot);
  curPivot = pivot;
  curLayer = [];
  curMove = {axis, layerIdx, angleDeg};
  for (const c of cubies) {
    if (!c.mesh) continue;
    if (Math.abs([c.x,c.y,c.z][AXIS_IDX[axis]] - val) > 1e-9) continue;
    pivot.attach(c.mesh);
    curLayer.push(c);
  }
  const q0 = new THREE.Quaternion();
  const t0 = performance.now();
  function step(now) {
    if (curPivot !== pivot) return;
    let t = Math.min((now - t0) / speed, 1);
    pivot.quaternion.copy(q0).slerp(q, easeInOut(t));
    if (t < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      pivot.quaternion.copy(q);
      pivot.updateMatrixWorld(true);
      for (const c of curLayer) cubeGroup.attach(c.mesh);
      cubeGroup.remove(pivot);
      curPivot = null; curLayer = null; curMove = null;
      applyMoveLogical(axis, layerIdx, angleDeg);
      syncMeshes();
      afterMove();
      if (done) done();
    }
  }
  rafId = requestAnimationFrame(step);
}
function requestMove(axis, layerIdx, angleDeg, speed) {
  moveQueue.push({axis, layerIdx, angleDeg, speed: speed || 210});
  pump();
}
function pump() {
  if (busy || moveQueue.length === 0) return;
  busy = true;
  const m = moveQueue.shift();
  animateMove(m.axis, m.layerIdx, m.angleDeg, m.speed, () => { busy = false; pump(); });
}
function afterMove() {
  if (skipMoves > 0) skipMoves--;
  else {
    moveCount++;
    $('#moveCount').textContent = moveCount;
  }
  drawNet();
  updateHighlight();
  updateSolved();
}

/* ---------- 2D 展开图渲染 ---------- */
const NET_LAYOUT = {U:[1,0], L:[0,1], F:[1,1], R:[2,1], B:[3,1], D:[1,2]};

function drawGraphBg() {
  let s = '';
  const w = 640, h = 360;
  for (let i=0;i<6;i++) s += `<circle cx="${w/2}" cy="${h/2}" r="${26+i*44}"></circle>`;
  const nodes = [];
  for (let i=0;i<14;i++) {
    const ang = i/14*Math.PI*2;
    const r = 70 + (i%5)*48;
    const x = w/2 + Math.cos(ang)*r, y = h/2 + Math.sin(ang)*r*0.8;
    nodes.push({x,y});
    const cols = ['#35c56c','#3a7bff','#ff5a5a','#ffd23f','#ff9432','#5cd6ff'];
    s += `<circle class="node" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${cols[i%6]}"></circle>`;
  }
  for (let i=0;i<nodes.length;i++) {
    const j = (i+3)%nodes.length;
    s += `<line class="link" x1="${nodes[i].x.toFixed(1)}" y1="${nodes[i].y.toFixed(1)}" x2="${nodes[j].x.toFixed(1)}" y2="${nodes[j].y.toFixed(1)}"></line>`;
  }
  graphSvg.innerHTML = s;
  graphSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
}

function drawNet() {
  const max = N-1;
  const stageElN = netSvg.parentElement;
  const availW = stageElN.clientWidth || 560;
  const budgetH = Math.max(170, Math.min(440, Math.round(window.innerHeight * 0.34)));
  const cell = Math.max(8, Math.min(
    Math.floor((availW - 18) / (4*N)),
    Math.floor((budgetH - 18) / (3*N))
  ));
  const pad = 9;
  const W = pad*2 + 4*N*cell;
  const H = pad*2 + 3*N*cell;
  netSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  netSvg.setAttribute('width', W);
  netSvg.setAttribute('height', H);
  netSvg.style.width = 'auto';
  netSvg.style.height = 'auto';
  netSvg.style.maxWidth = '100%';
  netSvg.style.margin = '0 auto';

  let s = '';
  for (const face of FACES) {
    const [gx, gy] = NET_LAYOUT[face];
    const x0 = pad + gx*N*cell, y0 = pad + gy*N*cell;
    s += `<rect x="${x0}" y="${y0}" width="${N*cell}" height="${N*cell}" rx="${Math.min(6,cell*0.35)}" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)"></rect>`;
    for (let r=0;r<N;r++) for (let c=0;c<N;c++) {
      const key = netColor(face, r, c);
      const x = x0 + c*cell, y = y0 + r*cell;
      let cls = 'cell';
      if (selected && isInLayer(cubieOf(face, r, c), selected.axis, selected.layerIdx)) cls += ' hot';
      const rr = Math.max(0.5, cell*0.16);
      s += `<rect class="${cls}" x="${x+0.6}" y="${y+0.6}" width="${cell-1.2}" height="${cell-1.2}" rx="${rr}" fill="${FACE_COLOR[key]}"></rect>`;
    }
    const hot = selected && selected.axis === FACE_AXIS[face] &&
                selected.layerIdx === (FACE_AXIS[face]==='y' ? (face==='U'?max:0) : FACE_AXIS[face]==='x' ? (face==='R'?max:0) : (face==='F'?max:0));
    s += `<text class="face-label${hot?' hot':''}" x="${x0+4}" y="${y0+13}" font-size="11">${face}</text>`;
  }
  netSvg.innerHTML = s;
}
function cubieOf(face, r, c) {
  const max = N-1;
  let x,y,z;
  switch (face) {
    case 'U': x=-max+2*c; y=max; z=-max+2*r; break;
    case 'D': x=-max+2*c; y=-max; z=max-2*r; break;
    case 'F': x=-max+2*c; y=max-2*r; z=max; break;
    case 'B': x=max-2*c; y=max-2*r; z=-max; break;
    case 'L': x=-max; y=max-2*r; z=-max+2*c; break;
    case 'R': x=max; y=max-2*r; z=max-2*c; break;
  }
  return {x,y,z};
}
function isInLayer(cube, axis, layerIdx) {
  if (!cube) return false;
  return Math.abs(cube[axis] - layerVal(layerIdx)) < 1e-9;
}

function bindNetSvg() {
  netSvg.addEventListener('pointerdown', (e) => {
    const rect = netSvg.getBoundingClientRect();
    const vb = netSvg.viewBox.baseVal;
    const px = (e.clientX - rect.left) / rect.width * vb.width;
    const py = (e.clientY - rect.top) / rect.height * vb.height;
    const pad = 9;
    const max = N-1;
    const cell = (vb.width - pad*2) / (4*N);
    const gx = Math.floor((px - pad) / (N*cell));
    const gy = Math.floor((py - pad) / (N*cell));
    let face = null;
    for (const f of FACES) {
      const [fx, fy] = NET_LAYOUT[f];
      if (fx===gx && fy===gy) { face = f; break; }
    }
    if (!face) return;
    const c = Math.floor((px - pad - gx*N*cell) / cell);
    const r = Math.floor((py - pad - gy*N*cell) / cell);
    if (c<0||c>=N||r<0||r>=N) return;
    if (e.button === 2) {
      const cub = cubieOf(face, r, c);
      const layerIdx = (cub.y + max)/2;
      selectLayer('y', layerIdx, findFace('y', layerIdx) || undefined);
      return;
    }
    const axis = FACE_AXIS[face];
    const layerIdx = axis==='y' ? (face==='U'?max:0) : axis==='x' ? (face==='R'?max:0) : (face==='F'?max:0);
    selectLayer(axis, layerIdx, face);
  });
  netSvg.addEventListener('contextmenu', (e) => e.preventDefault());
}

/* ---------- 选择与联动高亮 ---------- */
function selectLayer(axis, layerIdx, faceName) {
  selected = {axis, layerIdx};
  layerMem[axis] = layerIdx;
  if (faceName) {
    $all('#faceBtns .chip').forEach(b => b.classList.toggle('active', b.dataset.face === faceName));
  }
  uiAxis = axis;
  $all('#axisBtns .chip').forEach(b => b.classList.toggle('active', b.dataset.axis===axis));
  rebuildLayerBtns();
  updateHighlight();
  updateSelInfo();
}
function updateSelInfo() {
  const el = $('#selInfo');
  if (!selected) { el.innerHTML = '未选择 · 点击魔方或展开图选层'; return; }
  const {axis, layerIdx} = selected;
  const face = findFace(axis, layerIdx);
  el.innerHTML = face
    ? `选中：<b>${face}</b>（${FACE_CN[face]}）· ${axis.toUpperCase()} 第${layerIdx+1}/${N} 层`
    : `选中：<b>${axis.toUpperCase()}</b> 第${layerIdx+1}/${N} 层（中层）`
}
function findFace(axis, layerIdx) {
  const max = N-1;
  if (axis==='y') return layerIdx===max?'U':layerIdx===0?'D':null;
  if (axis==='x') return layerIdx===max?'R':layerIdx===0?'L':null;
  return layerIdx===max?'F':layerIdx===0?'B':null;
}
function updateHighlight() {
  if (!selected) {
    selBox.visible = false; selEdge.visible = false;
    for (const c of cubies) if (c.edges) c.edges.visible = false;
    drawNet();
    return;
  }
  const {axis, layerIdx} = selected;
  const max = N-1;
  selBox.visible = true; selEdge.visible = true;
  const sx = axis==='x'?1.0:N, sy = axis==='y'?1.0:N, sz = axis==='z'?1.0:N;
  selBox.scale.set(sx, sy, sz);
  selEdge.scale.set(sx, sy, sz);
  const pos = layerVal(layerIdx)/2;
  selBox.position.set(axis==='x'?pos:0, axis==='y'?pos:0, axis==='z'?pos:0);
  selEdge.position.copy(selBox.position);
  const val = layerVal(layerIdx);
  const ai = AXIS_IDX[axis];
  for (const c of cubies) {
    if (!c.mesh || !c.edges) continue;
    c.edges.visible = Math.abs([c.x,c.y,c.z][ai] - val) < 1e-9;
  }
  drawNet();
}
function rebuildLayerBtns() {
  const wrap = $('#layerBtns');
  let s = '';
  for (let i=0;i<N;i++) {
    const active = selected && selected.axis===uiAxis && selected.layerIdx===i;
    s += `<button class="chip${active?' active':''}" data-layer="${i}">${i+1}</button>`;
  }
  wrap.innerHTML = s;
  wrap.querySelectorAll('.chip').forEach(b => {
    b.addEventListener('click', () => selectLayer(uiAxis, +b.dataset.layer));
  });
}

/* ---------- 3D 交互：点击选层 / 拖拽转动 ---------- */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;

function pickPointer(e) {
  const rect = canvasEl.getBoundingClientRect();
  ndc.x = ((e.clientX-rect.left)/rect.width)*2-1;
  ndc.y = -((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(cubeGroup.children, false);
  if (hits.length===0) return null;
  const hit = hits[0];
  const mesh = hit.object;
  const n = hit.face.normal.clone().applyQuaternion(mesh.quaternion).normalize();
  const axis = Math.abs(n.x)>=Math.abs(n.y) && Math.abs(n.x)>=Math.abs(n.z) ? 'x'
             : Math.abs(n.y)>=Math.abs(n.z) ? 'y' : 'z';
  return {mesh, cubie: cubieOfMesh(mesh), axis, normal: n, point: hit.point};
}
function cubieOfMesh(mesh) {
  for (const c of cubies) if (c.mesh===mesh) return c;
  return null;
}
function bind3DCanvas() {
  canvasEl.addEventListener('pointerdown', (e) => {
    try { canvasEl.setPointerCapture(e.pointerId); } catch (err) {}
    const info = pickPointer(e);
    if (!info) { drag = {orbit:true}; return; }
    if (e.button === 2) {
      const max = N-1;
      const layerIdx = (info.cubie.y + max)/2;
      selectLayer('y', layerIdx, findFace('y', layerIdx) || undefined);
      return;
    }
    drag = {orbit:false, info, startX:e.clientX, startY:e.clientY, moved:false, triggered:false};
    controls.enabled = false;
  });
  canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
  canvasEl.addEventListener('pointermove', (e) => {
    if (!drag || drag.orbit) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx,dy) > 9) {
      drag.moved = true;
      doDragRotate(drag.info, dx, dy);
    }
  });
  canvasEl.addEventListener('pointerup', endDrag);
  canvasEl.addEventListener('pointercancel', endDrag);
  canvasEl.addEventListener('pointerleave', (e) => { if (drag && drag.orbit) drag=null; });
}
function doDragRotate(info, dx, dy) {
  const c = info.cubie;
  const p = new THREE.Vector3(c.x, c.y, c.z);
  if (selected && isInLayer(c, selected.axis, selected.layerIdx)) {
    const ang = angleForAxis(selected.axis, c, dx, dy);
    if (ang !== null) {
      requestMove(selected.axis, selected.layerIdx, ang, 230);
      return;
    }
  }
  let bestAxis = null, bestAngle = 0, bestScore = -1;
  for (const a of AXES) {
    if (a === info.axis) continue;
    const av = axisVec(a);
    const t = new THREE.Vector3().crossVectors(av, p);
    if (t.lengthSq() < 1e-6) continue;
    const p1 = project3D(p.clone().add(t).multiplyScalar(1.0));
    const p0 = project3D(p.clone().multiplyScalar(1.0));
    const sx = p1.x - p0.x, sy = -(p1.y - p0.y);
    const score = sx*dx + sy*dy;
    if (Math.abs(score) > bestScore) {
      bestScore = Math.abs(score);
      bestAxis = a;
      bestAngle = score > 0 ? 90 : -90;
    }
  }
  if (!bestAxis) return;
  const max = N-1;
  const coord = [c.x,c.y,c.z][AXIS_IDX[bestAxis]];
  const layerIdx = (coord + max)/2;
  requestMove(bestAxis, layerIdx, bestAngle, 230);
  selectLayer(bestAxis, layerIdx);
}
function angleForAxis(a, c, dx, dy) {
  const p = new THREE.Vector3(c.x, c.y, c.z);
  const t = new THREE.Vector3().crossVectors(axisVec(a), p);
  if (t.lengthSq() < 1e-6) return null;
  const p1 = project3D(p.clone().add(t).multiplyScalar(1.0));
  const p0 = project3D(p.clone().multiplyScalar(1.0));
  const sx = p1.x - p0.x, sy = -(p1.y - p0.y);
  const score = sx*dx + sy*dy;
  if (Math.abs(score) < 1e-3) return null;
  return score > 0 ? 90 : -90;
}
function project3D(v3) {
  const v = v3.clone().project(camera);
  return {x: v.x, y: v.y};
}
function endDrag(e) {
  if (drag && !drag.orbit) {
    if (!drag.moved) {
      const info = drag.info;
      const max = N-1;
      const coord = [info.cubie.x, info.cubie.y, info.cubie.z][AXIS_IDX[info.axis]];
      const layerIdx = (coord + max)/2;
      selectLayer(info.axis, layerIdx, findFace(info.axis, layerIdx)||undefined);
    }
    controls.enabled = true;
  }
  drag = null;
}

/* ---------- 控制面板 ---------- */
function bindControls() {
  $all('#faceBtns .chip').forEach(b => {
    b.addEventListener('click', () => {
      const f = b.dataset.face;
      const max = N-1;
      const axis = FACE_AXIS[f];
      const layerIdx = axis==='y' ? (f==='U'?max:0) : axis==='x' ? (f==='R'?max:0) : (f==='F'?max:0);
      selectLayer(axis, layerIdx, f);
    });
  });
  $all('#axisBtns .chip').forEach(b => {
    b.addEventListener('click', () => {
      uiAxis = b.dataset.axis;
      const layerIdx = selected && selected.axis===uiAxis ? selected.layerIdx : N-1;
      selectLayer(uiAxis, layerIdx);
    });
  });
  $('#cwBtn').addEventListener('click', () => rotateSelected(1));
  $('#ccwBtn').addEventListener('click', () => rotateSelected(-1));
  $('#scrambleBtn').addEventListener('click', () => {
    const moves = Math.min(44, N*6);
    scrambleCount = moves;
    moveCount = 0;
    skipMoves = moves;
    $('#scrambleCount').textContent = moves;
    $('#moveCount').textContent = '0';
    for (let i=0;i<moves;i++) {
      const axis = AXES[(Math.random()*3)|0];
      const layerIdx = (Math.random()*N)|0;
      const angle = Math.random()<0.5 ? 90 : -90;
      moveQueue.push({axis, layerIdx, angleDeg:angle, speed:65});
    }
    pump();
  });
  $('#resetBtn').addEventListener('click', resetCube);
  $all('.size-switch button').forEach(b => {
    b.addEventListener('click', () => {
      const sz = +b.dataset.size;
      if (sz === N) return;
      N = sz;
      $all('.size-switch button').forEach(x => x.classList.toggle('active', +x.dataset.size===N));
      resetCube();
      if (formulaModal && !formulaModal.hidden) buildFormulaPanel();
    });
  });
}
function rotateSelected(dir) {
  if (!selected) return;
  const {axis, layerIdx} = selected;
  const face = findFace(axis, layerIdx);
  const angle = face ? FACE_ANGLE[face]*dir : -90*dir;
  requestMove(axis, layerIdx, angle, 220);
}

/* ---------- 键盘控制（仅在 overlay 打开时响应） ---------- */
const KEY_AXIS_CYCLE = [['y','横'], ['x','纵'], ['z','面']];
let axisModeIdx = 0;
function cycleAxisMode() {
  axisModeIdx = (axisModeIdx + 1) % KEY_AXIS_CYCLE.length;
  const [axis] = KEY_AXIS_CYCLE[axisModeIdx];
  const max = N-1;
  const nIdx = selected ? Math.min(selected.layerIdx, max) : max;
  selectLayer(axis, nIdx, findFace(axis, nIdx) || undefined);
}
function keydownHandler(e) {
  if (!rootEl || !rootEl.classList.contains('visible')) return;
  const t = e.target;
  if (t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)) return;
  if ((e.ctrlKey && e.key !== 'Control') || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const max = N-1;
  const dm = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (dm) {
    const n = +dm[1];
    if (n >= 1 && n <= N) {
      const axis = selected ? selected.axis : uiAxis;
      selectLayer(axis, n - 1, findFace(axis, n - 1) || undefined);
    }
    e.preventDefault();
    return;
  }
  const move = (axis, delta) => {
    const base = layerMem[axis] !== undefined ? layerMem[axis] : (delta>0 ? max : 0);
    const nIdx = Math.max(0, Math.min(max, base + delta));
    selectLayer(axis, nIdx, findFace(axis, nIdx) || undefined);
  };
  switch (k) {
    case 'w': move('y', +1); break;
    case 's': move('y', -1); break;
    case 'a': move('x', -1); break;
    case 'd': move('x', +1); break;
    case 'q': move('z', +1); break;
    case 'e': move('z', -1); break;
    case 'r': cycleAxisMode(); break;
    case 'control': rotateSelected(-1); break;
    case ' ': rotateSelected(1); break;
    default: return;
  }
  e.preventDefault();
}

/* ---------- 打乱 / 还原 / 阶数 ---------- */
function resetCube() {
  if (curPivot) {
    cancelAnimationFrame(rafId);
    for (const c of curLayer) cubeGroup.attach(c.mesh);
    cubeGroup.remove(curPivot);
    curPivot = null; curLayer = null; curMove = null;
    syncMeshes();
  }
  moveQueue.length = 0;
  busy = false;
  moveCount = 0;
  scrambleCount = 0;
  $('#moveCount').textContent = '0';
  $('#scrambleCount').textContent = '0';
  selected = null;
  $all('#faceBtns .chip').forEach(b => b.classList.remove('active'));
  buildScene();
}
function buildScene() {
  cubies = buildCubeData();
  createMeshes();
  syncMeshes();
  frameCamera();
  rebuildLayerBtns();
  drawNet();
  updateHighlight();
  updateSelInfo();
  updateSolved();
}
function updateSolved() {
  const el = $('#solvedBadge');
  el.classList.toggle('show', isSolved());
}

/* ---------- 复原公式面板（2/4/5/高阶按阶数） ---------- */
const PANEL_2 = {
  tabs: '<button class="tab active" data-tab="o2">2 阶 · 面先法</button>',
  body: `<div class="tab-pane active" id="pane-o2">
  <div class="fc-note-only">面先法（ORTEGA）：先拼任意一面 → OLL 翻好顶面 → PBL 同时调整上下两层。2 阶没有中心块与棱块，公式比 3 阶短得多</div>
  <div class="sec-label">1 · 底面</div>
  <div class="fc"><span class="fc-name">拼底面</span><span class="fc-note">无固定公式：先拼出任意一面（同色即可），侧面颜色暂不需对齐</span></div>
  <div class="sec-label">2 · 顶面翻色 OLL</div>
  <div class="fc"><span class="fc-name">Sune 小鱼</span><div class="fc-alg" data-alg="R U R' U R U2 R'"><code>R U R' U R U2 R'</code><span class="copy-tip"></span></div></div>
  <div class="fc"><span class="fc-name">Anti-Sune</span><div class="fc-alg" data-alg="R U2 R' U' R U' R'"><code>R U2 R' U' R U' R'</code><span class="copy-tip"></span></div></div>
  <div class="fc"><span class="fc-name">十字型</span><div class="fc-alg" data-alg="F R U R' U' F'"><code>F R U R' U' F'</code><span class="copy-tip"></span></div></div>
  <div class="fc"><span class="fc-name">T 型</span><div class="fc-alg" data-alg="R U R' U' R' F R F'"><code>R U R' U' R' F R F'</code><span class="copy-tip"></span></div></div>
  <div class="fc"><span class="fc-name">双头灯</span><div class="fc-alg" data-alg="R U R' U R U' R' U R U2 R'"><code>R U R' U R U' R' U R U2 R'</code><span class="copy-tip"></span></div></div>
  <div class="fc"><span class="fc-name">蝴蝶结</span><div class="fc-alg" data-alg="F R' F' R U R' F'"><code>F R' F' R U R' F'</code><span class="copy-tip"></span></div></div>
  <div class="sec-label">3 · 两层调整 PBL</div>
  <div class="fc"><span class="fc-name">对角换 Y</span><div class="fc-alg" data-alg="F R U' R' U' R U R' F' R U R' U' R' F R F'"><code>F R U' R' U' R U R' F' R U R' U' R' F R F'</code><span class="copy-tip"></span></div></div>
  <div class="fc"><span class="fc-name">上下对角</span><div class="fc-alg" data-alg="R2 F2 R2"><code>R2 F2 R2</code><span class="copy-tip"></span></div></div>
  <div class="fc"><span class="fc-name">前棱互换</span><div class="fc-alg" data-alg="R2 U' R2 U2' R2 U' R2"><code>R2 U' R2 U2' R2 U' R2</code><span class="copy-tip"></span></div></div>
  <div class="fc"><span class="fc-name">后棱互换</span><div class="fc-alg" data-alg="R2 U R2 U2 F2 U' F2"><code>R2 U R2 U2 F2 U' F2</code><span class="copy-tip"></span></div></div>
</div>`
};
const PANEL_4 = {
  tabs: '<button class="tab active" data-tab="o4">4 阶 · 降阶法</button>',
  body: `<div class="tab-pane active" id="pane-o4">
  <div class="fc-note-only">4 阶降阶法：合并 2×2 中心块 → 合并棱 → 按 3 阶还原 → 处理特殊情况（奇偶校验）。降阶完成后可能出现 3 阶无法还原的情况，用下面的特殊公式</div>
  <div class="sec-label">1 · 合并中心</div>
  <div class="fc"><span class="fc-name">合并中心块</span><span class="fc-note">无固定公式：用「Rw U Rw'」类手法把同色中心小块并成 2×2</span></div>
  <div class="sec-label">2 · 合并棱</div>
  <div class="fc"><span class="fc-name">最后两棱</span><div class="fc-alg" data-alg="Uw' R U R' F R' F' R Uw"><code>Uw' R U R' F R' F' R Uw</code><span class="copy-tip"></span></div><span class="fc-note">只剩最后两组棱未合并时使用</span></div>
  <div class="sec-label">3 · 特殊情况（3 阶无法还原时）</div>
  <div class="fc"><span class="fc-name">OLL 翻单棱</span><div class="fc-alg" data-alg="Rw U2 x Rw U2 Rw U2 Rw' U2 Lw U2 Rw' U2 Rw U2 Rw' U2 Rw'"><code>Rw U2 x Rw U2 Rw U2 Rw' U2 Lw U2 Rw' U2 Rw U2 Rw' U2 Rw'</code><span class="copy-tip"></span></div><span class="fc-note">顶面出现奇数条黄棱（单棱翻）时使用</span></div>
  <div class="fc"><span class="fc-name">PLL 对棱换</span><div class="fc-alg" data-alg="Rw2 R2 U2 Rw2 R2 Uw2 Rw2 R2 Uw2"><code>Rw2 R2 U2 Rw2 R2 Uw2 Rw2 R2 Uw2</code><span class="copy-tip"></span></div><span class="fc-note">顶层只剩一对棱需要互换时使用</span></div>
  <div class="fc"><span class="fc-name">邻棱换</span><span class="fc-note">先做一次「PLL 对棱换」公式，再按 3 阶三棱换公式处理</span></div>
</div>`
};
const PANEL_5 = {
  tabs: '<button class="tab active" data-tab="o5">5 阶 · 降阶法</button>',
  body: `<div class="tab-pane active" id="pane-o5">
  <div class="fc-note-only">5 阶降阶法：合并 3×3 中心块 → 合并棱（三棱一组）→ 按 3 阶还原。5 阶是奇数阶，没有 OLL/PLL 奇偶校验，但最后两棱有专门公式</div>
  <div class="sec-label">1 · 合并中心</div>
  <div class="fc"><span class="fc-name">合并中心块</span><span class="fc-note">无固定公式：先拼中心 3×3（先中心条再补角），手法与 4 阶类似</span></div>
  <div class="sec-label">2 · 合并棱</div>
  <div class="fc"><span class="fc-name">对棱公式</span><div class="fc-alg" data-alg="Rw2 F2 U2 Rw2 U2 F2 Rw2"><code>Rw2 F2 U2 Rw2 U2 F2 Rw2</code><span class="copy-tip"></span></div></div>
  <div class="sec-label">3 · 最后两棱（特殊情况）</div>
  <div class="fc"><span class="fc-name">最后两棱</span><div class="fc-alg" data-alg="Rw2 B2 U2 Lw U2 Rw' U2 Rw U2 F2 Rw F2 Lw' B2 Rw2"><code>Rw2 B2 U2 Lw U2 Rw' U2 Rw U2 F2 Rw F2 Lw' B2 Rw2</code><span class="copy-tip"></span></div><span class="fc-note">最后两组棱色相不正确时使用</span></div>
  <div class="fc"><span class="fc-name">单翻内棱块</span><div class="fc-alg" data-alg="Rw U2 x Rw U2 Rw U2 Rw' U2 Lw U2 3Rw' U2 Rw U2 Rw' U2 Rw'"><code>Rw U2 x Rw U2 Rw U2 Rw' U2 Lw U2 3Rw' U2 Rw U2 Rw' U2 Rw'</code><span class="copy-tip"></span></div><span class="fc-note">进阶：内层单棱翻转的特殊情况</span></div>
</div>`
};
const PANEL_HIGH = {
  tabs: '<button class="tab active" data-tab="oh">6/7 阶 · 降阶法</button>',
  body: `<div class="tab-pane active" id="pane-oh">
  <div class="fc-note-only">6 阶（偶数）与 7 阶（奇数）都用降阶法：合并中心块 → 合并棱 → 按 3 阶还原。核心思想与 4/5 阶一致，只是中心更大、棱更多</div>
  <div class="sec-label">1 · 合并中心</div>
  <div class="fc"><span class="fc-name">合并中心块</span><span class="fc-note">无固定公式：一行一行拼中心（6 阶 4×4、7 阶 5×5），再补中心角</span></div>
  <div class="sec-label">2 · 合并棱</div>
  <div class="fc"><span class="fc-name">并棱手法</span><span class="fc-note">与 4/5 阶相同：用「Uw' R U R' F R' F' R Uw」类公式逐组拼棱</span></div>
  <div class="sec-label">3 · 特殊情况</div>
  <div class="fc"><span class="fc-name">6 阶（偶数）奇偶校验</span><span class="fc-note">OLL 翻棱 / PLL 对棱换公式与 4 阶相同，直接套用 4 阶面板里的 OLL 翻单棱、PLL 对棱换公式</span></div>
  <div class="fc"><span class="fc-name">7 阶（奇数）</span><span class="fc-note">最后两棱特殊情况与 5 阶相同，套用 5 阶面板的最后两棱 / 单翻内棱公式</span></div>
</div>`
};

function buildFormulaPanel() {
  const tabsEl = $('#formulaTabs');
  const bodyEl = $('.modal-body');
  if (N === 3) {
    tabsEl.innerHTML = formulaTabsDefault;
    bodyEl.innerHTML = formulaBodyDefault;
    renderFormulaCases();
  }
  else if (N === 2) { tabsEl.innerHTML = PANEL_2.tabs; bodyEl.innerHTML = PANEL_2.body; }
  else if (N === 4) { tabsEl.innerHTML = PANEL_4.tabs; bodyEl.innerHTML = PANEL_4.body; }
  else if (N === 5) { tabsEl.innerHTML = PANEL_5.tabs; bodyEl.innerHTML = PANEL_5.body; }
  else { tabsEl.innerHTML = PANEL_HIGH.tabs; bodyEl.innerHTML = PANEL_HIGH.body; }
}
let formulaTabsDefault = '', formulaBodyDefault = '';

function bindFormulaModal() {
  formulaModal = $('#formulaModal');
  formulaTabs = $('#formulaTabs');
  formulaBody = $('.modal-body');
  formulaTabsDefault = formulaTabs.innerHTML;
  formulaBodyDefault = formulaBody.innerHTML;
  $('#formulaBtn').addEventListener('click', () => { buildFormulaPanel(); formulaModal.hidden = false; });
  $('#formulaClose').addEventListener('click', () => { formulaModal.hidden = true; });
  formulaModal.addEventListener('click', (e) => { if (e.target === formulaModal) formulaModal.hidden = true; });
  formulaTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    $all('#formulaTabs .tab').forEach(t => t.classList.toggle('active', t === tab));
    $all('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab.dataset.tab));
  });
  formulaBody.addEventListener('click', (e) => {
    const el = e.target.closest('.fc-alg');
    if (!el) return;
    const alg = el.dataset.alg;
    const tip = el.querySelector('.copy-tip');
    copyTextToClipboard(alg);
    if (tip) { tip.textContent = '✓ 已复制'; setTimeout(() => { tip.textContent = ''; }, 1200); }
  });
}
function escFormulaHandler(e) {
  if (formulaModal && !formulaModal.hidden && e.key === 'Escape') {
    formulaModal.hidden = true;
  }
}
function copyTextToClipboard(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).catch(() => legacyCopy(t));
  } else {
    legacyCopy(t);
  }
}
function legacyCopy(t) {
  const ta = document.createElement('textarea');
  ta.value = t;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}

/* ---------- 公式情况图（静态渲染，不影响正在复原的魔方） ---------- */
function parseWCA(alg) {
  const out = [];
  let s = alg.replace(/\s+/g, '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '(') {
      let depth = 1, j = i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')') depth--;
        if (depth === 0) break;
        j++;
      }
      const inner = parseWCA(s.slice(i + 1, j));
      let rep = 1;
      if (s[j + 1] === '2') { rep = 2; j++; }
      for (let r = 0; r < rep; r++) for (const m of inner) out.push(m);
      i = j + 1;
    } else if (/[RLUDFBMrlufb]/.test(c)) {
      let j = i + 1;
      let prime = false, dbl = false;
      if (s[j] === "'") { prime = true; j++; }
      if (s[j] === '2') { dbl = true; j++; }
      out.push({face: c, prime, dbl});
      i = j;
    } else { i++; }
  }
  return out;
}
function wcaToMoves(list) {
  const max = 2, mid = 1;
  const moves = [];
  const add = (axis, layerIdx, ang, dir, mult) => {
    const a = (ang * dir * mult) % 360;
    if (a !== 0) moves.push({axis, layerIdx, angleDeg: a});
  };
  for (const m of list) {
    const dir = m.prime ? -1 : 1;
    const mult = m.dbl ? 2 : 1;
    switch (m.face) {
      case 'R': add('x', max, -90, dir, mult); break;
      case 'L': add('x', 0, 90, dir, mult); break;
      case 'U': add('y', max, -90, dir, mult); break;
      case 'D': add('y', 0, 90, dir, mult); break;
      case 'F': add('z', max, -90, dir, mult); break;
      case 'B': add('z', 0, 90, dir, mult); break;
      case 'M': add('x', mid, 90, dir, mult); break;
      case 'r': add('x', max, -90, dir, mult); add('x', mid, -90, dir, mult); break;
      case 'f': add('z', max, -90, dir, mult); add('z', mid, -90, dir, mult); break;
      default: return null;
    }
  }
  return moves;
}
function freshCube3() {
  const max = 2;
  const list = [];
  for (let x = -max; x <= max; x += 2)
    for (let y = -max; y <= max; y += 2)
      for (let z = -max; z <= max; z += 2) {
        const colors = {};
        for (const d of Object.keys(DIRV)) {
          const axis = d[1], sgn = d[0] === '+' ? 1 : -1;
          colors[d] = faceKey(axis, sgn, {x, y, z}[axis], max);
        }
        list.push({x, y, z, q: new THREE.Quaternion(), colors});
      }
  return list;
}
function applyTo(list, moves) {
  for (const m of moves) {
    const val = 2 * m.layerIdx - 2;
    const q = new THREE.Quaternion().setFromAxisAngle(axisVec(m.axis), m.angleDeg * Math.PI / 180);
    const ai = AXIS_IDX[m.axis];
    for (const c of list) {
      const coord = [c.x, c.y, c.z][ai];
      if (Math.abs(coord - val) > 1e-9) continue;
      const v = new THREE.Vector3(c.x, c.y, c.z).applyQuaternion(q);
      c.x = Math.round(v.x); c.y = Math.round(v.y); c.z = Math.round(v.z);
      c.q.premultiply(q);
    }
  }
}
function colorOf(list, face, r, c) {
  const max = 2;
  let x, y, z, dir;
  switch (face) {
    case 'U': x = -max + 2*c; y = max; z = -max + 2*r; dir = '+y'; break;
    case 'D': x = -max + 2*c; y = -max; z = max - 2*r; dir = '-y'; break;
    case 'F': x = -max + 2*c; y = max - 2*r; z = max; dir = '+z'; break;
    case 'B': x = max - 2*c; y = max - 2*r; z = -max; dir = '-z'; break;
    case 'L': x = -max; y = max - 2*r; z = -max + 2*c; dir = '-x'; break;
    case 'R': x = max; y = max - 2*r; z = max - 2*c; dir = '+x'; break;
  }
  let c0 = null;
  for (const cc of list) if (Math.abs(cc.x - x) < 1e-9 && Math.abs(cc.y - y) < 1e-9 && Math.abs(cc.z - z) < 1e-9) { c0 = cc; break; }
  if (!c0) return 'K';
  const wd = new THREE.Vector3(...DIRV[dir]);
  for (const ld of Object.keys(DIRV)) {
    if (new THREE.Vector3(...DIRV[ld]).applyQuaternion(c0.q).distanceTo(wd) < 1e-6) return c0.colors[ld];
  }
  return 'K';
}
function faceSVG(list, face, label) {
  const cell = 17, gap = 1, size = cell * 3 + gap * 2;
  let rects = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const col = FACE_COLOR[colorOf(list, face, r, c)] || FACE_COLOR.K;
    rects += `<rect x="${c*(cell+gap)}" y="${r*(cell+gap)}" width="${cell}" height="${cell}" rx="2.5" fill="${col}" stroke="rgba(0,0,0,.28)" stroke-width="1"/>`;
  }
  return `<div class="fc-vis-item"><label>${label}</label><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rects}</svg></div>`;
}
function faceSVG_top(list, label) {
  const cell = 17, gap = 1, size = cell * 3 + gap * 2;
  let rects = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const k = colorOf(list, 'U', r, c);
    const fill = (k === 'U') ? '#ffd500' : '#ececf0';
    rects += `<rect x="${c*(cell+gap)}" y="${r*(cell+gap)}" width="${cell}" height="${cell}" rx="2.5" fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width="1"/>`;
  }
  return `<div class="fc-vis-item"><label>${label}</label><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rects}</svg></div>`;
}
function posSolved(list, pos) {
  switch (pos) {
    case 'UFR': return colorOf(list,'F',0,2)==='F' && colorOf(list,'R',0,0)==='R';
    case 'URB': return colorOf(list,'R',0,2)==='R' && colorOf(list,'B',0,0)==='B';
    case 'UBL': return colorOf(list,'B',0,2)==='B' && colorOf(list,'L',0,0)==='L';
    case 'ULF': return colorOf(list,'L',0,2)==='L' && colorOf(list,'F',0,0)==='F';
    case 'UF': return colorOf(list,'F',0,1)==='F';
    case 'UR': return colorOf(list,'R',0,1)==='R';
    case 'UB': return colorOf(list,'B',0,1)==='B';
    case 'UL': return colorOf(list,'L',0,1)==='L';
  }
  return false;
}
function faceSVG_pll(list, label) {
  const cell = 13, gap = 1, u = cell + gap, o = u;
  const size = u * 5 - gap;
  let s = '';
  const rc = (cell, x, y, fill, st) => `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${fill}" stroke="${st}" stroke-width="1"/>`;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const k = colorOf(list, 'U', r, c);
    s += rc(cell, o + c*u, o + r*u, (k === 'U') ? '#ffd500' : '#ececf0', 'rgba(0,0,0,.35)');
  }
  for (let c = 0; c < 3; c++) {
    const pos = c === 0 ? 'URB' : (c === 1 ? 'UB' : 'UBL');
    const k = colorOf(list, 'B', 0, c);
    s += rc(cell, o + c*u, 0, posSolved(list, pos) ? '#ffd500' : (FACE_COLOR[k] || '#d5d5d9'), 'rgba(0,0,0,.35)');
  }
  for (let c = 0; c < 3; c++) {
    const pos = c === 0 ? 'UFL' : (c === 1 ? 'UF' : 'UFR');
    const k = colorOf(list, 'F', 0, c);
    s += rc(cell, o + c*u, 4*u, posSolved(list, pos) ? '#ffd500' : (FACE_COLOR[k] || '#d5d5d9'), 'rgba(0,0,0,.35)');
  }
  for (let r = 0; r < 3; r++) {
    const pos = r === 0 ? 'UBL' : (r === 1 ? 'UL' : 'ULF');
    const k = colorOf(list, 'L', 0, r);
    s += rc(cell, 0, o + r*u, posSolved(list, pos) ? '#ffd500' : (FACE_COLOR[k] || '#d5d5d9'), 'rgba(0,0,0,.35)');
  }
  for (let r = 0; r < 3; r++) {
    const pos = r === 0 ? 'URB' : (r === 1 ? 'UR' : 'UFR');
    const k = colorOf(list, 'R', 0, 2 - r);
    s += rc(cell, 4*u, o + r*u, posSolved(list, pos) ? '#ffd500' : (FACE_COLOR[k] || '#d5d5d9'), 'rgba(0,0,0,.35)');
  }
  return `<div class="fc-vis-item"><label>${label}</label><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${s}</svg></div>`;
}
function renderFormulaCases() {
  $all('.fc-alg[data-alg]').forEach(el => {
    const fwd = wcaToMoves(parseWCA(el.dataset.alg));
    if (!fwd || fwd.length === 0) return;
    const tmp = freshCube3();
    const inv = fwd.slice().reverse().map(m => ({axis: m.axis, layerIdx: m.layerIdx, angleDeg: -m.angleDeg}));
    applyTo(tmp, inv);
    const card = el.closest('.fc');
    const pane = el.closest('.tab-pane');
    const paneId = pane ? pane.id : '';
    const name = card.querySelector('.fc-name').textContent;
    let html = '';
    if (paneId === 'pane-oll') {
      html = faceSVG_top(tmp, '顶面 · 黄色块');
    } else if (paneId === 'pane-pll') {
      html = faceSVG_pll(tmp, '顶面+侧环 · 黄=已归位');
    } else if (paneId === 'pane-f2l') {
      html = faceSVG(tmp, 'U', '顶面 U') + faceSVG(tmp, 'F', '前面 F');
    } else {
      if (/十字|小鱼/.test(name)) html = faceSVG_top(tmp, '顶面 · 黄色块');
      else if (/交换|三棱|对棱|邻棱/.test(name)) html = faceSVG_pll(tmp, '顶面+侧环 · 黄=已归位');
      else html = faceSVG(tmp, 'U', '顶面 U') + faceSVG(tmp, 'F', '前面 F');
    }
    const vis = document.createElement('div');
    vis.className = 'fc-vis';
    vis.innerHTML = html;
    card.appendChild(vis);
  });
}

/* ---------- 生命周期 ---------- */
export function initRubiksCube(root) {
  if (initialized) return;
  rootEl = root;
  stageEl = $('#cubeStage');
  canvasEl = document.createElement('canvas');
  canvasEl.id = 'cubeCanvas';
  stageEl.appendChild(canvasEl);
  netSvg = $('#net');
  graphSvg = $('#graphBg');

  bindFormulaModal();
  bindNetSvg();
  bind3DCanvas();
  bindControls();
  document.addEventListener('keydown', keydownHandler);
  document.addEventListener('keydown', escFormulaHandler);

  winResizeNet = () => drawNet();
  window.addEventListener('resize', winResizeNet);

  drawGraphBg();
  init3D();
  buildScene();
  renderFormulaCases();
  initialized = true;
}

export function disposeRubiksCube() {
  if (!initialized) return;
  if (rafId) cancelAnimationFrame(rafId);
  if (curPivot) {
    for (const c of curLayer) cubeGroup.attach(c.mesh);
    cubeGroup.remove(curPivot);
    curPivot = null; curLayer = null; curMove = null;
    syncMeshes();
  }
  moveQueue.length = 0;
  busy = false;
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
  if (winResize3d) { window.removeEventListener('resize', winResize3d); winResize3d = null; }
  if (winResizeNet) { window.removeEventListener('resize', winResizeNet); winResizeNet = null; }
  document.removeEventListener('keydown', keydownHandler);
  document.removeEventListener('keydown', escFormulaHandler);
  if (renderer) { renderer.dispose(); renderer = null; }
  if (canvasEl && canvasEl.parentNode) canvasEl.parentNode.removeChild(canvasEl);
  canvasEl = null;
  rootEl = null;
  initialized = false;
}
