/** Tính các vạch chia "đẹp" (1, 2, 5 × 10^n) cho một khoảng giá trị. */
export function niceTicks(min: number, max: number, maxCount: number): { ticks: number[]; step: number } {
  const span = max - min
  if (!(span > 0) || !isFinite(span) || maxCount < 1) return { ticks: [], step: 0 }
  const rough = span / maxCount
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start, i = 0; v <= max + step * 1e-9 && i < 1000; i++, v = start + i * step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  }
  return { ticks, step }
}

export function formatTick(v: number, step: number): string {
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e6 || abs < 1e-4) return v.toExponential(2)
  const decimals = Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9)))
  return v.toFixed(decimals)
}
