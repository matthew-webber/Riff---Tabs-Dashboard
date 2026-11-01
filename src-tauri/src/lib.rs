mod db;
mod server;
mod tuning;
mod urls;

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

use db::{Library, SaveResult, Tab, TabInput};

struct AppState {
    lib: Arc<Mutex<Library>>,
}

type CmdResult<T> = Result<T, String>;

/// Emitted to the frontend when the library was changed from outside the
/// app (browser extension or riff:// link).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalChange {
    /// "saved" or "removed".
    pub kind: &'static str,
    /// The tab as saved, or as it was just before removal (so the UI can offer undo).
    pub tab: Tab,
    pub created: bool,
    pub source: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    presets: &'static [tuning::Preset],
    api_port: u16,
}

#[tauri::command]
fn get_meta() -> Meta {
    Meta { presets: tuning::PRESETS, api_port: server::PORT }
}

#[tauri::command]
fn list_tabs(state: State<AppState>) -> CmdResult<Vec<Tab>> {
    state.lib.lock().unwrap().list()
}

#[tauri::command]
fn lookup_url(state: State<AppState>, url: String) -> CmdResult<Option<Tab>> {
    state.lib.lock().unwrap().find_by_url(&url)
}

#[tauri::command]
fn save_tab(state: State<AppState>, input: TabInput) -> CmdResult<SaveResult> {
    state.lib.lock().unwrap().save(input)
}

#[tauri::command]
fn restore_tab(state: State<AppState>, tab: Tab) -> CmdResult<Tab> {
    state.lib.lock().unwrap().restore(tab)
}

#[tauri::command]
fn delete_tab(state: State<AppState>, id: i64) -> CmdResult<()> {
    state.lib.lock().unwrap().delete(id)
}

#[tauri::command]
fn open_tab(app: AppHandle, state: State<AppState>, id: i64) -> CmdResult<Tab> {
    let lib = state.lib.lock().unwrap();
    let tab = lib.get(id)?.ok_or("That tab no longer exists")?;
    app.opener().open_url(&tab.url, None::<&str>).map_err(|e| format!("Couldn't open the browser: {e}"))?;
    lib.mark_opened(id)
}

#[tauri::command]
fn rename_tag(state: State<AppState>, from: String, to: String) -> CmdResult<()> {
    state.lib.lock().unwrap().rename_tag(&from, &to)
}

#[tauri::command]
fn delete_tag(state: State<AppState>, name: String) -> CmdResult<()> {
    state.lib.lock().unwrap().delete_tag(&name)
}

fn notify(app: &AppHandle, change: ExternalChange) {
    let _ = app.emit("library-changed", change);
}

/// Handle `riff://add?url=…&title=…&artist=…&tuning=…&tags=a,b&favorite=1`.
/// Used by the extension as a fallback when the local API isn't reachable
/// (e.g. Riff wasn't running — opening the link launches it).
fn handle_deep_link(app: &AppHandle, link: &url::Url) {
    if link.scheme() != "riff" {
        return;
    }
    let action = link.host_str().unwrap_or_else(|| link.path().trim_matches('/'));
    match action {
        "add" | "save" => {
            let mut input = TabInput::default();
            for (k, v) in link.query_pairs() {
                let v = v.into_owned();
                match k.as_ref() {
                    "url" => input.url = Some(v),
                    "title" => input.title = Some(v),
                    "artist" => input.artist = Some(v),
                    "tuning" => input.tuning = Some(v),
                    "tags" => input.tags = Some(v.split(',').map(str::to_owned).collect()),
                    "favorite" => input.favorite = Some(matches!(v.as_str(), "1" | "true" | "yes")),
                    _ => {}
                }
            }
            let result = app.state::<AppState>().lib.lock().unwrap().save(input);
            match result {
                Ok(saved) => notify(app, ExternalChange { kind: "saved", tab: saved.tab, created: saved.created, source: "link" }),
                Err(e) => log::warn!("Ignoring riff link {link}: {e}"),
            }
        }
        "open" | "" => show_main_window(app),
        other => log::warn!("Unknown riff link action: {other}"),
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // On Windows/Linux a deep link starts a second process; forward it to the
    // running instance instead. (macOS delivers links to the running app.)
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let lib = Library::open(&data_dir.join("riff.sqlite"))?;
            let lib = Arc::new(Mutex::new(lib));
            app.manage(AppState { lib: lib.clone() });

            let handle = app.handle().clone();
            server::spawn(lib, move |change| notify(&handle, change));

            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                let _ = app.deep_link().register_all();
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for link in event.urls() {
                    handle_deep_link(&handle, &link);
                }
            });
            if let Ok(Some(links)) = app.deep_link().get_current() {
                for link in links {
                    handle_deep_link(app.handle(), &link);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Mac convention: closing the window keeps Riff running (so the
            // extension can keep saving silently). Quit with ⌘Q.
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            get_meta,
            list_tabs,
            lookup_url,
            save_tab,
            restore_tab,
            delete_tab,
            open_tab,
            rename_tag,
            delete_tag,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Riff")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
