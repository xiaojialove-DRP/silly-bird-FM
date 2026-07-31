#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      #[cfg(target_os = "macos")]
      {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
          remove_close_and_miniaturize_buttons(&window);
          let w = window.clone();
          let handle = app.handle().clone();
          window.on_window_event(move |event| {
            // Tauri/wry keep touching the native window (applying
            // hiddenTitle/decorations, showing it, etc.) after .setup()
            // returns, and again on focus/resize - each pass appears to
            // recompute and overwrite styleMask with its own default,
            // undoing this. Re-apply on the same event set used for the
            // (separately abandoned) button-hiding attempt, deferred via
            // run_on_main_thread for the same reason: applying inline within
            // the event callback still loses to whatever runs right after it
            // in the same tick.
            if matches!(
              event,
              tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_)
            ) {
              let w = w.clone();
              let _ = handle.run_on_main_thread(move || remove_close_and_miniaturize_buttons(&w));
            }
          });
        }
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// decorations:true + hiddenTitle:true (see DECISIONS.md) keeps native window
// dragging working, at the cost of the traffic-light buttons staying visible -
// decorations:false was tried first and broke dragging entirely, even via a
// direct Rust-side set_position() call.
//
// Hiding the standardWindowButton views (setHidden on the button, and on its
// superview) was tried next and rejected: even routed through
// run_on_main_thread to land after AppKit's own post-focus-change layout
// pass, the buttons kept reappearing on an unpredictable subset of focus
// changes - confirmed flaky across repeated blur/refocus cycles with
// screenshots, not just a one-off timing miss.
//
// This instead removes the .closable/.miniaturizable bits from the window's
// styleMask, which tells AppKit the window no longer has those two
// capabilities at all, rather than fighting an already-managed view's
// visibility after the fact. Confirmed stable across repeated blur/refocus
// cycles (unlike the button-hiding attempt) and confirmed real dragging
// still works via a logged WindowEvent::Moved with a genuine new position,
// not just a screenshot comparison. Both buttons are confirmed non-clickable
// (app stays running / window never miniaturizes) - AppKit still draws a
// dim gray placeholder dot in both slots though, it just doesn't wire them
// to anything. The zoom button is left alone (tied to .resizable, which the
// window needs to keep its real resize behavior).
#[cfg(target_os = "macos")]
fn remove_close_and_miniaturize_buttons(window: &tauri::WebviewWindow) {
  use objc2_app_kit::{NSWindow, NSWindowStyleMask};

  let Ok(ns_window_ptr) = window.ns_window() else { return };
  if ns_window_ptr.is_null() {
    return;
  }
  unsafe {
    let ns_window: &NSWindow = &*(ns_window_ptr as *const NSWindow);
    let current = ns_window.styleMask();
    ns_window.setStyleMask(current & !(NSWindowStyleMask::Closable | NSWindowStyleMask::Miniaturizable));
  }
}
