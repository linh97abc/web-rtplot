<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import StreamDemo from './demos/StreamDemo.vue'
import StaticDemo from './demos/StaticDemo.vue'

const tab = ref<'stream' | 'static'>('stream')
const dark = ref(false)
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
      <label class="theme"><input v-model="dark" type="checkbox" /> Giao diện tối</label>
    </header>
    <main>
      <!-- KeepAlive: chuyển tab không mất dữ liệu đã tạo -->
      <KeepAlive>
        <StreamDemo v-if="tab === 'stream'" :dark="dark" />
        <StaticDemo v-else :dark="dark" />
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
main { flex: 1; min-height: 0; padding: 12px 16px; }
</style>
