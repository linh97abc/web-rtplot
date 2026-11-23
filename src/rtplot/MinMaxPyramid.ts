/**
 * Cây min/max nhiều tầng (giống cách ScottPlot SignalPlot làm decimation).
 * Tầng 0 là dữ liệu gốc; tầng k gom FANOUT^k mẫu thành 1 cặp (min, max).
 * Truy vấn min/max trên đoạn [a, b) tốn O(FANOUT · log(n)) thay vì O(b - a),
 * nên dù có 10 triệu điểm, mỗi khung hình chỉ duyệt vài chục nghìn phần tử.
 * Bộ nhớ phụ ≈ 2n / (FANOUT - 1) số float.
 */
const FANOUT = 8

export class MinMaxPyramid {
  readonly data: ArrayLike<number>
  readonly length: number
  private mins: Float32Array[] = []
  private maxs: Float32Array[] = []

  constructor(data: ArrayLike<number>) {
    this.data = data
    this.length = data.length
    this.build()
  }

  private build() {
    let n = this.length
    if (n <= FANOUT) return
    // tầng 1 lấy trực tiếp từ dữ liệu gốc
    let len = Math.ceil(n / FANOUT)
    let mn = new Float32Array(len)
    let mx = new Float32Array(len)
    const d = this.data
    for (let i = 0; i < len; i++) {
      let lo = Infinity, hi = -Infinity
      const end = Math.min(n, (i + 1) * FANOUT)
      for (let j = i * FANOUT; j < end; j++) {
        const v = d[j]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      mn[i] = lo
      mx[i] = hi
    }
    this.mins.push(mn)
    this.maxs.push(mx)
    n = len
    while (n > FANOUT) {
      len = Math.ceil(n / FANOUT)
      const pmn = mn, pmx = mx
      mn = new Float32Array(len)
      mx = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        let lo = Infinity, hi = -Infinity
        const end = Math.min(n, (i + 1) * FANOUT)
        for (let j = i * FANOUT; j < end; j++) {
          if (pmn[j] < lo) lo = pmn[j]
          if (pmx[j] > hi) hi = pmx[j]
        }
        mn[i] = lo
        mx[i] = hi
      }
      this.mins.push(mn)
      this.maxs.push(mx)
      n = len
    }
  }

  /** min/max của data[a..b) — ghi vào out[0], out[1]. Trả về false nếu đoạn rỗng. */
  query(a: number, b: number, out: [number, number]): boolean {
    a = Math.max(0, a | 0)
    b = Math.min(this.length, b | 0)
    if (b <= a) return false
    this.lo = Infinity
    this.hi = -Infinity
    let level = 0 // 0 = dữ liệu gốc, k = mins[k-1]
    const top = this.mins.length
    for (;;) {
      const scanAll = level === top || b - a < 2 * FANOUT
      const na = scanAll ? b : Math.ceil(a / FANOUT) * FANOUT
      const nb = scanAll ? b : Math.floor(b / FANOUT) * FANOUT
      if (!scanAll && na >= nb) {
        // không có block nào nằm trọn — quét hết ở tầng hiện tại
        this.scan(level, a, b)
        break
      }
      this.scan(level, a, na)
      if (scanAll) break
      this.scan(level, nb, b)
      a = na / FANOUT
      b = nb / FANOUT
      level++
    }
    out[0] = this.lo
    out[1] = this.hi
    return this.lo <= this.hi
  }

  // biến tạm, tránh cấp phát mảng trong vòng lặp nóng
  private lo = Infinity
  private hi = -Infinity

  private scan(level: number, a: number, b: number) {
    let lo = this.lo, hi = this.hi
    if (level === 0) {
      const d = this.data
      for (let i = a; i < b; i++) {
        const v = d[i]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    } else {
      const mn = this.mins[level - 1], mx = this.maxs[level - 1]
      for (let i = a; i < b; i++) {
        if (mn[i] < lo) lo = mn[i]
        if (mx[i] > hi) hi = mx[i]
      }
    }
    this.lo = lo
    this.hi = hi
  }
}
