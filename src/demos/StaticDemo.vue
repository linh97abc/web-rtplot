<script setup lang="ts">
import { markRaw, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import PlotView from '../components/PlotView.vue'
import Icon from '../components/Icon.vue'
import { LinkGroup, SignalSeries, type Series, type RendererKind } from '../rtplot'

const props = defineProps<{ dark: boolean; renderer: RendererKind }>()

const pointsPerSeries = ref(1_000_000)
const linkX = ref(true)
const linkY = ref(false)
const busy = ref(false)
const buildInfo = ref('')

const SR = 1000 // 1 kHz → 5 triệu điểm ≈ 83 phút dữ liệu

// bộ sinh số ngẫu nhiên có seed để dữ liệu lặp lại được
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

/** Tín hiệu có chi tiết ở nhiều thang thời gian: xu hướng chậm + dao động + nhiễu + gai hiếm */
function makeSignal(n: number, seed: number, freqs: number[]) {
  const r = rng(seed)
  const y = new Float32Array(n)
  // dao động sin bằng phép quay (nhanh hơn gọi Math.sin hàng chục triệu lần)
  const m = freqs.length
  const c = new Float64Array(m), s = new Float64Array(m), cs = new Float64Array(m), sn = new Float64Array(m)
  for (let k = 0; k < m; k++) {
    const w = (2 * Math.PI * freqs[k]) / SR
    cs[k] = Math.cos(w); sn[k] = Math.sin(w)
    c[k] = Math.cos(k); s[k] = Math.sin(k)
  }
  let drift = 0
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let k = 0; k < m; k++) {
      v += s[k] / (k + 1)
      const nc = c[k] * cs[k] - s[k] * sn[k]
      s[k] = s[k] * cs[k] + c[k] * sn[k]
      c[k] = nc
    }
    drift += (r() - 0.5) * 0.01
    v += drift + (r() - 0.5) * 0.3
    if (r() < 2e-6) v += (r() - 0.5) * 12 // gai hiếm — chỉ thấy rõ khi zoom
    y[i] = v
  }
  return y
}

const top = shallowRef<Series[]>([])
const middle = shallowRef<Series[]>([])
const bottom = shallowRef<Series[]>([])

async function build() {
  busy.value = true
  buildInfo.value = ''
  top.value = middle.value = bottom.value = []
  await nextTick()
  await new Promise((r) => setTimeout(r, 30)) // cho UI kịp hiện "Đang tạo..."
  const n = pointsPerSeries.value
  const t0 = performance.now()

  const sig = (name: string, color: string, seed: number, freqs: number[]) =>
    markRaw(new SignalSeries({ name, color, ys: makeSignal(n, seed, freqs), sampleRate: SR }))

  top.value = [
    sig('Cảm biến A', '#1f77b4', 1, [0.01, 0.5, 13]),
    sig('Cảm biến B', '#ff7f0e', 2, [0.003, 1.7, 50]),
    sig('Cảm biến C', '#2ca02c', 3, [0.02, 0.2, 7]),
  ]
  middle.value = [
    sig('Dòng điện', '#d62728', 4, [0.005, 2, 60]),
    sig('Điện áp', '#9467bd', 5, [0.001, 0.05, 120]),
  ]

  // SignalXY: lấy mẫu không đều (x tăng dần nhưng bước ngẫu nhiên)
  const nXY = Math.floor(n / 2)
  const xs = new Float64Array(nXY)
  const r = rng(9)
  let x = 0
  for (let i = 0; i < nXY; i++) {
    x += (0.5 + r() * 3) / SR
    xs[i] = x
  }
  const ys = makeSignal(nXY, 6, [0.004, 0.3, 9])
  bottom.value = [markRaw(new SignalSeries({ name: 'Lấy mẫu không đều (XY)', color: '#17becf', xs, ys }))]

  const total = n * 5 + nXY
  buildInfo.value = `Đã tạo ${total.toLocaleString('en-US')} điểm trong ${((performance.now() - t0) / 1000).toFixed(2)} s`
  busy.value = false
  await nextTick()
  applyLink()
}

// ---- liên kết ----
const link = new LinkGroup()
const v1 = ref<InstanceType<typeof PlotView>>()
const v2 = ref<InstanceType<typeof PlotView>>()
const v3 = ref<InstanceType<typeof PlotView>>()
function applyLink() {
  link.clear()
  for (const v of [v1.value, v2.value, v3.value]) {
    if (v?.plot && (linkX.value || linkY.value)) link.add(v.plot, { x: linkX.value, y: linkY.value })
  }
}
watch([linkX, linkY], applyLink)
watch(() => props.renderer, async () => {
  await nextTick()
  applyLink()
})

onMounted(build)
</script>

<template>
  <div class="demo">
    <div class="toolbar">
      <label>
        Số điểm mỗi tín hiệu
        <select v-model.number="pointsPerSeries" :disabled="busy">
          <option :value="100_000">100 nghìn</option>
          <option :value="1_000_000">1 triệu</option>
          <option :value="5_000_000">5 triệu</option>
          <option :value="10_000_000">10 triệu</option>
        </select>
      </label>
      <button :disabled="busy" @click="build"><Icon name="refresh" /> Tạo lại dữ liệu</button>
      <label><input v-model="linkX" type="checkbox" /> Liên kết trục X</label>
      <label><input v-model="linkY" type="checkbox" /> Liên kết trục Y</label>
      <span class="muted">{{ busy ? 'Đang tạo dữ liệu…' : buildInfo }}</span>
    </div>
    <p class="hint">
      Lăn chuột: zoom X · Shift + lăn: zoom Y · Ctrl + lăn: zoom cả hai · Kéo trái: pan · Kéo phải: zoom ·
      Alt + kéo / kéo chuột giữa: zoom vùng chọn · Double-click: auto-scale · Click tên tín hiệu để ẩn/hiện
    </p>
    <div class="plots">
      <PlotView ref="v1" :key="'1' + renderer" :renderer="renderer" :series="top" :dark="dark" title="3 tín hiệu trên 1 plot" y-label="Giá trị" />
      <PlotView ref="v2" :key="'2' + renderer" :renderer="renderer" :series="middle" :dark="dark" title="2 tín hiệu" />
      <PlotView ref="v3" :key="'3' + renderer" :renderer="renderer" :series="bottom" :dark="dark" title="SignalXY" x-label="Thời gian (s)" />
    </div>
  </div>
</template>

<style scoped>
.demo {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 8px;
}
.plots {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: 1.3fr 1fr 1fr;
  gap: 8px;
}
</style>
