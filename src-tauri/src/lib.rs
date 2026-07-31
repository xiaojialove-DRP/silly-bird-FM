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
          apply_native_window_tweaks(&window);

          // wry rebuilds the native titlebar again shortly after setup()
          // returns (confirmed by reading the titlebar view's alpha back at
          // several delays: our setup()-time change was gone by the next
          // read), so a single application doesn't survive startup even
          // before any focus/resize event fires. Re-apply a few times over
          // the first seconds to land after that rebuild.
          {
            let w = window.clone();
            let handle = app.handle().clone();
            std::thread::spawn(move || {
              for delay_ms in [500u64, 1500, 3000, 6000] {
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                let w = w.clone();
                let _ = handle.run_on_main_thread(move || apply_native_window_tweaks(&w));
              }
            });
          }

          let w = window.clone();
          let handle = app.handle().clone();
          window.on_window_event(move |event| {
            // Same rebuild also happens on focus/resize - re-apply there
            // too, deferred via run_on_main_thread since applying inline
            // within the event callback still loses to whatever runs right
            // after it in the same tick.
            if matches!(
              event,
              tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_)
            ) {
              let w = w.clone();
              let _ = handle.run_on_main_thread(move || apply_native_window_tweaks(&w));
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
// dragging working - decorations:false broke dragging entirely.
//
// What remains of the native chrome is removed here, and every mechanism was
// chosen the hard way:
//
// - .closable/.miniaturizable are stripped from the styleMask, so those two
//   buttons are dead wiring (clicking does nothing, verified). Hiding their
//   views instead flaked: AppKit re-shows titlebar subviews on its own
//   layout passes, without any window event we could hook.
//
// - The titlebar strip (an opaque NSVisualEffectView backdrop inside
//   NSTitlebarContainerView) is faded out with alphaValue = 0 rather than
//   setHidden(true): AppKit's titlebar layout resets `hidden` on its own but
//   leaves alphaValue alone (confirmed by reading it back at several delays
//   after launch - it stuck at 0 while a parallel setHidden(true) test read
//   back false). Crucially an alpha-0 view still hit-tests, so the invisible
//   strip still drags the window natively - no IPC, no drag-region wiring.
//
// - setStyleMask(fullSizeContentView) was tried for this instead and
//   reverted: it made the page render blank (webview layout broke), and the
//   webview's private auto-content-inset banner painted its own white strip
//   anyway. Normal titlebar geometry + invisible strip avoids all of that.
//
// - The zoom button stays wired (tied to .resizable) but is disabled, since
//   an invisible-yet-clickable fullscreen trigger is a trap.
#[cfg(target_os = "macos")]
fn apply_native_window_tweaks(window: &tauri::WebviewWindow) {
  use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowStyleMask};

  let Ok(ns_window_ptr) = window.ns_window() else { return };
  if ns_window_ptr.is_null() {
    return;
  }
  unsafe {
    let ns_window: &NSWindow = &*(ns_window_ptr as *const NSWindow);
    let current = ns_window.styleMask();
    ns_window.setStyleMask(current & !(NSWindowStyleMask::Closable | NSWindowStyleMask::Miniaturizable));
    ns_window.setTitlebarAppearsTransparent(true);
    if let Some(zoom) = ns_window.standardWindowButton(NSWindowButton::ZoomButton) {
      zoom.setEnabled(false);
    }
    if let Some(theme_frame) = ns_window.contentView().and_then(|v| v.superview()) {
      fade_out_subview_by_class(&theme_frame, "NSTitlebarContainerView");
    }
  }
}

#[cfg(target_os = "macos")]
fn fade_out_subview_by_class(view: &objc2_app_kit::NSView, class_name: &str) -> bool {
  for sub in view.subviews().iter() {
    // KVO observation swaps an object's class for a dynamically-created
    // "NSKVONotifying_<original>" subclass at runtime, so an exact-name
    // match misses observed views - substring match instead.
    if sub.class().name().to_str().is_ok_and(|n| n.contains(class_name)) {
      sub.setAlphaValue(0.0);
      return true;
    }
    if fade_out_subview_by_class(&sub, class_name) {
      return true;
    }
  }
  false
}
