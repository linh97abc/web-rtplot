//! Backend Rust cho demo rtplot.
//!
//! Mô phỏng một thiết bị thu dữ liệu: một luồng nền sinh 5 kênh tín hiệu ở tần số lấy mẫu cho trước
//! và đẩy sang giao diện qua `tauri::ipc::Channel` dưới dạng byte thô (f32 little-endian).
//! Truyền nhị phân tránh được chi phí JSON, nên vài trăm nghìn mẫu/giây vẫn nhẹ.
//!
//! Bố cục mỗi gói: `n` mẫu của kênh 0, rồi `n` mẫu của kênh 1, ... (tổng `n * CHANNELS` số f32).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, Response};
use tauri::State;

const CHANNELS: usize = 5;

/// Cờ dừng của luồng đang chạy (nếu có)
#[derive(Default)]
struct StreamState(Mutex<Option<Arc<AtomicBool>>>);

impl StreamState {
    fn stop_current(&self) {
        if let Some(stop) = self.0.lock().unwrap().take() {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

/// Bắt đầu stream. `start_index` = chỉ số mẫu bắt đầu, để tiếp tục liền mạch sau khi tạm dừng.
#[tauri::command]
fn start_stream(sample_rate: u32, start_index: u64, on_data: Channel<Response>, state: State<'_, StreamState>) {
    state.stop_current();
    let stop = Arc::new(AtomicBool::new(false));
    *state.0.lock().unwrap() = Some(stop.clone());
    let sr = sample_rate.max(1) as f64;
    std::thread::spawn(move || generate(sr, start_index, on_data, stop));
}

#[tauri::command]
fn stop_stream(state: State<'_, StreamState>) {
    state.stop_current();
}

/// Bộ sinh số ngẫu nhiên xorshift — đủ cho nhiễu giả lập, không cần thêm crate
struct XorShift(u64);
impl XorShift {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn generate(sr: f64, start_index: u64, ch: Channel<Response>, stop: Arc<AtomicBool>) {
    use std::f64::consts::TAU;
    let t0 = Instant::now();
    let mut produced = start_index;
    let mut rng = XorShift(0x9E37_79B9_7F4A_7C15);
    let mut walk = 0.0f64;
    let mut data: Vec<f32> = Vec::new();

    while !stop.load(Ordering::Relaxed) {
        let due = start_index + (t0.elapsed().as_secs_f64() * sr) as u64;
        let n = (due.saturating_sub(produced)).min(sr as u64) as usize; // tối đa 1 giây/gói
        if n > 0 {
            data.clear();
            data.resize(n * CHANNELS, 0.0);
            for i in 0..n {
                let t = (produced + i as u64) as f64 / sr;
                let ft = t % 4.0;
                walk = (walk + (rng.next() - 0.5) * 0.05) * 0.9999;
                data[i] = ((TAU * 3.0 * t).sin() + (rng.next() - 0.5) * 0.4) as f32;
                data[n + i] = (0.6 * (TAU * 7.0 * t).sin()) as f32;
                data[2 * n + i] = if t % 1.0 < 0.5 { 0.8 } else { -0.8 };
                data[3 * n + i] = (TAU * (1.0 + 10.0 * ft) * ft).sin() as f32;
                data[4 * n + i] = walk as f32;
            }
            let bytes: Vec<u8> = data.iter().flat_map(|v| v.to_le_bytes()).collect();
            if ch.send(Response::new(bytes)).is_err() {
                break; // cửa sổ đã đóng / channel bị huỷ
            }
            produced += n as u64;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(StreamState::default())
        .invoke_handler(tauri::generate_handler![start_stream, stop_stream])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
