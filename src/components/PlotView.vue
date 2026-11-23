<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch, markRaw } from 'vue'
import { Plot, darkTheme, lightTheme, type LinkGroup, type Series, type LinkAxes } from '../rtplot'

const props = withDefaults(
  defineProps<{
    series: Series[]
    title?: string
    xLabel?: string
    yLabel?: string
    /** > 0: chế độ streaming, trục X bám theo dữ liệu mới nhất */
    followWindow?: number
    dark?: boolean
    link?: LinkGroup
    linkAxes?: LinkAxes
  }>(),
  { title: '', xLabel: '', yLabel: '', followWindow: 0, dark: false },
)

const host = ref<HTMLDivElement>()
const plot = shallowRef<Plot>()
// bản sao trạng thái ẩn/hiện để legend phản ứng (series gốc không reactive để giữ hiệu năng)
const visible = ref<boolean[]>([])
const stats = ref({ renderMs: 0, drawnPoints: 0, totalPoints: 0 })

function sync(list: Series[]) {
  const p = plot.value
  if (!p) return
  for (const s of [...p.series]) if (!list.includes(s)) p.remove(s)
  let added = false
  for (const s of list) {
    if (!p.series.includes(s)) {
      p.add(markRaw(s))
      added = true
    }
  }
  if (added) p.autoScale()
  visible.value = list.map((s) => s.visible)
}

function toggle(i: number) {
  const s = props.series[i]
  s.visible = !s.visible
  visible.value[i] = s.visible
}

let statTimer = 0
onMounted(() => {
  const p = markRaw(
    new Plot(host.value!, {
      title: props.title,
      xLabel: props.xLabel,
      yLabel: props.yLabel,
      followWindow: props.followWindow,
      theme: props.dark ? darkTheme : lightTheme,
    }),
  )
  plot.value = p
  sync(props.series)
  props.link?.add(p, props.linkAxes)
  // cập nhật thống kê tối đa 4 lần/giây để không làm Vue re-render mỗi khung hình
  statTimer = window.setInterval(() => (stats.value = { ...p.stats }), 250)
})

watch(() => [...props.series], sync)
watch(
  () => props.dark,
  (d) => {
    if (!plot.value) return
    plot.value.theme = d ? darkTheme : lightTheme
    plot.value.invalidate()
  },
)

onBeforeUnmount(() => {
  clearInterval(statTimer)
  if (plot.value) {
    props.link?.remove(plot.value)
    plot.value.destroy()
  }
})

defineExpose({ plot })

const fmt = (n: number) => n.toLocaleString('en-US')
</script>

<template>
  <div class="plot-view" :class="{ dark }">
    <div class="legend">
      <button
        v-for="(s, i) in series"
        :key="i"
        class="item"
        :class="{ off: !visible[i] }"
        :title="visible[i] ? 'Ẩn tín hiệu' : 'Hiện tín hiệu'"
        @click="toggle(i)"
      >
        <span class="swatch" :style="{ background: s.color }" />
        {{ s.name }}
      </button>
      <span class="spacer" />
      <button class="item" title="Auto-scale (double-click)" @click="plot?.autoScale()">⤢ Auto</button>
      <span class="stats">
        {{ fmt(stats.drawnPoints) }} / {{ fmt(stats.totalPoints) }} điểm · {{ stats.renderMs.toFixed(1) }} ms
      </span>
    </div>
    <div ref="host" class="host" />
  </div>
</template>

<style scoped>
.plot-view {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid #ddd;
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
}
.plot-view.dark {
  border-color: #333;
  background: #1e1e22;
  color: #c8c8d0;
}
.legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  font-size: 12px;
}
.item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.item:hover {
  border-color: #8884;
}
.item.off {
  opacity: 0.4;
  text-decoration: line-through;
}
.swatch {
  width: 14px;
  height: 3px;
  border-radius: 2px;
}
.spacer {
  flex: 1;
}
.stats {
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
.host {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
</style>
