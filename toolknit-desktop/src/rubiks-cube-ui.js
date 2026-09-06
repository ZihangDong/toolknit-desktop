/* ============================================================
 * rubiks-cube-ui.js —— 图论与魔方 · UI 层
 * 负责首页「创意」分类入口卡片与 overlay 生命周期，
 * 打开时初始化核心、关闭时释放资源（符合 ToolKnit 工具模式）
 * ============================================================ */
import { initRubiksCube, disposeRubiksCube } from './rubiks-cube-core.js';

const TOOL = 'rubiks-cube';
const OVERLAY_ID = 'rubiksCubeOverlay';

function initToolUI() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  const cards = document.querySelectorAll(`.audio-list-item[data-tool="${TOOL}"]`);
  const closeBtn = document.getElementById('rubiksCubeBack');

  function open() {
    if (overlay.classList.contains('visible')) return;
    overlay.classList.add('visible');
    initRubiksCube(overlay);
  }
  function close() {
    if (!overlay.classList.contains('visible')) return;
    disposeRubiksCube();
    overlay.classList.remove('visible');
  }

  cards.forEach(card => {
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
  if (closeBtn) closeBtn.addEventListener('click', close);

  // Escape：先关公式面板（core 负责），未开公式面板时关闭整个工具
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !overlay.classList.contains('visible')) return;
    const modal = overlay.querySelector('.modal-mask');
    if (modal && !modal.hidden) return;
    close();
  });

  // 数据挂载：供主应用调试/扩展
  window.rubiksCubeTool = { open, close };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initToolUI);
} else {
  initToolUI();
}
