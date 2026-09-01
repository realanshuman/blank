//! Native shell for Blank.
//!
//! Deliberately thin: the shell owns windows, the filesystem and OS
//! integration, and nothing else. All feature logic lives in the web layer so
//! it stays testable without a native toolchain, and so the browser and native
//! builds cannot drift apart. The menu below is the same bargain: it decides
//! what appears, and the web layer decides what any of it does.

#[cfg(desktop)]
mod menu;

use tauri::Emitter;

/// Files opened from Finder arrive here. Namespaced like the menu event.
#[cfg(target_os = "macos")]
const OPEN_EVENT: &str = "blank://open";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init());

    // Desktop-only plugins. `persisted-scope` must be registered BEFORE the fs
    // plugin so the saved folder grants are restored before anything reads.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_persisted_scope::init())
            .plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder = builder.plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    {
        builder = builder
            .setup(|app| {
                let handle = app.handle();
                app.set_menu(menu::build(handle)?)?;
                Ok(())
            })
            // The menu only names an intent. What it means is the web layer's
            // business, exactly as it is for the bar and the palette.
            .on_menu_event(|app, event| {
                let _ = app.emit(menu::MENU_EVENT, event.id().0.as_str());
            });
    }

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building Blank");

    app.run(|_app_handle, _event| {
        // Double-clicking a .md in Finder, or dropping one on the Dock icon,
        // arrives as Opened rather than as a launch argument. Handing the paths
        // to the web layer keeps the reading and the storage rules in one
        // place; the shell only says that it happened.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            if !paths.is_empty() {
                let _ = _app_handle.emit(OPEN_EVENT, paths);
            }
        }
    });
}
