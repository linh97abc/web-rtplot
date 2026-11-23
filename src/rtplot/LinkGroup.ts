import type { Plot, AxisState } from './Plot'

export interface LinkAxes {
  x?: boolean
  y?: boolean
}

/**
 * Liên kết nhiều plot để pan/zoom đồng thời (giống ScottPlot AxisLink).
 * Mặc định chỉ liên kết trục X — trường hợp phổ biến khi so sánh nhiều tín hiệu theo thời gian.
 */
export class LinkGroup {
  private members = new Map<Plot, { axes: { x: boolean; y: boolean }; off: () => void }>()
  private applying = false

  add(plot: Plot, axes: LinkAxes = { x: true }) {
    if (this.members.has(plot)) return
    const a = { x: axes.x ?? true, y: axes.y ?? false }
    const off = plot.onViewChange((st) => this.broadcast(plot, st))
    this.members.set(plot, { axes: a, off })
    // đồng bộ ngay với thành viên đầu tiên
    const first = this.members.keys().next().value
    if (first && first !== plot) plot.applyState(first.getState(), a)
  }

  remove(plot: Plot) {
    const m = this.members.get(plot)
    if (!m) return
    m.off()
    this.members.delete(plot)
  }

  clear() {
    for (const p of [...this.members.keys()]) this.remove(p)
  }

  private broadcast(source: Plot, st: AxisState) {
    if (this.applying) return
    const src = this.members.get(source)
    if (!src) return
    this.applying = true
    try {
      for (const [p, m] of this.members) {
        if (p === source) continue
        // chỉ đồng bộ những trục mà cả 2 plot cùng liên kết
        p.applyState(st, { x: m.axes.x && src.axes.x, y: m.axes.y && src.axes.y })
      }
    } finally {
      this.applying = false
    }
  }
}
