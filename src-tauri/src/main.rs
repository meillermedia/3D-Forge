#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Wry};

// Menu item id = CSS selector of the web button that is clicked by the frontend
type Items = Mutex<HashMap<String, MenuItem<Wry>>>;

#[tauri::command]
fn set_menu_enabled(items: tauri::State<Items>, id: String, enabled: bool) {
    if let Some(item) = items.lock().unwrap().get(&id) {
        let _ = item.set_enabled(enabled);
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let mut items: HashMap<String, MenuItem<Wry>> = HashMap::new();
    let mut item = |label: &str, id: &str, enabled: bool, accel: Option<&str>| -> tauri::Result<MenuItem<Wry>> {
        let it = MenuItem::with_id(app, id, label, enabled, accel)?;
        items.insert(id.to_string(), it.clone());
        Ok(it)
    };

    let about = item("About 3DForge", "#logoBtn", true, None)?;
    let app_menu = Submenu::with_items(app, "3DForge", true, &[
        &about,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::services(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::hide(app, None)?,
        &PredefinedMenuItem::hide_others(app, None)?,
        &PredefinedMenuItem::show_all(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::quit(app, None)?,
    ])?;

    let file_menu = Submenu::with_items(app, "File", true, &[
        &item("Load (3DForge JSON)", "[data-imp='.json']", true, Some("CmdOrCtrl+O"))?,
        &item("Save (3DForge JSON)", "#exp", true, Some("CmdOrCtrl+S"))?,
        &PredefinedMenuItem::separator(app)?,
        &Submenu::with_items(app, "Import", true, &[
            &item("OBJ", "[data-imp='.obj']", true, None)?,
            &item("STL", "[data-imp='.stl']", true, None)?,
            &item("glTF / GLB", "[data-imp='.gltf,.glb']", true, None)?,
            &item("3DS", "[data-imp='.3ds']", true, None)?,
        ])?,
        &Submenu::with_items(app, "Export", true, &[
            &item("OBJ", "[data-exp='obj']", true, None)?,
            &item("STL", "[data-exp='stl']", true, None)?,
            &item("glTF (GLB)", "[data-exp='glb']", true, None)?,
            &item("3DS", "[data-exp='3ds']", true, None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("Image (PNG)", "[data-exp='png']", true, None)?,
        ])?,
        &PredefinedMenuItem::separator(app)?,
        &item("Clear scene", "#clear", true, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::close_window(app, None)?,
    ])?;

    let edit_menu = Submenu::with_items(app, "Edit\u{200B}", true, &[
        &item("Undo", "#undo", false, Some("CmdOrCtrl+Z"))?,
        &item("Redo", "#redo", false, Some("CmdOrCtrl+Shift+Z"))?,
        &PredefinedMenuItem::separator(app)?,
        &item("Cut", "#cut", false, Some("CmdOrCtrl+X"))?,
        &item("Copy", "#copy", false, Some("CmdOrCtrl+C"))?,
        &item("Paste", "#paste", false, Some("CmdOrCtrl+V"))?,
        &item("Select All", "#selectAll", true, Some("CmdOrCtrl+A"))?,
        &PredefinedMenuItem::separator(app)?,
        &item("Duplicate", "#dup", true, Some("CmdOrCtrl+D"))?,
        &item("Clone Reference", "#cloneRef", true, Some("CmdOrCtrl+Shift+D"))?,
        &item("Delete", "#del", true, None)?,
    ])?;

    let viewport_menu = Submenu::with_items(app, "Viewport", true, &[
        &item("Standard", "[data-shading='standard']", true, None)?,
        &item("Edges", "[data-shading='edges']", true, None)?,
        &item("Rendered", "[data-shading='better']", true, None)?,
    ])?;

    let window_menu = Submenu::with_items(app, "Window", true, &[
        &PredefinedMenuItem::minimize(app, None)?,
        &PredefinedMenuItem::maximize(app, None)?,
        &PredefinedMenuItem::fullscreen(app, None)?,
    ])?;

    let help_menu = Submenu::with_items(app, "Help", true, &[
        &item("Controls", "#helpBtn", true, None)?,
        &item("Edit mode", "#helpEditBtn", true, None)?,
        &item("Keyboard shortcuts", "#helpKeysBtn", true, None)?,
    ])?;

    app.manage(Mutex::new(items));
    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &viewport_menu, &window_menu, &help_menu])
}

// macOS adds Dictation, Emoji & Symbols (and more) to the Edit menu on its own; switch them off
#[cfg(target_os = "macos")]
fn disable_system_edit_items() {
    use objc2_foundation::{ns_string, NSUserDefaults};
    let defaults = NSUserDefaults::standardUserDefaults();
    for key in [ns_string!("NSDisabledDictationMenuItem"), ns_string!("NSDisabledCharacterPaletteMenuItem")] {
        defaults.setBool_forKey(true, key);
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    disable_system_edit_items();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![set_menu_enabled])
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().as_ref());
        })
        .run(tauri::generate_context!())
        .expect("error while running 3DForge");
}
