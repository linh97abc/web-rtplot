import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// Khi chạy trên thiết bị di động qua Tauri, CLI truyền địa chỉ dev server qua biến này
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // giữ log lỗi Rust của Tauri trên terminal
  clearScreen: false,
  server: {
    port: 5173,
    // Tauri trỏ cứng vào cổng 5173 (devUrl), nên báo lỗi thay vì tự đổi cổng
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 5174 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
})
