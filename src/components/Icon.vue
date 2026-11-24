<script setup lang="ts">
/**
 * Icon SVG inline, thay cho ký tự Unicode (⏸ ▶ ↻ ⤢): những ký tự đó thường không có trong font chính
 * nên mỗi trình duyệt lấy từ một font dự phòng khác nhau (emoji màu, nét đơn, hoặc ô vuông).
 */
defineProps<{ name: 'play' | 'pause' | 'refresh' | 'fit' }>()
</script>

<template>
  <svg
    class="icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path v-if="name === 'play'" d="M7 4.5v15l12-7.5z" fill="currentColor" />
    <path v-else-if="name === 'pause'" d="M7 4.5h3v15H7zM14 4.5h3v15h-3z" fill="currentColor" />
    <template v-else-if="name === 'refresh'">
      <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" />
      <path d="M20 3.5v5h-5" />
    </template>
    <path v-else d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
  width: 1.1em;
  height: 1.1em;
}
</style>
