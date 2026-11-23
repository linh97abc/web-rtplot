import { MinMaxPyramid } from './MinMaxPyramid'

/** Thông tin vùng vẽ, mọi toạ độ pixel đều là device pixel (đã nhân devicePixelRatio). */
export interface View {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  left: number
  top: number
  width: number
  height: number
  dpr: number
  xToPx(x: number): number
  yToPx(y: number): number
  pxToX(px: number): number
}

export interface SeriesStyle {
  name?: string
  color?: string
  lineWidth?: number
  visible?: boolean
  /** Vẽ chấm tại từng mẫu khi zoom đủ sâu (mặc định: true) */
  markers?: boolean
}

const PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#7f7f7f']
let paletteIndex = 0

/**
 * Lớp nền cho mọi series dạng "mảng mẫu có x tăng dần".
 * Phần vẽ dùng decimation min/max theo từng cột pixel: dù có bao nhiêu điểm trong
 * khung nhìn thì số đỉnh vẽ ra tối đa ≈ 2 × chiều rộng (pixel) của plot.
 */
export abstract class IndexedSeries {
  name: string
  color: string
  lineWidth: number
  markers: boolean
  private _visible: boolean
  /** Plot gán callback này để được báo khi cần vẽ lại */
  onChange: (() => void) | null = null
  /** Số đỉnh đã vẽ ở khung hình gần nhất (để thống kê) */
  lastDrawnPoints = 0

  constructor(style: SeriesStyle = {}) {
    this.name = style.name ?? `Series ${paletteIndex + 1}`
    this.color = style.color ?? PALETTE[paletteIndex++ % PALETTE.length]
    this.lineWidth = style.lineWidth ?? 1
    this.markers = style.markers ?? true
    this._visible = style.visible ?? true
  }

  get visible() {
    return this._visible
  }
  set visible(v: boolean) {
    if (v === this._visible) return
    this._visible = v
    this.notify()
  }

  protected notify() {
    this.onChange?.()
  }

  // ---- phần mà lớp con phải cung cấp ----
  /** Chỉ số mẫu đầu tiên còn tồn tại (bao gồm) */
  protected abstract firstIndex(): number
  /** Chỉ số sau mẫu cuối cùng (không bao gồm) */
  protected abstract endIndex(): number
  protected abstract xAt(i: number): number
  protected abstract yAt(i: number): number
  /** Chỉ số nhỏ nhất i sao cho xAt(i) >= x (đã kẹp trong [first, end]) */
  protected abstract indexCeil(x: number): number
  /** min/max của y trên [a, b) */
  protected abstract minMax(a: number, b: number, out: [number, number]): boolean

  /** Tổng số mẫu đang giữ */
  get count() {
    return this.endIndex() - this.firstIndex()
  }

  getXRange(): [number, number] | null {
    const a = this.firstIndex(), b = this.endIndex()
    if (b <= a) return null
    return [this.xAt(a), this.xAt(b - 1)]
  }

  private tmp: [number, number] = [0, 0]

  getYRange(x0: number, x1: number): [number, number] | null {
    // lấy thêm 1 mẫu mỗi bên: khi zoom sâu giữa 2 mẫu, đoạn nối vẫn nằm trong khung
    const a = Math.max(this.firstIndex(), this.indexCeil(x0) - 1)
    const b = Math.min(this.endIndex(), this.indexCeil(x1) + 1)
    if (!this.minMax(a, b, this.tmp)) return null
    return [this.tmp[0], this.tmp[1]]
  }

  draw(ctx: CanvasRenderingContext2D, v: View) {
    this.lastDrawnPoints = 0
    const first = this.firstIndex(), end = this.endIndex()
    if (end <= first) return
    // lấy thêm 1 mẫu mỗi bên để đường nối chạy ra tới mép
    const i0 = Math.max(first, this.indexCeil(v.xMin) - 1)
    const i1 = Math.min(end, this.indexCeil(v.xMax) + 1)
    const n = i1 - i0
    if (n <= 0) return

    ctx.strokeStyle = this.color
    ctx.lineWidth = this.lineWidth * v.dpr
    ctx.lineJoin = 'round'
    ctx.beginPath()
    const clampY = (y: number) => (y < -1e6 ? -1e6 : y > 1e6 ? 1e6 : y)

    if (n <= v.width * 2) {
      // ---- ít điểm: vẽ trực tiếp từng mẫu ----
      let pen = false
      for (let i = i0; i < i1; i++) {
        const y = this.yAt(i)
        if (y !== y) { pen = false; continue } // NaN → ngắt đường
        const px = v.xToPx(this.xAt(i)), py = clampY(v.yToPx(y))
        if (pen) ctx.lineTo(px, py)
        else { ctx.moveTo(px, py); pen = true }
      }
      ctx.stroke()
      this.lastDrawnPoints = n
      // zoom đủ sâu (mỗi mẫu cách nhau > 6px) → vẽ chấm cho từng mẫu
      const spanPx = v.xToPx(this.xAt(i1 - 1)) - v.xToPx(this.xAt(i0))
      if (this.markers && n > 1 && spanPx / (n - 1) > 6 * v.dpr) {
        ctx.fillStyle = this.color
        const r = Math.max(1.5, this.lineWidth * 1.5) * v.dpr
        ctx.beginPath()
        for (let i = i0; i < i1; i++) {
          const y = this.yAt(i)
          if (y !== y) continue
          const px = v.xToPx(this.xAt(i)), py = v.yToPx(y)
          ctx.moveTo(px + r, py)
          ctx.arc(px, py, r, 0, Math.PI * 2)
        }
        ctx.fill()
      }
      return
    }

    // ---- nhiều điểm: mỗi cột pixel vẽ 1 đoạn dọc từ min tới max ----
    const out = this.tmp
    const colStart = Math.max(Math.floor(v.left), Math.floor(v.xToPx(this.xAt(i0))))
    const colEnd = Math.min(Math.ceil(v.left + v.width), Math.ceil(v.xToPx(this.xAt(i1 - 1))) + 1)
    let a = this.indexCeil(v.pxToX(colStart))
    let started = false
    let points = 0
    // nối với mẫu ngay trước khung nhìn để không bị hở ở mép trái
    if (a - 1 >= first) {
      const y = this.yAt(a - 1)
      if (y === y) { ctx.moveTo(v.xToPx(this.xAt(a - 1)), clampY(v.yToPx(y))); started = true; points++ }
    }
    for (let c = colStart; c < colEnd; c++) {
      const b = this.indexCeil(v.pxToX(c + 1))
      if (b > a && this.minMax(a, b, out)) {
        const x = c + 0.5
        const yTop = clampY(v.yToPx(out[1]))
        const yBot = clampY(v.yToPx(out[0]))
        if (!started) { ctx.moveTo(x, yTop); started = true } else ctx.lineTo(x, yTop)
        ctx.lineTo(x, yBot === yTop ? yBot + 0.01 : yBot)
        points += 2
      }
      a = b
    }
    if (a < end) {
      const y = this.yAt(a)
      if (y === y) { ctx.lineTo(v.xToPx(this.xAt(a)), clampY(v.yToPx(y))); points++ }
    }
    ctx.stroke()
    this.lastDrawnPoints = points
  }
}

export interface SignalOptions extends SeriesStyle {
  /** Dữ liệu y. Nên dùng Float32Array / Float64Array cho dữ liệu lớn */
  ys: ArrayLike<number>
  /** Tần số lấy mẫu (mẫu/đơn vị x). Bỏ qua nếu truyền xs */
  sampleRate?: number
  /** x của mẫu đầu tiên (khi dùng sampleRate) */
  xOffset?: number
  /** Mảng x tăng dần (cho dữ liệu lấy mẫu không đều) */
  xs?: ArrayLike<number>
}

/**
 * Tín hiệu tĩnh, có thể hàng chục triệu điểm (tương tự ScottPlot Signal / SignalXY).
 * Tạo một MinMaxPyramid một lần, sau đó mỗi khung hình chỉ đọc vài nghìn giá trị.
 */
export class SignalSeries extends IndexedSeries {
  readonly ys: ArrayLike<number>
  readonly xs: ArrayLike<number> | null
  readonly sampleRate: number
  readonly xOffset: number
  private pyramid: MinMaxPyramid

  constructor(opts: SignalOptions) {
    super(opts)
    this.ys = opts.ys
    this.xs = opts.xs ?? null
    this.sampleRate = opts.sampleRate ?? 1
    this.xOffset = opts.xOffset ?? 0
    if (this.xs && this.xs.length !== this.ys.length) throw new Error('xs và ys phải cùng độ dài')
    this.pyramid = new MinMaxPyramid(this.ys)
  }

  protected firstIndex() { return 0 }
  protected endIndex() { return this.ys.length }
  protected xAt(i: number) { return this.xs ? this.xs[i] : this.xOffset + i / this.sampleRate }
  protected yAt(i: number) { return this.ys[i] }

  protected indexCeil(x: number) {
    const n = this.ys.length
    if (!this.xs) {
      const i = Math.ceil((x - this.xOffset) * this.sampleRate - 1e-9)
      return i < 0 ? 0 : i > n ? n : i
    }
    // tìm nhị phân
    let lo = 0, hi = n
    const xs = this.xs
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (xs[mid] < x) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  protected minMax(a: number, b: number, out: [number, number]) {
    return this.pyramid.query(a, b, out)
  }
}

export interface StreamOptions extends SeriesStyle {
  /** Số mẫu tối đa giữ trong bộ đệm vòng */
  capacity: number
  sampleRate: number
  xOffset?: number
}

/**
 * Tín hiệu streaming với bộ đệm vòng cố định (tương tự ScottPlot DataStreamer/DataLogger).
 * push() rất rẻ, mẫu cũ bị ghi đè khi đầy. Plot tự vẽ lại ở khung hình kế tiếp.
 */
export class StreamSeries extends IndexedSeries {
  readonly capacity: number
  readonly sampleRate: number
  readonly xOffset: number
  private buf: Float32Array
  /** Tổng số mẫu đã push từ đầu (chỉ số toàn cục) */
  private total = 0

  constructor(opts: StreamOptions) {
    super(opts)
    this.capacity = opts.capacity
    this.sampleRate = opts.sampleRate
    this.xOffset = opts.xOffset ?? 0
    this.buf = new Float32Array(opts.capacity)
  }

  push(values: number | ArrayLike<number>) {
    const cap = this.capacity, buf = this.buf
    if (typeof values === 'number') {
      buf[this.total % cap] = values
      this.total++
    } else {
      const len = values.length
      const start = len > cap ? len - cap : 0
      if (start > 0) this.total += start
      for (let i = start; i < len; i++) {
        buf[this.total % cap] = values[i]
        this.total++
      }
    }
    this.notify()
  }

  clear() {
    this.total = 0
    this.notify()
  }

  /** x của mẫu mới nhất */
  get latestX() {
    return this.total > 0 ? this.xAt(this.total - 1) : this.xOffset
  }

  protected firstIndex() { return Math.max(0, this.total - this.capacity) }
  protected endIndex() { return this.total }
  protected xAt(i: number) { return this.xOffset + i / this.sampleRate }
  protected yAt(i: number) { return this.buf[i % this.capacity] }

  protected indexCeil(x: number) {
    const i = Math.ceil((x - this.xOffset) * this.sampleRate - 1e-9)
    const f = this.firstIndex(), e = this.total
    return i < f ? f : i > e ? e : i
  }

  protected minMax(a: number, b: number, out: [number, number]) {
    if (b <= a) return false
    const cap = this.capacity, buf = this.buf
    let lo = Infinity, hi = -Infinity
    // duyệt theo 2 đoạn liên tục của bộ đệm vòng
    let s = a % cap
    let remaining = b - a
    while (remaining > 0) {
      const run = Math.min(remaining, cap - s)
      for (let i = s, e = s + run; i < e; i++) {
        const v = buf[i]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      remaining -= run
      s = 0
    }
    out[0] = lo
    out[1] = hi
    return lo <= hi
  }
}

export type Series = IndexedSeries
