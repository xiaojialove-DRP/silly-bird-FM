#[tauri::command]
fn start_drag(window: tauri::WebviewWindow) -> Result<(), String> {
  eprintln!("[start_drag] command reached, calling start_dragging()");
  let result = window.start_dragging();
  eprintln!("[start_drag] result: {:?}", result);
  result.map_err(|e| e.to_string())
}

#[tauri::command]
fn debug_log(msg: String) {
  eprintln!("[frontend] {}", msg);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![start_drag, debug_log])
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
    .expect("error while running tauri application");
}
