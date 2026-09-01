//! The macOS menu bar.
//!
//! Every item here dispatches to something the web layer already does. That is
//! deliberate: the menu adds no capability, it puts what exists where a Mac
//! user looks for it. In an app whose premise is that the page stays empty,
//! the menu bar is the only place to put discoverability that costs no pixels.
//!
//! Clicks travel to the frontend as an event rather than being handled here,
//! so the shell stays thin and the behaviour stays testable without a native
//! toolchain, which is the rule the rest of this crate follows.

use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

/// The event the web layer listens for. Namespaced so it cannot collide with
/// anything the plugins emit.
pub const MENU_EVENT: &str = "blank://menu";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accel: Option<&str>| {
        let mut builder = MenuItemBuilder::with_id(id, text);
        if let Some(accel) = accel {
            builder = builder.accelerator(accel);
        }
        builder.build(app)
    };

    // The application menu. Its first item is named for the app by macOS
    // itself, so About and Quit belong here rather than under File.
    let app_menu = SubmenuBuilder::new(app, "Blank")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Blank"),
            Some(AboutMetadata {
                name: Some("Blank".into()),
                version: Some(env!("CARGO_PKG_VERSION").into()),
                comments: Some("A blank canvas for freewriting.".into()),
                ..Default::default()
            }),
        )?)
        .separator()
        .item(&item(
            "choose-folder",
            "Writing Folder…",
            Some("CmdOrCtrl+,"),
        )?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new", "New Entry", Some("CmdOrCtrl+N"))?)
        .separator()
        .item(&item(
            "export-pdf",
            "Export as PDF…",
            Some("CmdOrCtrl+Shift+E"),
        )?)
        .item(&item("export-docx", "Export as Word…", None)?)
        .item(&item("export-md", "Export as Markdown…", None)?)
        .item(&item("export-txt", "Export as Plain Text…", None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // Undo, redo and the clipboard are the predefined items on purpose: they
    // route through the webview's own editing commands, which is what makes
    // them work inside a contenteditable at all.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&item("find", "Find…", Some("CmdOrCtrl+F"))?)
        .build()?;

    let format = SubmenuBuilder::new(app, "Format")
        .item(&item("size-up", "Bigger", Some("CmdOrCtrl+Plus"))?)
        .item(&item("size-down", "Smaller", Some("CmdOrCtrl+-"))?)
        .separator()
        .item(&item("theme", "Next Theme", Some("CmdOrCtrl+Shift+T"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("markdown", "Live Markdown", None)?)
        .item(&item("focus", "Focus", None)?)
        .item(&item("typewriter", "Typewriter Scrolling", None)?)
        .item(&item("hardcore", "Backspace", None)?)
        .separator()
        .item(&item("history", "History", Some("CmdOrCtrl+\\"))?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &format, &view, &window])
}
