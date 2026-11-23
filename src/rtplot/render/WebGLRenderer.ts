import { FloatBuffer, parseColor, type Renderer } from './Renderer'

const VS = `
attribute vec2 a_pos;
uniform vec2 u_res;
void main() {
  // device pixel (gốc trên-trái) → clip space
  gl_Position = vec4(a_pos.x / u_res.x * 2.0 - 1.0, 1.0 - a_pos.y / u_res.y * 2.0, 0.0, 1.0);
}`

const FS = `
precision mediump float;
uniform vec4 u_color;
void main() {
  gl_FragColor = vec4(u_color.rgb * u_color.a, u_color.a);
}`

/**
 * Backend WebGL: mọi hình được tách thành tam giác trên CPU rồi vẽ bằng 1 shader tô màu đặc.
 * Mỗi lệnh (lưới, 1 series...) là 1 lần drawArrays — vài chục lần mỗi khung hình.
 * Vẽ thẳng trên GPU nên không có bước upload bitmap của Canvas 2D (vốn chậm trên Firefox).
 */
export class WebGLRenderer implements Renderer {
  readonly kind = 'webgl' as const
  private canvas: HTMLCanvasElement
  private gl!: WebGLRenderingContext
  private prog!: WebGLProgram
  private buf!: WebGLBuffer
  private uRes!: WebGLUniformLocation
  private uColor!: WebGLUniformLocation
  private tri = new FloatBuffer(1 << 16)
  private lost = false
  private onLost = (e: Event) => {
    e.preventDefault()
    this.lost = true
  }
  private onRestored = () => {
    this.init()
    this.lost = false
    this.restoreCallback?.()
  }
  /** Plot gán để vẽ lại sau khi GPU khôi phục context */
  restoreCallback: (() => void) | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.init()
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
  }

  private init() {
    const opts: WebGLContextAttributes = { antialias: true, alpha: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false }
    const gl = (this.canvas.getContext('webgl2', opts) ?? this.canvas.getContext('webgl', opts)) as WebGLRenderingContext | null
    if (!gl) throw new Error('WebGL không khả dụng')
    this.gl = gl
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Lỗi shader: ' + gl.getShaderInfoLog(sh))
      return sh
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS))
    gl.bindAttribLocation(prog, 0, 'a_pos')
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Lỗi link shader: ' + gl.getProgramInfoLog(prog))
    this.prog = prog
    this.uRes = gl.getUniformLocation(prog, 'u_res')!
    this.uColor = gl.getUniformLocation(prog, 'u_color')!
    this.buf = gl.createBuffer()!
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST)
  }

  resize(width: number, height: number) {
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
  }

  begin(background: string) {
    if (this.lost) return
    const gl = this.gl
    gl.disable(gl.SCISSOR_TEST)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height)
    const c = parseColor(background)
    gl.clearColor(c[0], c[1], c[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /** Vẽ các tam giác đang có trong this.tri rồi xoá bộ đệm */
  private flush(color: string) {
    const n = this.tri.length / 2
    if (n === 0 || this.lost) {
      this.tri.reset()
      return
    }
    const gl = this.gl
    const c = parseColor(color)
    gl.uniform4f(this.uColor, c[0], c[1], c[2], c[3])
    gl.bufferData(gl.ARRAY_BUFFER, this.tri.data.subarray(0, this.tri.length), gl.STREAM_DRAW)
    gl.drawArrays(gl.TRIANGLES, 0, n)
    this.tri.reset()
  }

  private quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    // (0,1,2) + (0,2,3)
    const t = this.tri
    t.reserve(12)
    t.push4(x0, y0, x1, y1)
    t.push4(x2, y2, x0, y0)
    t.push4(x2, y2, x3, y3)
  }

  /** Đoạn thẳng dày `w` thành 1 hình chữ nhật xoay; `ext` kéo dài 2 đầu (nối các đoạn liền nhau) */
  private line(xa: number, ya: number, xb: number, yb: number, w: number, ext: number) {
    let dx = xb - xa, dy = yb - ya
    const len = Math.hypot(dx, dy)
    if (len === 0) {
      dx = 1
      dy = 0
    } else {
      dx /= len
      dy /= len
    }
    const h = w / 2
    const nx = -dy * h, ny = dx * h
    const ax = xa - dx * ext, ay = ya - dy * ext
    const bx = xb + dx * ext, by = yb + dy * ext
    this.quad(ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny)
  }

  fillRect(x: number, y: number, w: number, h: number, color: string) {
    this.quad(x, y, x + w, y, x + w, y + h, x, y + h)
    this.flush(color)
  }

  segments(d: Float32Array, count: number, color: string, width: number) {
    for (let i = 0; i < count; i++) {
      const k = i * 4
      this.line(d[k], d[k + 1], d[k + 2], d[k + 3], width, 0)
    }
    this.flush(color)
  }

  polyline(d: Float32Array, count: number, color: string, width: number) {
    const ext = width / 2 // đầu vuông → che khe hở ở chỗ gấp khúc
    for (let i = 1; i < count; i++) {
      const ya = d[i * 2 - 1], yb = d[i * 2 + 1]
      if (ya !== ya || yb !== yb) continue
      this.line(d[i * 2 - 2], ya, d[i * 2], yb, width, ext)
    }
    this.flush(color)
  }

  rects(d: Float32Array, count: number, color: string) {
    for (let i = 0; i < count; i++) {
      const k = i * 4
      const x = d[k], y = d[k + 1], w = d[k + 2], h = d[k + 3]
      this.quad(x, y, x + w, y, x + w, y + h, x, y + h)
    }
    this.flush(color)
  }

  dots(d: Float32Array, count: number, color: string, r: number) {
    const SEG = 10
    const t = this.tri
    for (let i = 0; i < count; i++) {
      const cx = d[i * 2], cy = d[i * 2 + 1]
      t.reserve(SEG * 6)
      for (let s = 0; s < SEG; s++) {
        const a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2
        t.push2(cx, cy)
        t.push4(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r)
      }
    }
    this.flush(color)
  }

  clip(rect: { x: number; y: number; w: number; h: number } | null) {
    if (this.lost) return
    const gl = this.gl
    if (!rect) {
      gl.disable(gl.SCISSOR_TEST)
      return
    }
    gl.enable(gl.SCISSOR_TEST)
    const x = Math.floor(rect.x), y = Math.floor(rect.y)
    const w = Math.ceil(rect.x + rect.w) - x, h = Math.ceil(rect.y + rect.h) - y
    gl.scissor(x, this.canvas.height - y - h, w, h)
  }

  end() {
    this.clip(null)
  }

  destroy() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    if (!this.lost) {
      this.gl.deleteBuffer(this.buf)
      this.gl.deleteProgram(this.prog)
      this.gl.getExtension('WEBGL_lose_context')?.loseContext() // giải phóng context ngay
    }
  }
}
