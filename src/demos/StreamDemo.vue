<script setup lang="ts">
import { markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlotView from '../components/PlotView.vue'
import { LinkGroup, StreamSeries, type RendererKind } from '../rtplot'

const props = defineProps<{ dark: boolean; renderer: RendererKind }>()

const sampleRate = ref(10_000)
const running = ref(true)
const linked = ref(true)
const windowSec = 5

// ---- tạo series (không reactive) ----
function makeSeries(sr: number) {
  const cap = sr * 60 // giữ 60 giây gần nhất
  const mk = (name: string, color: string) => markRaw(new StreamSeries({ name, color, capacity: cap, sampleRate: sr }))
  return {
    top: [mk('sin 3 Hz + nhiễu', '#1f77b4'), mk('sin 7 Hz', '#ff7f0e'), mk('xung vuông 1 Hz', '#2ca02c')],
    bottom: [mk('chirp', '#d62728'), mk('random walk', '#9467bd')],
  }
}
const series = ref(makeSeries(sampleRate.value))

// ---- bộ phát dữ liệu giả lập ----
let t0 = performance.now()
let produced = 0
let walk = 0
let timer = 0
const rate = ref(0)

function generate() {
  if (!running.value) return
  const sr = sampleRate.value
  const due = Math.floor(((performance.now() - t0) / 1000) * sr)
  const n = Math.min(due - produced, sr) // tối đa 1 giây/lần
  if (n <= 0) return
  const a = new Float32Array(n), b = new Float32Array(n), c = new Float32Array(n)
  const d = new Float32Array(n), e = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = (produced + i) / sr
    a[i] = Math.sin(2 * Math.PI * 3 * t) + (Math.random() - 0.5) * 0.4
    b[i] = 0.6 * Math.sin(2 * Math.PI * 7 * t)
    c[i] = (t % 1) < 0.5 ? 0.8 : -0.8
    const ft = t % 4
    d[i] = Math.sin(2 * Math.PI * (1 + 10 * ft) * ft)
    walk += (Math.random() - 0.5) * 0.05
    walk *= 0.9999
    e[i] = walk
  }
  produced += n
  const s = series.value
  s.top[0].push(a); s.top[1].push(b); s.top[2].push(c)
  s.bottom[0].push(d); s.bottom[1].push(e)
}

function resetGenerator() {
  t0 = performance.now()
  produced = 0
  walk = 0
}

watch(running, (r) => {
  // tiếp tục từ chỗ dừng (không nhảy cóc thời gian)
  if (r) t0 = performance.now() - (produced / sampleRate.value) * 1000
})
watch(sampleRate, async (sr) => {
  series.value = makeSeries(sr)
  resetGenerator()
  await nextTick() // chờ PlotView được tạo lại rồi liên kết lại
  applyLink()
})

let lastProduced = 0
let rateTimer = 0
onMounted(() => {
  timer = window.setInterval(generate, 10)
  rateTimer = window.setInterval(() => {
    rate.value = (produced - lastProduced) * 5 * 5 // 5 kênh, 5 lần/giây
    lastProduced = produced
  }, 200)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  clearInterval(rateTimer)
})

// ---- liên kết trục X ----
const link = new LinkGroup()
const topView = ref<InstanceType<typeof PlotView>>()
const bottomView = ref<InstanceType<typeof PlotView>>()
function applyLink() {
  link.clear()
  if (!linked.value) return
  const a = topView.value?.plot, b = bottomView.value?.plot
  if (a) link.add(a, { x: true })
  if (b) link.add(b, { x: true })
}
onMounted(applyLink)
watch(() => props.renderer, async () => {
  await nextTick() // PlotView được tạo lại với backend mới → liên kết lại
  applyLink()
})
watch(linked, applyLink)
</script>

<template>
  <div class="demo">
    <div class="toolbar">
      <button @click="running = !running">{{ running ? '⏸ Tạm dừng' : '▶ Chạy' }}</button>
      <label>
        Tần số lấy mẫu
        <select v-model.number="sampleRate">
          <option :value="1000">1 kHz</option>
          <option :value="10000">10 kHz</option>
          <option :value="50000">50 kHz</option>
          <option :value="200000">200 kHz</option>
        </select>
      </label>
      <label><input v-model="linked" type="checkbox" /> Liên kết trục X</label>
      <span class="muted">{{ rate.toLocaleString('en-US') }} mẫu/giây (5 kênh)</span>
    </div>
    <p class="hint">
      Lăn chuột: đổi độ rộng cửa sổ thời gian · <b>Shift + lăn</b> hoặc lăn trên trục Y: zoom dọc (vẫn đang chạy) ·
      Kéo trái: pan (kéo ngang sẽ dừng bám, kéo dọc thì không) · Double-click: auto-scale và bám lại
    </p>
    <div class="plots">
      <PlotView
        ref="topView"
        :key="'t' + sampleRate + renderer"
        :renderer="renderer"
        :series="series.top"
        :follow-window="windowSec"
        :dark="dark"
        title="Kênh 1–3"
        x-label="Thời gian (s)"
        y-label="Biên độ"
      />
      <PlotView
        ref="bottomView"
        :key="'b' + sampleRate + renderer"
        :renderer="renderer"
        :series="series.bottom"
        :follow-window="windowSec"
        :dark="dark"
        title="Kênh 4–5"
        x-label="Thời gian (s)"
      />
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
  grid-template-rows: 1fr 1fr;
  gap: 8px;
}
</style>
