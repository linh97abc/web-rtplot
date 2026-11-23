import { Channel, invoke, isTauri } from '@tauri-apps/api/core'

/** true khi trang đang chạy bên trong app Tauri (không phải trình duyệt thường) */
export const inTauri = isTauri()

const CHANNELS = 5
let token = 0

/**
 * Nhận dữ liệu từ backend Rust (src-tauri/src/lib.rs) qua Tauri Channel.
 * Mỗi gói là byte thô: n mẫu kênh 0, n mẫu kênh 1, ... (f32 little-endian).
 * `onChunk` nhận mảng 5 kênh (subarray, không copy) và số mẫu mỗi kênh.
 */
export async function startRustStream(sampleRate: number, startIndex: number, onChunk: (channels: Float32Array[], n: number) => void) {
  const my = ++token
  const ch = new Channel<ArrayBuffer | number[]>((msg) => {
    if (my !== token) return // gói đến muộn từ lần chạy trước
    const buf = msg instanceof ArrayBuffer ? msg : new Uint8Array(msg).buffer
    const all = new Float32Array(buf)
    const n = all.length / CHANNELS
    const chans: Float32Array[] = []
    for (let k = 0; k < CHANNELS; k++) chans.push(all.subarray(k * n, (k + 1) * n))
    onChunk(chans, n)
  })
  await invoke('start_stream', { sampleRate, startIndex, onData: ch })
}

export async function stopRustStream() {
  token++
  await invoke('stop_stream')
}
