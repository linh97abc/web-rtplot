import { createApp } from 'vue'
// font đóng gói cùng app (không phụ thuộc font hệ thống) → chữ giống nhau trên Chrome, Firefox, WebKitGTK
import '@fontsource-variable/inter'
import './style.css'
import App from './App.vue'

createApp(App).mount('#app')
