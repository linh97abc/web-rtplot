# rtplot — thư viện plot kiểu ScottPlot cho web (demo Vite + Vue 3)

```bash
npm install
npm run dev
```

## Cấu trúc

| File | Vai trò |
|---|---|
| `src/rtplot/Plot.ts` | Plot Canvas 2D: trục, lưới, pan/zoom, auto-scale, chế độ streaming (follow), xử lý resize/HiDPI |
| `src/rtplot/series.ts` | `SignalSeries` (tĩnh, đều hoặc XY không đều), `StreamSeries` (ring buffer realtime) |
| `src/rtplot/MinMaxPyramid.ts` | Cây min/max nhiều tầng → truy vấn min/max một đoạn trong O(log n) |
| `src/rtplot/LinkGroup.ts` | Liên kết nhiều plot để zoom/pan đồng thời (trục X và/hoặc Y) |
| `src/components/PlotView.vue` | Vỏ Vue: legend ẩn/hiện tín hiệu, nút Auto, thống kê |
| `src/demos/*` | Demo streaming và dữ liệu tĩnh |

`src/rtplot` không phụ thuộc Vue, có thể chép sang React/Svelte/JS thuần.

## Dùng nhanh

```ts
import { Plot, SignalSeries, StreamSeries, LinkGroup } from './rtplot'

// tĩnh, hàng triệu điểm
const p1 = new Plot(div1, { title: 'Tĩnh' })
p1.add(new SignalSeries({ name: 'A', ys: float32Array, sampleRate: 1000 }))
p1.add(new SignalSeries({ name: 'XY', xs: sortedXs, ys }))

// streaming
const p2 = new Plot(div2, { followWindow: 5 })        // cửa sổ 5 giây bám dữ liệu mới
const s = p2.add(new StreamSeries({ name: 'ch1', capacity: 600_000, sampleRate: 10_000 }))
s.push(chunk)                                            // tự vẽ lại ở khung hình kế tiếp

// liên kết
const link = new LinkGroup()
link.add(p1, { x: true })
link.add(p2, { x: true })

s.visible = false                                        // ẩn/hiện
```

## Chuột

- Lăn: zoom X (streaming: đổi độ rộng cửa sổ) · Shift+lăn: zoom Y · Ctrl+lăn: zoom cả hai
- Lăn trên trục X/Y: chỉ zoom trục đó
- Kéo trái: pan · Kéo phải: zoom liên tục · Alt+kéo / kéo chuột giữa: zoom vùng chọn
- Double-click: auto-scale (streaming: bám lại dữ liệu mới); double-click trên trục: chỉ trục đó
