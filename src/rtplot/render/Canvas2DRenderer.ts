import type { Renderer } from './Renderer'

/** Backend Canvas 2D — dự phòng khi không có WebGL, và để so sánh hiệu năng. */
export class Canvas2DRenderer implements Renderer {
  readonly kind = 'canvas2d' as const
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private clipped = false

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas 2D không khả dụng')
    this.canvas = canvas
    this.ctx = ctx
  }

  resize(width: number, height: number) {
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
  }

  begin(background: string) {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = background
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  fillRect(x: number, y: number, w: number, h: number, color: string) {
    this.ctx.fillStyle = color
    this.ctx.fillRect(x, y, w, h)
  }

  segments(d: Float32Array, count: number, color: string, width: number) {
    const ctx = this.ctx
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const k = i * 4
      ctx.moveTo(d[k], d[k + 1])
      ctx.lineTo(d[k + 2], d[k + 3])
    }
    ctx.stroke()
  }

  polyline(d: Float32Array, count: number, color: string, width: number) {
    const ctx = this.ctx
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'bevel'
    ctx.beginPath()
    let pen = false
    for (let i = 0; i < count; i++) {
      const x = d[i * 2], y = d[i * 2 + 1]
      if (y !== y) { pen = false; continue }
      if (pen) ctx.lineTo(x, y)
      else { ctx.moveTo(x, y); pen = true }
    }
    ctx.stroke()
  }

  rects(d: Float32Array, count: number, color: string) {
    const ctx = this.ctx
    ctx.fillStyle = color
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const k = i * 4
      ctx.rect(d[k], d[k + 1], d[k + 2], d[k + 3])
    }
    ctx.fill()
  }

  dots(d: Float32Array, count: number, color: string, r: number) {
    const ctx = this.ctx
    ctx.fillStyle = color
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const x = d[i * 2], y = d[i * 2 + 1]
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  clip(rect: { x: number; y: number; w: number; h: number } | null) {
    const ctx = this.ctx
    if (this.clipped) {
      ctx.restore()
      this.clipped = false
    }
    if (rect) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(rect.x, rect.y, rect.w, rect.h)
      ctx.clip()
      this.clipped = true
    }
  }

  end() {
    this.clip(null)
  }

  destroy() {}
}
