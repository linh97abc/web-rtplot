# rtplot — thư viện plot kiểu ScottPlot cho web (demo Vite + Vue 3)

```bash
npm install
npm run dev
```

## Cấu trúc

| File | Vai trò |
|---|---|
| `src/rtplot/Plot.ts` | Plot: trục, lưới, pan/zoom, auto-scale, chế độ streaming (follow, cuộn mượt), xử lý resize/HiDPI |
| `src/rtplot/render/` | Backend vẽ: `WebGLRenderer` (mặc định), `Canvas2DRenderer` (dự phòng); `TextLayer` vẽ chữ bằng HTML |
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
const p1 = new Plot(div1, { title: 'Tĩnh' })            // renderer: 'webgl' (mặc định) | 'canvas2d'
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

## Renderer

- Mặc định vẽ bằng **WebGL**, tự lùi về Canvas 2D nếu trình duyệt không hỗ trợ. Chọn thủ công bằng
  `new Plot(el, { renderer: 'canvas2d' })`; demo có ô chọn ở góc phải (hoặc `?renderer=canvas2d`).
- Chữ (nhãn trục, tiêu đề, toạ độ con trỏ) là phần tử HTML đặt chồng lên canvas.

## Lưu ý Firefox trên Linux

Nếu Firefox hiện fps cao hơn tần số quét màn hình (ví dụ 155 fps trên màn 60 Hz) và hình bị rung/xé
khi streaming thì Firefox đang không đồng bộ vsync — không phải lỗi của thư viện. Trong `about:config`:
đặt `layout.frame_rate` = tần số quét màn hình; nếu vẫn bị, bật `gfx.webrender.all` (X11: thêm
`gfx.x11-egl.force-enabled`) rồi khởi động lại.

## Chạy dưới dạng app desktop (Tauri)

Nhánh `tauri` bọc demo thành app desktop bằng [Tauri 2](https://v2.tauri.app). Tab streaming có thêm
nguồn dữ liệu **Rust (Tauri)**: một luồng Rust (`src-tauri/src/lib.rs`) sinh 5 kênh tín hiệu và đẩy
sang giao diện qua `tauri::ipc::Channel` dưới dạng byte `f32` thô (không qua JSON) — giống cách một app
thu dữ liệu thật đọc thiết bị ở Rust rồi vẽ bằng rtplot.

Cần cài [Rust](https://rustup.rs) và thư viện hệ thống theo
[hướng dẫn của Tauri](https://v2.tauri.app/start/prerequisites/) (Windows: WebView2 + MSVC Build Tools;
macOS: Xcode Command Line Tools; Ubuntu/Debian:
`sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`).

```bash
npm install
npm run tauri dev      # chạy app ở chế độ phát triển (hot reload)
npm run tauri build    # đóng gói bộ cài trong src-tauri/target/release/bundle/
```

Webview của Tauri: Windows dùng WebView2 (Chromium), macOS dùng WKWebView (Safari), Linux dùng
WebKitGTK — nên trên Linux hiệu năng/độ mượt có thể khác Chrome.
