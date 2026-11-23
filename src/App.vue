<script setup lang="ts">
import { ref, watch, watchEffect } from 'vue'
import type { RendererKind } from './rtplot'
import StreamDemo from './demos/StreamDemo.vue'
import StaticDemo from './demos/StaticDemo.vue'

const tab = ref<'stream' | 'static'>('stream')
const dark = ref(false)
// chọn backend vẽ; có thể đặt sẵn qua URL: ?renderer=canvas2d
const renderer = ref<RendererKind>(new URLSearchParams(location.search).get('renderer') === 'canvas2d' ? 'canvas2d' : 'webgl')
watch(renderer, (r) => {
  const u = new URL(location.href)
  u.searchParams.set('renderer', r)
  history.replaceState(null, '', u)
})
watchEffect(() => document.body.classList.toggle('dark', dark.value))
</script>

<template>
  <div class="app">
    <header>
      <strong>rtplot</strong>
      <nav>
        <button :class="{ active: tab === 'stream' }" @click="tab = 'stream'">Streaming realtime</button>
        <button :class="{ active: tab === 'static' }" @click="tab = 'static'">Dữ liệu tĩnh hàng triệu điểm</button>
      </nav>
      <label class="theme">
        Vẽ bằng
        <select v-model="renderer">
          <option value="webgl">WebGL</option>
          <option value="canvas2d">Canvas 2D</option>
        </select>
      </label>
      <label class="theme-dark"><input v-model="dark" type="checkbox" /> Giao diện tối</label>
    </header>
    <main>
      <!-- KeepAlive: chuyển tab không mất dữ liệu đã tạo -->
      <KeepAlive>
        <StreamDemo v-if="tab === 'stream'" :dark="dark" :renderer="renderer" />
        <StaticDemo v-else :dark="dark" :renderer="renderer" />
      </KeepAlive>
    </main>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }
header { display: flex; align-items: center; gap: 16px; padding: 8px 16px; border-bottom: 1px solid #8883; }
nav { display: flex; gap: 4px; }
nav button.active { background: #1f77b4; border-color: #1f77b4; color: #fff; }
.theme { margin-left: auto; display: inline-flex; gap: 6px; align-items: center; }
.theme-dark { display: inline-flex; gap: 6px; align-items: center; }
main { flex: 1; min-height: 0; padding: 12px 16px; }
</style>
