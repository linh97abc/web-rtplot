import { niceTicks, formatTick } from './ticks'
import type { Series, View } from './series'
import { FloatBuffer, type Renderer } from './render/Renderer'
import { WebGLRenderer } from './render/WebGLRenderer'
import { Canvas2DRenderer } from './render/Canvas2DRenderer'
import { TextLayer } from './render/TextLayer'

export type RendererKind = 'webgl' | 'canvas2d'

export interface PlotTheme {
  background: string
  plotBackground: string
  grid: string
  axis: string
  text: string
  font: string
}

export const lightTheme: PlotTheme = {
  background: '#ffffff',
  plotBackground: '#ffffff',
  grid: '#e6e6e6',
  axis: '#555555',
  text: '#333333',
  font: '11px system-ui, sans-serif',
}

export const darkTheme: PlotTheme = {
  background: '#1e1e22',
  plotBackground: '#16161a',
  grid: '#2c2c33',
  axis: '#888892',
  text: '#c8c8d0',
  font: '11px system-ui, sans-serif',
}

export interface PlotOptions {
  title?: string
  xLabel?: string
  yLabel?: string
  theme?: PlotTheme
  /** Chế độ streaming: trục X luôn bám theo mẫu mới nhất, độ rộng cửa sổ = followWindow */
  followWindow?: number
  /** Khoảng đệm khi auto-scale Y (tỉ lệ so với biên độ) */
  yPadding?: number
  /** Backend vẽ. Mặc định 'webgl', tự lùi về 'canvas2d' nếu trình duyệt không hỗ trợ WebGL */
  renderer?: RendererKind
}

/** Trạng thái trục — được truyền giữa các plot liên kết */
export interface AxisState {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  autoX: boolean
  autoY: boolean
  followWindow: number
}

type ViewListener = (state: AxisState, plot: Plot) => void

type DragMode = 'pan' | 'zoom' | 'box' | null
type Region = 'plot' | 'xaxis' | 'yaxis' | 'none'

const MARGIN = { left: 62, right: 24, top: 10, bottom: 34 }

/**
 * Plot không phụ thuộc framework. Hình vẽ bằng WebGL (hoặc Canvas 2D), chữ bằng phần tử HTML.
 *
 * Chuột:
 *  - Lăn: zoom X  ·  Shift+lăn: zoom Y  ·  Ctrl+lăn: zoom cả hai
 *  - Lăn trên trục X / Y: chỉ zoom trục đó
 *  - Kéo trái: pan  ·  Kéo phải: zoom liên tục  ·  Kéo giữa hoặc Alt+kéo trái: zoom vùng chọn
 *  - Double-click: auto-scale (và bật lại follow khi streaming)
 */
export class Plot {
  readonly container: HTMLElement
  readonly canvas: HTMLCanvasElement
  private renderer: Renderer
  private textLayer: TextLayer
  private boxEl: HTMLDivElement
  private segBuf = new FloatBuffer(512)
  readonly series: Series[] = []

  title: string
  xLabel: string
  yLabel: string
  theme: PlotTheme
  yPadding: number

  xMin = 0
  xMax = 1
  yMin = -1
  yMax = 1
  /** true → X tự khớp dữ liệu (tĩnh) hoặc bám mẫu mới nhất (streaming) */
  autoX = true
  /** true → Y tự khớp với dữ liệu đang nhìn thấy */
  autoY = true
  /** > 0 → chế độ streaming */
  followWindow: number

  /** Thống kê khung hình gần nhất */
  stats = { renderMs: 0, drawnPoints: 0, totalPoints: 0, fps: 0 }
  private fpsFrames = 0
  private fpsSince = 0
  /** Thời điểm của khung hình đang vẽ (mốc của requestAnimationFrame) */
  private frameTime = 0

  private dpr = 1
  private cssW = 0
  private cssH = 0
  private frameRequested = false
  /** Trạng thái cuộn mượt ở chế độ streaming */
  private follow = { x: NaN, rate: 0, lastNow: 0, target: NaN, targetNow: 0 }
  /** true → lần auto-scale Y kế tiếp khớp chính xác (bỏ qua độ trễ chống rung) */
  private forceYFit = true
  private destroyed = false
  private resizeObs: ResizeObserver
  private listeners = new Set<ViewListener>()
  private renderListeners = new Set<() => void>()

  // trạng thái chuột
  private drag: DragMode = null
  private dragRegion: Region = 'none'
  private dragStart = { x: 0, y: 0, xMin: 0, xMax: 0, yMin: 0, yMax: 0 }
  private dragCur = { x: 0, y: 0 }
  private mouse: { x: number; y: number } | null = null

  constructor(container: HTMLElement, opts: PlotOptions = {}) {
    this.container = container
    this.title = opts.title ?? ''
    this.xLabel = opts.xLabel ?? ''
    this.yLabel = opts.yLabel ?? ''
    this.theme = opts.theme ?? lightTheme
    this.followWindow = opts.followWindow ?? 0
    this.yPadding = opts.yPadding ?? 0.05

    this.canvas = document.createElement('canvas')
    // canvas đặt absolute để kích thước của nó không ảnh hưởng ngược tới container (tránh vòng lặp resize)
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair' })
    container.appendChild(this.canvas)
    this.renderer = this.createRenderer(opts.renderer ?? 'webgl')
    this.textLayer = new TextLayer(container)
    this.boxEl = document.createElement('div')
    Object.assign(this.boxEl.style, {
      position: 'absolute', display: 'none', pointerEvents: 'none',
      background: 'rgba(100,150,255,0.15)', border: '1px solid rgba(100,150,255,0.9)',
    })
    container.appendChild(this.boxEl)

    this.resizeObs = new ResizeObserver(() => this.handleResize())
    this.resizeObs.observe(container)
    this.handleResize()
    this.bindEvents()
  }

  private createRenderer(kind: RendererKind): Renderer {
    if (kind === 'webgl') {
      try {
        const r = new WebGLRenderer(this.canvas)
        r.restoreCallback = () => this.invalidate()
        return r
      } catch (e) {
        console.warn('[rtplot] WebGL không khả dụng, dùng Canvas 2D', e)
      }
    }
    return new Canvas2DRenderer(this.canvas)
  }

  /** Backend đang dùng thực tế */
  get rendererKind(): RendererKind {
    return this.renderer.kind
  }

  // ===================== API công khai =====================

  add<T extends Series>(s: T): T {
    this.series.push(s)
    s.onChange = () => this.invalidate()
    this.invalidate()
    return s
  }

  remove(s: Series) {
    const i = this.series.indexOf(s)
    if (i >= 0) {
      this.series.splice(i, 1)
      s.onChange = null
      this.invalidate()
    }
  }

  setXLimits(min: number, max: number) {
    this.autoX = false
    this.xMin = min
    this.xMax = max
    this.viewChanged()
  }

  setYLimits(min: number, max: number) {
    this.autoY = false
    this.yMin = min
    this.yMax = max
    this.viewChanged()
  }

  /** Auto-scale cả 2 trục (và bật lại follow ở chế độ streaming) */
  autoScale() {
    this.autoX = true
    this.autoY = true
    this.forceYFit = true
    this.updateAutoLimits()
    this.viewChanged()
  }

  getState(): AxisState {
    return { xMin: this.xMin, xMax: this.xMax, yMin: this.yMin, yMax: this.yMax, autoX: this.autoX, autoY: this.autoY, followWindow: this.followWindow }
  }

  /** Áp trạng thái từ plot liên kết (không phát lại sự kiện) */
  applyState(s: AxisState, axes: { x: boolean; y: boolean }) {
    if (axes.x) {
      this.xMin = s.xMin
      this.xMax = s.xMax
      this.autoX = s.autoX
      if (this.followWindow > 0 && s.followWindow > 0) this.followWindow = s.followWindow
    }
    if (axes.y) {
      this.yMin = s.yMin
      this.yMax = s.yMax
      this.autoY = s.autoY
    }
    this.invalidate()
  }

  /** Đăng ký nghe khi người dùng thay đổi vùng nhìn. Trả về hàm huỷ. */
  onViewChange(fn: ViewListener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Gọi sau mỗi lần vẽ (dùng để cập nhật thống kê trên UI) */
  onRender(fn: () => void) {
    this.renderListeners.add(fn)
    return () => this.renderListeners.delete(fn)
  }

  /** Yêu cầu vẽ lại ở khung hình kế tiếp (gộp nhiều lần gọi thành 1 lần vẽ) */
  invalidate() {
    if (this.frameRequested || this.destroyed) return
    this.frameRequested = true
    requestAnimationFrame((t) => {
      // mốc thời gian của rAF bám theo vsync và không bị giảm độ chính xác như performance.now()
      // trên Firefox → tốc độ cuộn đều hơn
      this.frameTime = t
      this.frameRequested = false
      if (!this.destroyed) this.render()
    })
  }

  destroy() {
    this.destroyed = true
    this.resizeObs.disconnect()
    this.unbindEvents()
    for (const s of this.series) s.onChange = null
    this.renderer.destroy()
    this.textLayer.destroy()
    this.boxEl.remove()
    this.canvas.remove()
    this.listeners.clear()
    this.renderListeners.clear()
  }

  // ===================== Vùng vẽ & chuyển đổi toạ độ =====================

  private get plotRect() {
    const d = this.dpr
    const top = (MARGIN.top + (this.title ? 18 : 0)) * d
    const left = (MARGIN.left + (this.yLabel ? 14 : 0)) * d
    const bottom = (MARGIN.bottom + (this.xLabel ? 14 : 0)) * d
    return {
      left,
      top,
      width: Math.max(10, this.canvas.width - left - MARGIN.right * d),
      height: Math.max(10, this.canvas.height - top - bottom),
    }
  }

  private makeView(): View {
    const r = this.plotRect
    const { xMin, xMax, yMin, yMax } = this
    const sx = r.width / (xMax - xMin)
    const sy = r.height / (yMax - yMin)
    return {
      xMin, xMax, yMin, yMax,
      left: r.left, top: r.top, width: r.width, height: r.height,
      dpr: this.dpr,
      xToPx: (x) => r.left + (x - xMin) * sx,
      yToPx: (y) => r.top + r.height - (y - yMin) * sy,
      pxToX: (px) => xMin + (px - r.left) / sx,
    }
  }

  /** chuyển toạ độ chuột (CSS px trong canvas) sang dữ liệu */
  private cssToData(cx: number, cy: number) {
    const r = this.plotRect
    const px = cx * this.dpr, py = cy * this.dpr
    return {
      x: this.xMin + ((px - r.left) / r.width) * (this.xMax - this.xMin),
      y: this.yMin + ((r.top + r.height - py) / r.height) * (this.yMax - this.yMin),
    }
  }

  private regionAt(cx: number, cy: number): Region {
    const r = this.plotRect
    const px = cx * this.dpr, py = cy * this.dpr
    const inX = px >= r.left && px <= r.left + r.width
    const inY = py >= r.top && py <= r.top + r.height
    if (inX && inY) return 'plot'
    if (inY && px < r.left) return 'yaxis'
    if (inX && py > r.top + r.height) return 'xaxis'
    return 'none'
  }

  // ===================== Auto-scale =====================

  private dataXRange(): [number, number] | null {
    let lo = Infinity, hi = -Infinity
    for (const s of this.series) {
      if (!s.visible) continue
      const r = s.getXRange()
      if (!r) continue
      if (r[0] < lo) lo = r[0]
      if (r[1] > hi) hi = r[1]
    }
    return lo <= hi ? [lo, hi] : null
  }

  private updateAutoLimits() {
    if (this.autoX) {
      const r = this.dataXRange()
      if (r) {
        if (this.followWindow > 0) this.updateFollow(Math.max(r[1], r[0] + this.followWindow))
        else {
          this.xMin = r[0]
          this.xMax = r[1] > r[0] ? r[1] : r[0] + 1
        }
      }
    }
    if (this.autoY) {
      let lo = Infinity, hi = -Infinity
      for (const s of this.series) {
        if (!s.visible) continue
        const r = s.getYRange(this.xMin, this.xMax)
        if (!r) continue
        if (r[0] < lo) lo = r[0]
        if (r[1] > hi) hi = r[1]
      }
      if (lo <= hi && isFinite(lo) && isFinite(hi)) {
        const span = hi - lo || Math.abs(hi) || 1
        const cur = this.yMax - this.yMin
        // Streaming: giữ nguyên trục Y nếu dữ liệu vẫn nằm gọn trong khung và chiếm > 50% chiều cao.
        // Không có độ trễ này, mỗi đỉnh nhiễu trôi vào/ra cửa sổ làm cả đồ thị co giãn → nhấp nháy.
        const keep = this.followWindow > 0 && !this.forceYFit && cur > 0 &&
          lo >= this.yMin && hi <= this.yMax && span > cur * 0.5
        if (!keep) {
          const pad = this.followWindow > 0 && !this.forceYFit ? this.yPadding + 0.1 : this.yPadding
          this.yMin = lo - span * pad
          this.yMax = hi + span * pad
        }
        this.forceYFit = false
      }
    }
  }

  /**
   * Cuộn mượt khi streaming. Dữ liệu thường đến theo từng cụm (WebSocket, timer...) nên nếu
   * mép phải nhảy thẳng tới mẫu mới nhất thì mỗi khung hình dịch một khoảng khác nhau → giật.
   * Ở đây mép phải chạy đều theo tốc độ ước lượng của dữ liệu và được kéo dần về mẫu mới nhất.
   * Vị trí còn được làm tròn theo lưới pixel để nét vẽ không bị nhoè/nhấp nháy giữa các khung.
   */
  private updateFollow(target: number) {
    const f = this.follow
    const now = this.frameTime || performance.now()
    const win = this.followWindow
    if (target !== f.target) {
      if (isFinite(f.target) && target > f.target) {
        const inst = (target - f.target) / Math.max(1, now - f.targetNow)
        f.rate = f.rate > 0 ? f.rate * 0.95 + inst * 0.05 : inst
      }
      f.target = target
      f.targetNow = now
    }
    const stalled = now - f.targetNow > 250 // dữ liệu ngừng đến (tạm dừng)
    let x: number
    if (!isFinite(f.x) || Math.abs(target - f.x) > win * 0.2) {
      x = target // lệch quá xa (mới bắt đầu, đổi cửa sổ, dữ liệu reset) → nhảy thẳng
    } else if (stalled) {
      x = f.x + (target - f.x) * 0.3
      if (Math.abs(target - x) < win * 1e-6) x = target
    } else {
      x = f.x + f.rate * (now - f.lastNow)
      x += (target - x) * 0.08
    }
    f.x = x
    f.lastNow = now
    // làm tròn theo pixel
    const pxW = win / Math.max(1, this.plotRect.width)
    this.xMin = Math.round((x - win) / pxW) * pxW
    this.xMax = this.xMin + win
  }

  /** Đang cuộn liên tục (cần vẽ lại mỗi khung hình dù không có dữ liệu mới)? */
  private get animating() {
    const f = this.follow
    return this.autoX && this.followWindow > 0 && isFinite(f.x) && f.x !== f.target
  }

  private viewChanged() {
    this.invalidate()
    const st = this.getState()
    for (const fn of this.listeners) fn(st, this)
  }

  // ===================== Vẽ =====================

  private handleResize() {
    const rect = this.container.getBoundingClientRect()
    this.dpr = window.devicePixelRatio || 1
    this.cssW = Math.max(1, Math.floor(rect.width))
    this.cssH = Math.max(1, Math.floor(rect.height))
    const w = Math.round(this.cssW * this.dpr), h = Math.round(this.cssH * this.dpr)
    this.renderer.resize(w, h)
    // vẽ ngay (đồng bộ) để không bị nháy trắng khi kéo cửa sổ
    this.render()
  }

  render() {
    const t0 = performance.now()
    this.updateAutoLimits()
    if (!(this.xMax > this.xMin)) this.xMax = this.xMin + 1
    if (!(this.yMax > this.yMin)) this.yMax = this.yMin + 1

    const r = this.renderer, th = this.theme, d = this.dpr
    const v = this.makeView()
    r.begin(th.background)
    r.fillRect(v.left, v.top, v.width, v.height, th.plotBackground)

    // lưới
    const xt = niceTicks(v.xMin, v.xMax, Math.max(3, Math.floor(v.width / (90 * d))))
    const yt = niceTicks(v.yMin, v.yMax, Math.max(3, Math.floor(v.height / (32 * d))))
    const seg = this.segBuf
    const xs = xt.ticks.map((x) => Math.round(v.xToPx(x)) + 0.5)
    const ys = yt.ticks.map((y) => Math.round(v.yToPx(y)) + 0.5)
    seg.reset()
    for (const px of xs) seg.push4(px, v.top, px, v.top + v.height)
    for (const py of ys) seg.push4(v.left, py, v.left + v.width, py)
    r.segments(seg.data, seg.length / 4, th.grid, 1)

    // series (cắt trong vùng plot)
    r.clip({ x: v.left, y: v.top, w: v.width, h: v.height })
    let drawn = 0, total = 0
    for (const s of this.series) {
      total += s.count
      if (!s.visible) continue
      s.draw(r, v)
      drawn += s.lastDrawnPoints
    }
    r.clip(null)

    // khung + vạch chia
    const L = v.left + 0.5 * d, T = v.top + 0.5 * d
    const R = v.left + v.width - 0.5 * d, B = v.top + v.height - 0.5 * d
    seg.reset()
    seg.push4(L, T, R, T)
    seg.push4(R, T, R, B)
    seg.push4(R, B, L, B)
    seg.push4(L, B, L, T)
    for (const px of xs) seg.push4(px, v.top + v.height, px, v.top + v.height + 4 * d)
    for (const py of ys) seg.push4(v.left - 4 * d, py, v.left, py)
    r.segments(seg.data, seg.length / 4, th.axis, d)
    r.end()

    // ---- chữ (HTML, toạ độ CSS px) ----
    const tl = this.textLayer
    const font = th.font
    tl.begin()
    xt.ticks.forEach((x, i) => tl.text(formatTick(x, xt.step), xs[i] / d, (v.top + v.height) / d + 6, 'center', 'top', th.text, font))
    yt.ticks.forEach((y, i) => tl.text(formatTick(y, yt.step), v.left / d - 6, ys[i] / d, 'right', 'middle', th.text, font))
    if (this.title) tl.text(this.title, (v.left + v.width / 2) / d, 6, 'center', 'top', th.text, '600 12px system-ui, sans-serif')
    if (this.xLabel) tl.text(this.xLabel, (v.left + v.width / 2) / d, this.cssH - 4, 'center', 'bottom', th.text, font)
    if (this.yLabel) tl.text(this.yLabel, 12, (v.top + v.height / 2) / d, 'center', 'middle', th.text, font, -90)
    // toạ độ con trỏ
    if (this.mouse && this.regionAt(this.mouse.x, this.mouse.y) === 'plot') {
      const p = this.cssToData(this.mouse.x, this.mouse.y)
      const txt = `x=${formatTick(p.x, xt.step / 100)}  y=${formatTick(p.y, yt.step / 100)}`
      tl.text(txt, (v.left + v.width) / d - 6, v.top / d + 6, 'right', 'top', th.text, font)
    }
    // trạng thái
    if (this.followWindow > 0 && !this.autoX) {
      tl.text('⏸ đã dừng bám (double-click để tiếp tục)', v.left / d + 6, v.top / d + 6, 'left', 'top', '#e0a030', font)
    }
    tl.end()

    // hình chữ nhật zoom vùng chọn
    if (this.drag === 'box') {
      const { x: x0, y: y0 } = this.dragStart, { x: x1, y: y1 } = this.dragCur
      Object.assign(this.boxEl.style, {
        display: 'block', left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px',
        width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px',
      })
    } else if (this.boxEl.style.display !== 'none') this.boxEl.style.display = 'none'

    this.stats.drawnPoints = drawn
    this.stats.totalPoints = total
    this.stats.renderMs = performance.now() - t0
    // fps chỉ có ý nghĩa khi đang cuộn liên tục (streaming)
    if (!this.animating) {
      this.stats.fps = 0
      this.fpsFrames = 0
      this.fpsSince = t0
    } else this.fpsFrames++
    if (this.fpsFrames > 0 && t0 - this.fpsSince >= 1000) {
      this.stats.fps = (this.fpsFrames * 1000) / (t0 - this.fpsSince)
      this.fpsFrames = 0
      this.fpsSince = t0
    }
    for (const fn of this.renderListeners) fn()
    if (this.animating) this.invalidate()
  }

  // ===================== Tương tác =====================

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const { x: cx, y: cy } = this.localPos(e)
    const region = this.regionAt(cx, cy)
    if (region === 'none') return
    // chuẩn hoá: chuột thường ~100/khấc, trackpad nhỏ hơn
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    const f = Math.exp(Math.max(-300, Math.min(300, delta)) * 0.0025) // >1 → zoom out
    let zx = false, zy = false
    if (region === 'xaxis') zx = true
    else if (region === 'yaxis') zy = true
    else if (e.ctrlKey) zx = zy = true
    else if (e.shiftKey) zy = true
    else zx = true

    const p = this.cssToData(cx, cy)
    if (zx) {
      if (this.followWindow > 0 && this.autoX) {
        // streaming: zoom X = đổi độ rộng cửa sổ, giữ mép phải bám dữ liệu mới
        this.followWindow *= f
      } else {
        this.xMin = p.x - (p.x - this.xMin) * f
        this.xMax = p.x + (this.xMax - p.x) * f
        this.autoX = false
      }
    }
    if (zy) {
      this.yMin = p.y - (p.y - this.yMin) * f
      this.yMax = p.y + (this.yMax - p.y) * f
      this.autoY = false
    }
    this.viewChanged()
  }

  private onPointerDown = (e: PointerEvent) => {
    const { x, y } = this.localPos(e)
    const region = this.regionAt(x, y)
    if (region === 'none') return
    if (e.button === 1 || (e.button === 0 && e.altKey)) this.drag = 'box'
    else if (e.button === 0) this.drag = 'pan'
    else if (e.button === 2) this.drag = 'zoom'
    else return
    e.preventDefault()
    this.canvas.setPointerCapture(e.pointerId)
    this.dragRegion = region
    this.dragStart = { x, y, xMin: this.xMin, xMax: this.xMax, yMin: this.yMin, yMax: this.yMax }
    this.dragCur = { x, y }
  }

  private onPointerMove = (e: PointerEvent) => {
    const { x, y } = this.localPos(e)
    this.mouse = { x, y }
    if (!this.drag) {
      this.invalidate()
      return
    }
    this.dragCur = { x, y }
    const s = this.dragStart
    const r = this.plotRect
    const d = this.dpr
    const dx = (x - s.x) * d, dy = (y - s.y) * d
    const useX = this.dragRegion !== 'yaxis'
    const useY = this.dragRegion !== 'xaxis'

    if (this.drag === 'pan') {
      if (useX && dx !== 0) {
        const shift = (dx / r.width) * (s.xMax - s.xMin)
        this.xMin = s.xMin - shift
        this.xMax = s.xMax - shift
        this.autoX = false
      }
      if (useY && dy !== 0) {
        const shift = (dy / r.height) * (s.yMax - s.yMin)
        this.yMin = s.yMin + shift
        this.yMax = s.yMax + shift
        this.autoY = false
      }
      this.viewChanged()
    } else if (this.drag === 'zoom') {
      // kéo phải: sang phải/lên = zoom in
      const p = { x: s.xMin + ((s.x * d - r.left) / r.width) * (s.xMax - s.xMin), y: s.yMin + ((r.top + r.height - s.y * d) / r.height) * (s.yMax - s.yMin) }
      if (useX) {
        const fx = Math.exp(-dx * 0.005)
        this.xMin = p.x - (p.x - s.xMin) * fx
        this.xMax = p.x + (s.xMax - p.x) * fx
        this.autoX = false
      }
      if (useY) {
        const fy = Math.exp(dy * 0.005)
        this.yMin = p.y - (p.y - s.yMin) * fy
        this.yMax = p.y + (s.yMax - p.y) * fy
        this.autoY = false
      }
      this.viewChanged()
    } else {
      this.invalidate()
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    if (!this.drag) return
    if (this.drag === 'box') {
      const a = this.cssToData(this.dragStart.x, this.dragStart.y)
      const b = this.cssToData(this.dragCur.x, this.dragCur.y)
      const wPx = Math.abs(this.dragCur.x - this.dragStart.x)
      const hPx = Math.abs(this.dragCur.y - this.dragStart.y)
      this.drag = null
      if (wPx > 4 && this.dragRegion !== 'yaxis') {
        this.xMin = Math.min(a.x, b.x)
        this.xMax = Math.max(a.x, b.x)
        this.autoX = false
      }
      if (hPx > 4 && this.dragRegion !== 'xaxis') {
        this.yMin = Math.min(a.y, b.y)
        this.yMax = Math.max(a.y, b.y)
        this.autoY = false
      }
      this.viewChanged()
    }
    this.drag = null
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
    this.invalidate()
  }

  private onLeave = () => {
    this.mouse = null
    this.invalidate()
  }

  private onDblClick = (e: MouseEvent) => {
    const { x, y } = this.localPos(e)
    const region = this.regionAt(x, y)
    // double-click trên trục chỉ auto-scale trục đó
    if (region === 'xaxis') this.autoX = true
    else if (region === 'yaxis') this.autoY = true
    else {
      this.autoX = true
      this.autoY = true
    }
    if (this.autoY) this.forceYFit = true
    this.updateAutoLimits()
    this.viewChanged()
  }

  private onContextMenu = (e: Event) => e.preventDefault()

  private localPos(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private bindEvents() {
    const c = this.canvas
    c.addEventListener('wheel', this.onWheel, { passive: false })
    c.addEventListener('pointerdown', this.onPointerDown)
    c.addEventListener('pointermove', this.onPointerMove)
    c.addEventListener('pointerup', this.onPointerUp)
    c.addEventListener('pointercancel', this.onPointerUp)
    c.addEventListener('pointerleave', this.onLeave)
    c.addEventListener('dblclick', this.onDblClick)
    c.addEventListener('contextmenu', this.onContextMenu)
  }

  private unbindEvents() {
    const c = this.canvas
    c.removeEventListener('wheel', this.onWheel)
    c.removeEventListener('pointerdown', this.onPointerDown)
    c.removeEventListener('pointermove', this.onPointerMove)
    c.removeEventListener('pointerup', this.onPointerUp)
    c.removeEventListener('pointercancel', this.onPointerUp)
    c.removeEventListener('pointerleave', this.onLeave)
    c.removeEventListener('dblclick', this.onDblClick)
    c.removeEventListener('contextmenu', this.onContextMenu)
  }
}
