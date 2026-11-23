export type HAlign = 'left' | 'center' | 'right'
export type VAlign = 'top' | 'middle' | 'bottom'

interface Slot {
  el: HTMLSpanElement
  text: string
  style: string
  transform: string
}

const HX: Record<HAlign, string> = { left: '0', center: '-50%', right: '-100%' }
const VY: Record<VAlign, string> = { top: '0', middle: '-50%', bottom: '-100%' }

/**
 * Lớp chữ bằng phần tử HTML đặt chồng lên canvas (pointer-events: none).
 * Các <span> được dùng lại giữa các khung hình; chỉ cập nhật thuộc tính nào thay đổi,
 * vị trí đặt bằng CSS transform nên trình duyệt không phải tính lại layout.
 */
export class TextLayer {
  readonly root: HTMLDivElement
  private slots: Slot[] = []
  private used = 0

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    Object.assign(this.root.style, {
      position: 'absolute', left: '0', top: '0', right: '0', bottom: '0',
      pointerEvents: 'none', overflow: 'hidden', userSelect: 'none',
    })
    parent.appendChild(this.root)
  }

  begin() {
    this.used = 0
  }

  /** Đặt 1 dòng chữ tại (x, y) theo CSS pixel */
  text(str: string, x: number, y: number, h: HAlign, v: VAlign, color: string, font: string, rotate = 0) {
    let s = this.slots[this.used]
    if (!s) {
      const el = document.createElement('span')
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap', lineHeight: '1', willChange: 'transform' })
      this.root.appendChild(el)
      s = { el, text: '', style: '', transform: '' }
      this.slots.push(s)
    }
    this.used++
    if (s.el.style.display === 'none') s.el.style.display = ''
    if (s.text !== str) {
      s.el.textContent = str
      s.text = str
    }
    const style = color + '|' + font
    if (s.style !== style) {
      s.el.style.color = color
      s.el.style.font = font
      s.style = style
    }
    const t = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)${rotate ? ` rotate(${rotate}deg)` : ''} translate(${HX[h]},${VY[v]})`
    if (s.transform !== t) {
      s.el.style.transform = t
      s.transform = t
    }
  }

  /** Ẩn các span không dùng tới trong khung hình này */
  end() {
    for (let i = this.used; i < this.slots.length; i++) {
      const s = this.slots[i]
      if (s.el.style.display !== 'none') s.el.style.display = 'none'
    }
  }

  destroy() {
    this.root.remove()
    this.slots = []
  }
}
