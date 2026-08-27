/**
 * landscape-viewer.ts — 损失景观三维曲面查看器（纯 Three.js）。
 *
 * 复用 pca3d-viewer.ts 的底座（renderer/轨道控制/网格包围盒/主题切换/rAF 暂停/销毁卫生），
 * 数据层换为 landscape/surface.ts 生成的带顶点色高度网格：
 *   x = α（方向 1），z = β（方向 2），y = 归一化 loss 高度，颜色 = viridis(loss)。
 *
 * 交互：左键旋转 / 右键平移 / 滚轮缩放 / 双击复位 / 悬停读取 (α, β, loss)。
 */
import * as THREE from 'three';
import { buildSurfaceGeometry, SURFACE_THEME, type SurfaceGeometry, type BallPoint } from './surface';
import type { ParsedLandscape } from './landscape';

export { SURFACE_THEME };

export interface SurfaceHoverInfo {
  a: number;
  b: number;
  loss: number;
  mx: number;
  my: number;
}

export interface LandscapeViewerOptions {
  backgroundColor?: number;
  gridColor?: number;
  axisColor?: number;
  wireframe?: boolean;
  /** 配色方案名（landscape.ts COLORMAP_NAMES，默认 plasma） */
  cmap?: string;
  onHover?: (info: SurfaceHoverInfo | null) => void;
}

interface BBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export class LandscapeViewer {
  private container: HTMLElement;
  private bgColor: number;
  private gridColor: number;
  private axisColor: number;
  private onHover: ((info: SurfaceHoverInfo | null) => void) | null;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private _surface = new THREE.Group();
  private _grid = new THREE.Group();
  private _axes = new THREE.Group();
  private _hover = new THREE.Group();
  private _fx = new THREE.Group();
  private _mesh: THREE.Mesh | null = null;
  private _wire: THREE.LineSegments | null = null;
  private _wireframe = false;
  private _cmap = 'plasma';
  private _geo: SurfaceGeometry | null = null;
  private _data: ParsedLandscape | null = null;
  private _hSpan = 6;
  private _ball: THREE.Mesh | null = null;
  private _ballAnim: {
    pts: BallPoint[];
    t0: number;
    dur: number;
    attr: THREE.BufferAttribute;
    zmin: number;
    range: number;
  } | null = null;
  private _raf = 0;
  private _paused = false;
  private _target = new THREE.Vector3(0, 0, 0);
  private _worldUp = new THREE.Vector3(0, 1, 0);
  private _fitRadius = 18;
  private _raycaster = new THREE.Raycaster();
  private _pointer = new THREE.Vector2();
  private _bbox: BBox | null = null;
  private _updateCamera: (() => void) | null = null;
  private _onResize: () => void;
  private _ro: ResizeObserver | null = null;

  constructor(container: HTMLElement, opts: LandscapeViewerOptions = {}) {
    this.container = container;
    this.bgColor = opts.backgroundColor ?? SURFACE_THEME.light.bg;
    this.gridColor = opts.gridColor ?? SURFACE_THEME.light.grid;
    this.axisColor = opts.axisColor ?? SURFACE_THEME.light.axis;
    this.wireframe = opts.wireframe ?? false;
    this._cmap = opts.cmap ?? 'plasma';
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.80));
    const key = new THREE.DirectionalLight(0xffffff, 0.50);
    key.position.set(5, 8, 6); scene.add(key);
    const fill = new THREE.DirectionalLight(0xf1f5f9, 0.28);
    fill.position.set(-5, -3, -4); scene.add(fill);

    scene.add(this._grid);
    scene.add(this._axes);
    scene.add(this._surface);
    scene.add(this._hover);
    scene.add(this._fx);
  }

  // ===== 轨道控制（与 pca3d-viewer 同款：azimuth/polar 旋转 + 右键平移 + 滚轮缩放）=====
  private _initControls(): void {
    const el = this.renderer.domElement;
    let isDown = false, lastX = 0, lastY = 0;
    const target = this._target;

    this._updateCamera = () => this.camera.lookAt(target);

    const rotateBy = (dx: number, dy: number) => {
      const off = this.camera.position.clone().sub(target);
      const len = off.length();
      off.applyAxisAngle(this._worldUp, -dx * 0.006);
      const right = new THREE.Vector3().crossVectors(off, this._worldUp);
      if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
      right.normalize();
      off.applyAxisAngle(right, -dy * 0.006);
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
      isDown = true; lastX = e.clientX; lastY = e.clientY;
      el.style.cursor = e.button === 2 ? 'move' : 'grabbing';
      this._clearHover();
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    const endDrag = () => { isDown = false; el.style.cursor = 'grab'; };
    el.addEventListener('mouseup', endDrag);
    el.addEventListener('mouseleave', () => { if (!isDown) this._clearHover(); });

    el.addEventListener('mousemove', (e) => {
      if (isDown) {
        if (e.button === 2 || e.buttons === 2) {
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
      const minLen = Math.max(0.2, this._fitRadius * 0.02);
      const len = Math.max(minLen, Math.min(400, off.length()));
      off.setLength(len);
      this.camera.position.copy(target).add(off);
      if (this._updateCamera) this._updateCamera();
    }, { passive: false });
    el.addEventListener('dblclick', () => this.resetView());

    let tLast: { x: number; y: number } | null = null;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDown = true;
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
    el.addEventListener('touchend', () => { isDown = false; });

    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._onResize());
      this._ro.observe(this.container);
    }
  }

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

  // ===== 悬停拾取：命中曲面 → 最近网格点读数 =====
  private _pickHover(e: MouseEvent): void {
    if (!this._mesh || !this._data) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) { this._clearHover(); return; }
    this._pointer.x = (mx / rect.width) * 2 - 1;
    this._pointer.y = -(my / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this._raycaster.intersectObject(this._mesh, false);
    if (!hits.length) { this._clearHover(); return; }

    const d = this._data;
    const p = hits[0].point;
    const stepX = d.nCols > 1 ? (d.xs[d.nCols - 1] - d.xs[0]) / (d.nCols - 1) : 1;
    const stepY = d.nRows > 1 ? (d.ys[d.nRows - 1] - d.ys[0]) / (d.nRows - 1) : 1;
    const c = Math.min(d.nCols - 1, Math.max(0, Math.round((p.x - d.xs[0]) / stepX)));
    const r = Math.min(d.nRows - 1, Math.max(0, Math.round((p.z - d.ys[0]) / stepY)));
    const loss = d.z[r * d.nCols + c];

    this._clearHover();
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(this._fitRadius * 0.012, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x111827 }),
    );
    marker.position.copy(p);
    this._hover.add(marker);
    if (this.onHover) this.onHover({ a: d.xs[c], b: d.ys[r], loss, mx, my });
  }

  private _clearHover(): void {
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
    this._tickBall();
    this.renderer.render(this.scene, this.camera);
  };

  // ===== 小球滚落动画 =====
  /** 沿 (α, β, loss) 路径播放小球滚落 + 尾迹（数据空间 → 世界坐标 y=hSpan·归一化loss） */
  playBall(pts: BallPoint[], durationMs = 4000): void {
    this.clearBall();
    if (pts.length === 0 || !this._data) return;
    const d = this._data;
    const range = d.zmax - d.zmin || 1;
    const toWorld = (p: BallPoint) =>
      new THREE.Vector3(p[0], ((p[2] - d.zmin) / range) * this._hSpan, p[1]);

    const r = Math.max(this._fitRadius * 0.018, 0.08);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(r, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0x92400e, roughness: 0.35 }),
    );
    ball.position.copy(toWorld(pts[0]));

    const positions = new Float32Array(pts.length * 3);
    const attr = new THREE.BufferAttribute(positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', attr);
    geo.setDrawRange(0, 0);
    const trail = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.9 }),
    );

    this._fx.add(trail);
    this._fx.add(ball);
    this._ball = ball;
    this._ballAnim = { pts, t0: performance.now(), dur: Math.max(200, durationMs), attr, zmin: d.zmin, range };
    this.setPaused(false);
  }

  clearBall(): void {
    this._ball = null;
    this._ballAnim = null;
    this._clearGroup(this._fx);
  }

  private _tickBall(): void {
    const anim = this._ballAnim;
    if (!anim || !this._ball) return;
    const p = Math.min(1, (performance.now() - anim.t0) / anim.dur);
    const fIdx = p * (anim.pts.length - 1);
    const i0 = Math.min(Math.floor(fIdx), anim.pts.length - 1);
    const frac = fIdx - i0;
    const cur = anim.pts[i0];
    const nxt = anim.pts[Math.min(i0 + 1, anim.pts.length - 1)];
    const a = cur[0] + (nxt[0] - cur[0]) * frac;
    const b = cur[1] + (nxt[1] - cur[1]) * frac;
    const l = cur[2] + (nxt[2] - cur[2]) * frac;
    this._ball.position.set(a, ((l - anim.zmin) / anim.range) * this._hSpan, b);

    const arr = anim.attr.array as Float32Array;
    for (let i = 0; i <= i0; i++) {
      const [pa, pb, pl] = anim.pts[i];
      arr[i * 3] = pa;
      arr[i * 3 + 1] = ((pl - anim.zmin) / anim.range) * this._hSpan;
      arr[i * 3 + 2] = pb;
    }
    arr[i0 * 3] = a;
    arr[i0 * 3 + 1] = ((l - anim.zmin) / anim.range) * this._hSpan;
    arr[i0 * 3 + 2] = b;
    anim.attr.needsUpdate = true;
    anim.attr.count = i0 + 2;
    if (p >= 1) this._ballAnim = null;
  }

  setPaused(paused: boolean): void {
    this._paused = paused;
    if (paused) {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    } else if (!this._raf) {
      this._animate();
    }
  }

  // ===== 包围盒 + 底面网格 + 坐标轴（复用 pca 款式，标签换 α/loss/β）=====
  private _buildGrid(b: BBox): void {
    this._clearGroup(this._grid);
    const gridMat = new THREE.LineBasicMaterial({ color: this.gridColor, transparent: true, opacity: 0.32 });

    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) * 0.06 + 0.5;
    const x0 = b.minX - pad, x1 = b.maxX + pad;
    const y0 = b.minY - pad, y1 = b.maxY + pad;
    const z0 = b.minZ - pad, z1 = b.maxZ + pad;

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
    this._axes.add(line([x0, y0, z0], [x1, y0, z0]));   // α
    this._axes.add(line([x0, y0, z0], [x0, y1, z0]));   // loss
    this._axes.add(line([x0, y0, z0], [x0, y0, z1]));   // β

    const maxDim = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) || 1;
    const labelH = Math.max(0.2, Math.min(maxDim * 0.035, 1.8));

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

    this._axes.add(label('α', [x1 + pad * 0.35, y0, z0], 'left', labelH));
    this._axes.add(label('loss', [x0, y1 + pad * 0.35, z0], 'center', labelH));
    this._axes.add(label('β', [x0, y0, z1 + pad * 0.35], 'center', labelH));
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

  // ===== 数据加载：重建曲面 mesh（keepView 时保留相机）=====
  setData(d: ParsedLandscape, opts?: { keepView?: boolean; cmap?: string }): void {
    if (opts?.cmap && opts.cmap !== this._cmap) this._cmap = opts.cmap;
    this._clearGroup(this._surface);
    this._mesh = null;
    this._wire = null;
    this._data = d;

    const geo = buildSurfaceGeometry(d, 6, this._cmap);
    this._geo = geo;
    this._hSpan = geo.hSpan;
    this.clearBall();

    const buf = new THREE.BufferGeometry();
    buf.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
    buf.setAttribute('color', new THREE.BufferAttribute(geo.colors, 3));
    buf.setIndex(new THREE.BufferAttribute(geo.indices, 1));
    buf.computeVertexNormals();

    const mesh = new THREE.Mesh(
      buf,
      new THREE.MeshStandardMaterial({
        vertexColors: true, side: THREE.DoubleSide,
        roughness: 0.6, metalness: 0.0,
      }),
    );
    this._mesh = mesh;
    this._surface.add(mesh);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(buf),
      new THREE.LineBasicMaterial({ color: this.axisColor, transparent: true, opacity: 0.22 }),
    );
    wire.visible = this._wireframe;
    this._wire = wire;
    this._surface.add(wire);

    const b: BBox = {
      minX: d.xs[0], maxX: d.xs[d.nCols - 1],
      minY: 0, maxY: geo.hSpan,
      minZ: d.ys[0], maxZ: d.ys[d.nRows - 1],
    };
    this._bbox = b;
    this._buildGrid(b);
    this._buildAxes(b);

    this._fitRadius = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) * 1.25 + 1;
    if (!opts?.keepView) this.resetView();
  }

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

  setWireframe(on: boolean): void {
    this._wireframe = on;
    if (this._wire) this._wire.visible = on;
  }

  setColors(bg: number, grid: number, axis: number): void {
    this.bgColor = bg; this.gridColor = grid; this.axisColor = axis;
    this.renderer.setClearColor(bg, 1);
    if (this.scene.background) (this.scene.background as THREE.Color).set(bg);
    if (this._bbox) { this._buildGrid(this._bbox); this._buildAxes(this._bbox); }
    if (this._wire) {
      const mat = this._wire.material as THREE.LineBasicMaterial;
      mat.color.setHex(axis);
    }
  }

  destroy(): void {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
    this._clearGroup(this._surface);
    this._clearGroup(this._grid);
    this._clearGroup(this._axes);
    this._clearGroup(this._hover);
    this._clearGroup(this._fx);
    if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}
