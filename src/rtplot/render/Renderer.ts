/**
 * Lớp vẽ trừu tượng. Mọi toạ độ là device pixel, gốc ở góc trên-trái canvas.
 * Có 2 bản cài đặt: WebGLRenderer (mặc định) và Canvas2DRenderer (dự phòng / so sánh).
 * Chữ không vẽ qua đây mà dùng phần tử HTML (xem TextLayer) để cả 2 backend giống nhau.
 */
export interface Renderer {
  readonly kind: 'webgl' | 'canvas2d'
  /** Gọi khi canvas đổi kích thước */
  resize(width: number, height: number): void
  /** Bắt đầu khung hình: xoá toàn bộ bằng màu nền */
  begin(background: string): void
  fillRect(x: number, y: number, w: number, h: number, color: string): void
  /**
   * Các đoạn thẳng rời nhau, mảng [x0, y0, x1, y1, ...], `count` = số đoạn.
   * Dùng cho lưới, vạch chia, khung.
   */
  segments(data: Float32Array, count: number, color: string, width: number): void
  /** Đường gấp khúc [x0, y0, x1, y1, ...], `count` = số điểm. NaN ở y → ngắt đường. */
  polyline(data: Float32Array, count: number, color: string, width: number): void
  /** Nhiều hình chữ nhật [x, y, w, h, ...], `count` = số hình. */
  rects(data: Float32Array, count: number, color: string): void
  /** Chấm tròn tại các điểm [x, y, ...] */
  dots(data: Float32Array, count: number, color: string, radius: number): void
  /** Giới hạn vùng vẽ (null = bỏ giới hạn) */
  clip(rect: { x: number; y: number; w: number; h: number } | null): void
  /** Kết thúc khung hình */
  end(): void
  destroy(): void
}

/** Mảng Float32 tự lớn dần, dùng lại giữa các khung hình để tránh cấp phát */
export class FloatBuffer {
  data: Float32Array
  length = 0

  constructor(initial = 4096) {
    this.data = new Float32Array(initial)
  }

  reset() {
    this.length = 0
  }

  /** Đảm bảo còn chỗ cho thêm `n` số */
  reserve(n: number) {
    if (this.length + n <= this.data.length) return
    let cap = this.data.length * 2
    while (cap < this.length + n) cap *= 2
    const d = new Float32Array(cap)
    d.set(this.data.subarray(0, this.length))
    this.data = d
  }

  push2(a: number, b: number) {
    if (this.length + 2 > this.data.length) this.reserve(2)
    const d = this.data, i = this.length
    d[i] = a
    d[i + 1] = b
    this.length = i + 2
  }

  push4(a: number, b: number, c: number, e: number) {
    if (this.length + 4 > this.data.length) this.reserve(4)
    const d = this.data, i = this.length
    d[i] = a
    d[i + 1] = b
    d[i + 2] = c
    d[i + 3] = e
    this.length = i + 4
  }
}

// ---- chuyển màu CSS → RGBA (0..1), có cache ----
const colorCache = new Map<string, [number, number, number, number]>()
let colorCtx: CanvasRenderingContext2D | null = null

export function parseColor(css: string): [number, number, number, number] {
  const hit = colorCache.get(css)
  if (hit) return hit
  let rgba: [number, number, number, number] = [0, 0, 0, 1]
  // để trình duyệt chuẩn hoá mọi định dạng (tên màu, hsl, rgb...) về #rrggbb hoặc rgba(...)
  if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d')
  if (colorCtx) {
    colorCtx.fillStyle = '#000'
    colorCtx.fillStyle = css
    const n = String(colorCtx.fillStyle)
    if (n[0] === '#') {
      rgba = [parseInt(n.slice(1, 3), 16) / 255, parseInt(n.slice(3, 5), 16) / 255, parseInt(n.slice(5, 7), 16) / 255, 1]
    } else {
      const m = n.match(/[\d.]+/g)
      if (m) rgba = [+m[0] / 255, +m[1] / 255, +m[2] / 255, m[3] !== undefined ? +m[3] : 1]
    }
  }
  colorCache.set(css, rgba)
  return rgba
}
