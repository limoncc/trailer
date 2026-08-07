/**
 * pca3d-viewer.ts — PCA 三维散点图组件（纯 Three.js）
 *
 * 从 docs/pca-viewer/pca3d-viewer.js 移植为 TypeScript 类，并为嵌入 Svelte 组件新增：
 *   - setColors(bg, grid, axis)：深色/浅色主题切换
 *   - setPaused(bool)：视口外暂停 rAF（多卡片性能）
 *   - setData(data, { keepView })：step 滑动时保留相机视角
 *   - ResizeObserver 观察容器（列数切换/卡片折叠时自适应）
 *   - webglcontextlost 防护
 *
 * 交互：左键拖拽旋转 / 右键拖拽平移 / 滚轮缩放 / 双击复位 / 悬停查看点坐标（crosshair）
 *
 * 数据 JSON 格式：
 * {
 *   "meta": { "title", "n_samples", "explained_variance": [v1,v2,v3],
 *             "axis_labels": ["PC1",...], "clusters": [{"id","label","color","count"}...] },
 *   "points": [ {"x":0.1,"y":2.3,"z":-1.2,"cluster":"Cluster 0"}, ... ]
 * }
 */
import * as THREE from 'three';
import type { PcaData, PcaHoverInfo, PcaMeta } from './pcaTypes';

/** G2 / AntV 官方默认分类调色板（category10），与 Python 端 DEFAULT_PCA_COLORS 一致 */
export const DEFAULT_COLORS = [
  '#5B8FF9', '#5AD8A6', '#5D7092', '#F6BD16', '#E8684A',
  '#6DC8EC', '#9270CA', '#FF9D4D', '#269A99', '#FF99C3',
];

export interface PCA3DViewerOptions {
  data?: PcaData;
  opacity?: number;
  pointSize?: number;
  backgroundColor?: number;
  gridColor?: number;
  axisColor?: number;
  onData?: (meta: PcaMeta) => void;
  onHover?: (info: PcaHoverInfo | null) => void;
}

interface BBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export class PCA3DViewer {
  private container: HTMLElement;
  private opacity: number;
  private pointSize: number;
  private bgColor: number;
  private gridColor: number;
  private axisColor: number;
  private onData: ((meta: PcaMeta) => void) | null;
  private onHover: ((info: PcaHoverInfo | null) => void) | null;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private _points = new THREE.Group();
  private _grid = new THREE.Group();
  private _axes = new THREE.Group();
  private _hover = new THREE.Group();
  private _materials: THREE.MeshStandardMaterial[] = [];
  private _raf = 0;
  private _paused = false;
  private _target = new THREE.Vector3(0, 0, 0);
  private _worldUp = new THREE.Vector3(0, 1, 0);
  private _fitRadius = 18;
  private _raycaster = new THREE.Raycaster();
  private _pointer = new THREE.Vector2();
  private _hovered: THREE.Mesh | null = null;
  private _bbox: BBox | null = null;
  private _dragging = false;
  private _dragButton = 0;
  private _updateCamera: (() => void) | null = null;
  private _onResize: () => void;
  private _ro: ResizeObserver | null = null;
  private _meta: PcaMeta | null = null;
  private _axisLabels: string[] | null = null;

  constructor(container: HTMLElement, opts: PCA3DViewerOptions = {}) {
    this.container = container;
    this.opacity = opts.opacity ?? 0.85;
    this.pointSize = opts.pointSize ?? 0.09; // 默认小方块；传 0 则按数据范围自适应
    this.bgColor = opts.backgroundColor ?? 0xffffff;
    this.gridColor = opts.gridColor ?? 0xc9d4e3;
    this.axisColor = opts.axisColor ?? 0x334155;
    this.onData = opts.onData ?? null;
    this.onHover = opts.onHover ?? null;
    this._onResize = () => {
      const W = this.container.clientWidth || 800;
      const H = this.container.clientHeight || 600;
      this.camera.aspect = W / H;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(W, H);
    };

    this._initRenderer();
    this._initScene();
    this._initControls();
    this._animate();

    if (opts.data) this.setData(opts.data);
  }

  private _initRenderer(): void {
    const W = this.container.clientWidth || 800;
    const H = this.container.clientHeight || 600;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(W, H);
    this.renderer.setClearColor(this.bgColor, 1);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.container.appendChild(this.renderer.domElement);
  }

  private _initScene(): void {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(this.bgColor);
    this.scene = scene;

    const W = this.container.clientWidth || 800;
    const H = this.container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000);

    // 光照：明亮环境光 + 柔向主光 + 反向补光（哑光体积感，无廉价高光）
    scene.add(new THREE.AmbientLight(0xffffff, 0.80));
    const key = new THREE.DirectionalLight(0xffffff, 0.50);
    key.position.set(5, 8, 6); scene.add(key);
    const fill = new THREE.DirectionalLight(0xf1f5f9, 0.28);
    fill.position.set(-5, -3, -4); scene.add(fill);

    scene.add(this._grid);
    scene.add(this._axes);
    scene.add(this._points);
    scene.add(this._hover);
  }

  // ===== 自写轨道控制：拖拽旋转 + 滚轮缩放 + 双击复位 + 触摸 + 悬停拾取 =====
  private _initControls(): void {
    const el = this.renderer.domElement;
    let isDown = false, lastX = 0, lastY = 0;
    const target = this._target;

    this._updateCamera = () => this.camera.lookAt(target);

    // 拖拽旋转：对当前相机偏移向量做 azimuth(绕 worldUp) + polar(绕相机 right) 旋转，
    // 不依赖球坐标重写，避免俯视极点退化的问题
    const rotateBy = (dx: number, dy: number) => {
      const off = this.camera.position.clone().sub(target);
      const len = off.length();
      off.applyAxisAngle(this._worldUp, -dx * 0.006);
      const right = new THREE.Vector3().crossVectors(off, this._worldUp);
      if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
      right.normalize();
      off.applyAxisAngle(right, -dy * 0.006);
      // 限制 polar 角度，避免越过上下极点
      const ang = off.angleTo(this._worldUp);
      const clamped = Math.max(0.08, Math.min(Math.PI - 0.08, ang));
      const horiz = new THREE.Vector3(off.x, 0, off.z);
      if (horiz.lengthSq() < 1e-8) horiz.set(0, 0, 1);
      horiz.normalize();
      off.copy(horiz).multiplyScalar(Math.sin(clamped) * len);
      off.y = Math.cos(clamped) * len;
      this.camera.position.copy(target).add(off);
      this.camera.up.set(0, 1, 0);
      if (this._updateCamera) this._updateCamera();
    };

    el.style.cursor = 'grab';
    el.addEventListener('mousedown', (e) => {
      isDown = true; this._dragging = true; lastX = e.clientX; lastY = e.clientY;
      this._dragButton = e.button;
      el.style.cursor = e.button === 2 ? 'move' : 'grabbing';
      this._clearHover();
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    const endDrag = () => {
      isDown = false; this._dragging = false; this._dragButton = 0; el.style.cursor = 'grab';
    };
    el.addEventListener('mouseup', endDrag);
    el.addEventListener('mouseleave', () => { if (!isDown) this._clearHover(); });

    el.addEventListener('mousemove', (e) => {
      if (isDown) {
        if (this._dragButton === 2) {
          this.panBy(e.clientX - lastX, e.clientY - lastY);
        } else {
          rotateBy(e.clientX - lastX, e.clientY - lastY);
        }
        lastX = e.clientX; lastY = e.clientY;
        return;
      }
      this._pickHover(e);
    });

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const off = this.camera.position.clone().sub(target);
      off.multiplyScalar(e.deltaY > 0 ? 1.08 : 0.92);
      // 最小距离基于 fitRadius 自适应（小比例），保证小数据集也能放大到很近（原固定 4 会限制放大）
      const minLen = Math.max(0.2, this._fitRadius * 0.02);
      const len = Math.max(minLen, Math.min(400, off.length()));
      off.setLength(len);
      this.camera.position.copy(target).add(off);
      if (this._updateCamera) this._updateCamera();
    }, { passive: false });
    el.addEventListener('dblclick', () => this.resetView());

    // 触摸：单指旋转
    let tLast: { x: number; y: number } | null = null;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDown = true; this._dragging = true;
        tLast = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        this._clearHover();
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!isDown || e.touches.length !== 1 || !tLast) return;
      const t = e.touches[0];
      rotateBy(t.clientX - tLast.x, t.clientY - tLast.y);
      tLast = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    el.addEventListener('touchend', () => { isDown = false; this._dragging = false; });

    // 自适应尺寸：window resize + 容器 ResizeObserver（列数切换/折叠）
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._onResize());
      this._ro.observe(this.container);
    }
  }

  /** 右键拖动平移：相机沿自身"右/上"方向移动，_target 同步移动（抓取式） */
  panBy(dx: number, dy: number): void {
    const target = this._target;
    const off = this.camera.position.clone().sub(target);
    const dist = off.length();
    const scale = dist * 0.0016;
    this.camera.updateMatrixWorld();
    const m = this.camera.matrixWorld.elements;
    const right = new THREE.Vector3(m[0], m[1], m[2]).normalize();
    const camUp = new THREE.Vector3(m[4], m[5], m[6]).normalize();
    const pan = right.multiplyScalar(-dx * scale).add(camUp.multiplyScalar(dy * scale));
    target.add(pan);
    this.camera.position.add(pan);
    if (this._updateCamera) this._updateCamera();
  }

  // ===== 悬停拾取：射线检测 + crosshair 准星 + 回调 tooltip =====
  private _pickHover(e: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) { this._clearHover(); return; }
    this._pointer.x = (mx / rect.width) * 2 - 1;
    this._pointer.y = -(my / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this._raycaster.intersectObjects(this._points.children, false);
    if (hits.length) {
      const m = hits[0].object as THREE.Mesh;
      const ud = m.userData as { cluster: string; x: number; y: number; z: number };
      this._setHover(m, ud);
      if (this.onHover) this.onHover({ cluster: ud.cluster, x: ud.x, y: ud.y, z: ud.z, mx, my });
    } else {
      this._clearHover();
      if (this.onHover) this.onHover(null);
    }
  }

  private _setHover(mesh: THREE.Mesh, ud: { cluster: string; x: number; y: number; z: number }): void {
    if (this._hovered === mesh) return;
    this._clearHover();
    this._hovered = mesh;
    const b = this._bbox; if (!b) return;
    const pad = 0.6;
    const x0 = b.minX - pad, x1 = b.maxX + pad, y0 = b.minY - pad, y1 = b.maxY + pad, z0 = b.minZ - pad, z1 = b.maxZ + pad;
    const col = (mesh.material as THREE.MeshStandardMaterial).color.getHex();
    const mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.75 });
    const p = new THREE.Vector3(ud.x, ud.y, ud.z);
    // 三条贯穿准星线（沿 x / y / z 三个方向），延伸到包围盒边界
    const pts = [
      new THREE.Vector3(x0, p.y, p.z), new THREE.Vector3(x1, p.y, p.z),
      new THREE.Vector3(p.x, y0, p.z), new THREE.Vector3(p.x, y1, p.z),
      new THREE.Vector3(p.x, p.y, z0), new THREE.Vector3(p.x, p.y, z1),
    ];
    const cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat);
    this._hover.add(cross);
    // 命中点高亮线框
    const cs = this.pointSize * 1.9;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(cs, cs, cs)),
      new THREE.LineBasicMaterial({ color: col }),
    );
    edges.position.copy(p);
    this._hover.add(edges);
  }

  private _clearHover(): void {
    this._hovered = null;
    this._clearGroup(this._hover);
    if (this.onHover) this.onHover(null);
  }

  private _animate(): void {
    if (this._raf || this._paused) return;
    this._raf = requestAnimationFrame(this._loop);
  }

  private _loop = (): void => {
    if (this._paused) return;
    this._raf = requestAnimationFrame(this._loop);
    this.renderer.render(this.scene, this.camera);
  };

  /** 暂停/恢复 rAF 渲染（卡片不可见/折叠时调用，节省 GPU） */
  setPaused(paused: boolean): void {
    this._paused = paused;
    if (paused) {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    } else if (!this._raf) {
      this._animate();
    }
  }

  // ===== 坐标轴与参考框（清爽版：包围盒 + 三面体网格）=====
  private _buildGrid(b: BBox): void {
    this._clearGroup(this._grid);
    const gridMat = new THREE.LineBasicMaterial({
      color: this.gridColor, transparent: true, opacity: 0.32,
    });

    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) * 0.06 + 0.5;
    const x0 = b.minX - pad, x1 = b.maxX + pad;
    const y0 = b.minY - pad, y1 = b.maxY + pad;
    const z0 = b.minZ - pad, z1 = b.maxZ + pad;

    // 1) 包围盒 12 条边（作为坐标参考框）
    const boxPts = [
      new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y0, z0),
      new THREE.Vector3(x1, y0, z0), new THREE.Vector3(x1, y0, z1),
      new THREE.Vector3(x1, y0, z1), new THREE.Vector3(x0, y0, z1),
      new THREE.Vector3(x0, y0, z1), new THREE.Vector3(x0, y0, z0),
      new THREE.Vector3(x0, y1, z0), new THREE.Vector3(x1, y1, z0),
      new THREE.Vector3(x1, y1, z0), new THREE.Vector3(x1, y1, z1),
      new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x0, y1, z1),
      new THREE.Vector3(x0, y1, z1), new THREE.Vector3(x0, y1, z0),
      new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x0, y1, z0),
      new THREE.Vector3(x1, y0, z0), new THREE.Vector3(x1, y1, z0),
      new THREE.Vector3(x1, y0, z1), new THREE.Vector3(x1, y1, z1),
      new THREE.Vector3(x0, y0, z1), new THREE.Vector3(x0, y1, z1),
    ];
    this._grid.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(boxPts), gridMat));

    // 2) 三面体网格：底面(y=y0)、背面(z=z0)、左面(x=x0)，各 10 等分
    const divisions = 10, gridPts: THREE.Vector3[] = [];
    for (let i = 1; i < divisions; i++) {
      const t = i / divisions;
      const x = x0 + t * (x1 - x0);
      const y = y0 + t * (y1 - y0);
      const z = z0 + t * (z1 - z0);
      gridPts.push(new THREE.Vector3(x, y0, z0), new THREE.Vector3(x, y0, z1));
      gridPts.push(new THREE.Vector3(x0, y0, z), new THREE.Vector3(x1, y0, z));
      gridPts.push(new THREE.Vector3(x, y0, z0), new THREE.Vector3(x, y1, z0));
      gridPts.push(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0));
      gridPts.push(new THREE.Vector3(x0, y0, z), new THREE.Vector3(x0, y1, z));
      gridPts.push(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x0, y, z1));
    }
    this._grid.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPts), gridMat));
  }

  private _buildAxes(b: BBox): void {
    this._clearGroup(this._axes);
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) * 0.06 + 0.5;
    const x0 = b.minX - pad, x1 = b.maxX + pad;
    const y0 = b.minY - pad, y1 = b.maxY + pad;
    const z0 = b.minZ - pad, z1 = b.maxZ + pad;

    const axisMat = new THREE.LineBasicMaterial({ color: this.axisColor, transparent: true, opacity: 0.95 });
    const line = (a: number[], c: number[]) => {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3().fromArray(a), new THREE.Vector3().fromArray(c),
      ]);
      return new THREE.Line(g, axisMat);
    };
    this._axes.add(line([x0, y0, z0], [x1, y0, z0]));
    this._axes.add(line([x0, y0, z0], [x0, y1, z0]));
    this._axes.add(line([x0, y0, z0], [x0, y0, z1]));

    const metaLabels = (this._axisLabels && this._axisLabels.length === 3) ? this._axisLabels : null;
    const ev = (this._meta && Array.isArray(this._meta.explained_variance)) ? this._meta.explained_variance : [];
    const maxDim = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) || 1;
    const labelH = Math.max(0.2, Math.min(maxDim * 0.035, 1.8));

    const pct = (i: number) => (ev[i] ? ` (${(ev[i] * 100).toFixed(1)}%)` : '');
    const labelText = (i: number) => {
      const base = metaLabels ? metaLabels[i] : `PC${i + 1}`;
      return /%/.test(base) ? base : base + pct(i);
    };

    const label = (text: string, pos: number[], align: string, hWorld: number) => {
      const fontPx = 24;
      const fontStr = `${fontPx}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const m = document.createElement('canvas').getContext('2d')!;
      m.font = fontStr;
      const padX = 8, padY = 6;
      const textW = m.measureText(text).width;
      const W = Math.ceil(textW + padX * 2);
      const H = Math.ceil(fontPx + padY * 2);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d')!;
      const color = '#' + this.axisColor.toString(16).padStart(6, '0');
      ctx.fillStyle = color;
      ctx.font = fontStr;
      ctx.textAlign = (align as CanvasTextAlign) || 'center';
      ctx.textBaseline = 'middle';
      // 不加白色描边（dark 模式突兀），靠 axisColor 区分背景
      const xText = align === 'left' ? padX : (align === 'right' ? W - padX : W / 2);
      ctx.fillText(text, xText, H / 2);
      const tex = new THREE.CanvasTexture(c);
      tex.minFilter = THREE.LinearFilter;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      sp.position.fromArray(pos);
      sp.scale.set(hWorld * W / H, hWorld, 1);
      sp.renderOrder = 999;
      return sp;
    };

    this._axes.add(label(labelText(0), [x1 + pad * 0.35, y0, z0], 'left', labelH));
    this._axes.add(label(labelText(1), [x0, y1 + pad * 0.35, z0], 'center', labelH));
    this._axes.add(label(labelText(2), [x0, y0, z1 + pad * 0.35], 'center', labelH));
  }

  private _clearGroup(group: THREE.Group): void {
    while (group.children.length) {
      const o = group.children.pop();
      if (!o) continue;
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) { mat.forEach((x) => x.dispose()); }
      else if (mat) { if ((mat as THREE.SpriteMaterial).map) (mat as THREE.SpriteMaterial).map?.dispose(); mat.dispose(); }
    }
  }

  // ===== 加载 / 切换数据 =====
  setData(data: PcaData, opts?: { keepView?: boolean }): void {
    if (!data || !Array.isArray(data.points)) {
      throw new Error('数据格式无效：需要 { meta, points: [...] }');
    }
    this._clearGroup(this._points);
    this._materials = [];

    const meta = data.meta || {};
    this._meta = meta;
    this._axisLabels = meta.axis_labels || null;

    // 簇颜色映射：优先用 meta.clusters 的颜色，否则默认调色板
    const colorMap: Record<string, string> = {};
    const clusters = meta.clusters || [];
    clusters.forEach((c, i) => {
      colorMap[c.label] = c.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    let fallbackIdx = 0;
    const colorFor = (label: string) => {
      if (colorMap[label]) return colorMap[label];
      const col = DEFAULT_COLORS[fallbackIdx % DEFAULT_COLORS.length];
      fallbackIdx++; colorMap[label] = col; return col;
    };

    const matByLabel: Record<string, THREE.MeshStandardMaterial> = {};
    const b: BBox = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };

    // 第一遍：计算数据包围盒，用于自适应方块大小
    data.points.forEach((p) => {
      if (p.x < b.minX) b.minX = p.x; if (p.x > b.maxX) b.maxX = p.x;
      if (p.y < b.minY) b.minY = p.y; if (p.y > b.maxY) b.maxY = p.y;
      if (p.z < b.minZ) b.minZ = p.z; if (p.z > b.maxZ) b.maxZ = p.z;
    });

    if (!isFinite(b.minX)) Object.assign(b, { minX: -6, minY: -5, minZ: -5, maxX: 6, maxY: 5, maxZ: 6 });
    this._bbox = b;

    // 方块大小：默认固定小方块；显式传 0 时按数据范围自适应（间距 30%，防止过密重叠）
    const maxDim = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) || 1;
    const n = Math.max(data.points.length, 1);
    const ps = this.pointSize > 0
      ? this.pointSize
      : Math.max(0.02, Math.min(maxDim * 0.08, (maxDim / Math.sqrt(n)) * 0.3));
    const geo = new THREE.BoxGeometry(ps, ps, ps);

    // 第二遍：创建 mesh（共享 geo，每簇共享材质便于调透明度）
    data.points.forEach((p) => {
      const col = colorFor(p.cluster);
      let mat = matByLabel[col];
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(col), roughness: 0.55, metalness: 0.0,
          transparent: true, opacity: this.opacity,
        });
        matByLabel[col] = mat; this._materials.push(mat);
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.x, p.y, p.z);
      mesh.userData = { cluster: p.cluster, x: p.x, y: p.y, z: p.z };
      this._points.add(mesh);
    });

    this._buildGrid(b);
    this._buildAxes(b);

    // 相机距离贴近数据（FOV 45° 下约 1.25× 对角线），让数据整体铺满视野而非缩在中央
    const radius = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) * 1.25 + 1;
    this._fitRadius = radius;

    // step 滑块切换时保留相机视角（keepView），否则复位到 fit 视角
    if (!opts?.keepView) this.resetView();

    if (this.onData) this.onData(meta);
  }

  // 预设视角：'reset' | 'front' | 'side' | 'top'
  setView(name: 'reset' | 'front' | 'side' | 'top'): void {
    const r = this._fitRadius || 18;
    this._target.set(0, 0, 0);
    const t = this._target;
    if (name === 'front') {
      this.camera.position.set(0, 0, r); this.camera.up.set(0, 1, 0);
    } else if (name === 'side') {
      this.camera.position.set(r, 0, 0); this.camera.up.set(0, 1, 0);
    } else if (name === 'top') {
      this.camera.position.set(0, r, 0); this.camera.up.set(0, 0, -1);
    } else {
      this.camera.position.set(r * 0.7, r * 0.6, r * 0.7); this.camera.up.set(0, 1, 0);
    }
    this.camera.lookAt(t);
  }

  resetView(): void {
    this.setView('reset');
  }

  setOpacity(v: number): void {
    this.opacity = v;
    for (let i = 0; i < this._materials.length; i++) this._materials[i].opacity = v;
  }

  setPointSize(s: number): void {
    this.pointSize = s;
    const geo = new THREE.BoxGeometry(s, s, s);
    this._points.children.forEach((m) => { (m as THREE.Mesh).geometry = geo; });
  }

  /** 深色/浅色切换：更新 clearColor、scene.background，并用缓存的 _bbox 重建网格与坐标轴 */
  setColors(bg: number, grid: number, axis: number): void {
    this.bgColor = bg; this.gridColor = grid; this.axisColor = axis;
    this.renderer.setClearColor(bg, 1);
    if (this.scene.background) (this.scene.background as THREE.Color).set(bg);
    if (this._bbox) { this._buildGrid(this._bbox); this._buildAxes(this._bbox); }
  }

  destroy(): void {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
    this._clearGroup(this._points);
    this._clearGroup(this._grid);
    this._clearGroup(this._axes);
    this._clearGroup(this._hover);
    if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}
