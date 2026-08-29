//! Native shell for Blank.
//!
//! Deliberately thin: the shell owns windows, the filesystem and OS
//! integration, and nothing else. All feature logic lives in the web layer so
//! it stays testable without a native toolchain, and so the browser and native
//! builds cannot drift apart.

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

    builder
        .run(tauri::generate_context!())
        .expect("error while running Blank");
}
