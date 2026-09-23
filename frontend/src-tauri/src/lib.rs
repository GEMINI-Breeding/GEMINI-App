mod stack;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Build a native Edit menu with custom Undo / Redo items. The items
/// deliberately don't register keyboard accelerators — `Cmd/Ctrl+Z`
/// stays handled by the WebView (so native text-undo inside form
/// inputs keeps working), and the editor's window keydown listener
/// catches the same shortcut when focus is outside an input. The menu
/// items emit `editor:undo` / `editor:redo` Tauri events that the
/// frontend subscribes to in PlotBoundaryPrep.
fn install_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let undo = MenuItemBuilder::with_id("editor_undo", "Undo")
        .build(app)?;
    let redo = MenuItemBuilder::with_id("editor_redo", "Redo")
        .build(app)?;
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .build()?;
    let menu = MenuBuilder::new(app).item(&edit_submenu).build()?;
    app.set_menu(menu)?;
    app.on_menu_event(move |handle, event| match event.id().as_ref() {
        "editor_undo" => {
            let _ = handle.emit("editor:undo", ());
        }
        "editor_redo" => {
            let _ = handle.emit("editor:redo", ());
        }
        _ => {}
    });
    Ok(())
}

/// Fetch `url` (GET or POST) and write the response body to `dest` on disk.
#[tauri::command]
async fn download_to_file(url: String, dest: String, method: Option<String>) -> Result<(), String> {
    let client = reqwest::Client::new();
    let req = match method.as_deref().unwrap_or("POST") {
        "GET" => client.get(&url),
        _ => client.post(&url),
    };
    let response = req.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Server returned {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

/// Keyboard zoom handler injected into every window.
/// Ctrl+/- (Windows/Linux) or Cmd+/- (macOS) zoom the webview.
const ZOOM_SCRIPT: &str = r#"
(function() {
  var _z = 1.0;
  document.addEventListener('keydown', function(e) {
    var mod = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
    if (!mod) return;
    if (e.key === '=' || e.key === '+') {
      e.preventDefault(); _z = Math.min(_z + 0.1, 3.0);
      document.documentElement.style.zoom = _z;
    } else if (e.key === '-') {
      e.preventDefault(); _z = Math.max(_z - 0.1, 0.5);
      document.documentElement.style.zoom = _z;
    } else if (e.key === '0') {
      e.preventDefault(); _z = 1.0;
      document.documentElement.style.zoom = _z;
    }
  });
})();
"#;

// ── Local stack commands (see stack.rs) ─────────────────────────────────────

#[derive(serde::Serialize)]
struct StackStatus {
    /// True in release builds: the app runs the stack itself. Development
    /// builds use the stack from `npm run dev:backend` through Vite's proxy.
    managed: bool,
    version: String,
    docker: stack::DockerStatus,
    config: Option<stack::StackConfig>,
    api_url: Option<String>,
    titiler_url: Option<String>,
    healthy: bool,
    default_data_dir: Option<String>,
    /// v0.0.5's database, if that app was installed here (read-only; D1).
    legacy_install: Option<String>,
}

fn paths(app: &AppHandle) -> Result<stack::Paths, String> {
    stack::Paths::from_app(app)
}

#[tauri::command]
async fn stack_status(app: AppHandle) -> Result<StackStatus, String> {
    let paths = paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let config = stack::load_config(&paths);
        let healthy = config.as_ref().is_some_and(stack::api_healthy);
        StackStatus {
            managed: cfg!(not(debug_assertions)),
            version: stack::STACK_VERSION.trim().to_string(),
            docker: stack::docker_status(),
            api_url: config.as_ref().map(|c| c.api_url()),
            titiler_url: config.as_ref().map(|c| c.titiler_url()),
            config,
            healthy,
            default_data_dir: stack::default_data_dir().map(|p| p.to_string_lossy().into()),
            legacy_install: stack::legacy_install().map(|p| p.to_string_lossy().into()),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn stack_configure(app: AppHandle, data_dir: String) -> Result<stack::StackConfig, String> {
    stack::configure(&paths(&app)?, data_dir.into())
}

#[tauri::command]
async fn stack_start(app: AppHandle) -> Result<(), String> {
    let paths = paths(&app)?;
    let config = stack::load_config(&paths).ok_or("Choose a data folder first.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let lock = app.state::<stack::StackLock>();
        let _guard = lock.0.lock().map_err(|e| e.to_string())?;
        stack::start(&app, &paths, &config).inspect_err(|e| {
            let _ = app.emit(
                "stack:progress",
                stack::Progress { phase: "error", message: e.clone() },
            );
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn stack_stop(app: AppHandle) -> Result<(), String> {
    let paths = paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || stack::stop(&paths))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn stack_logs(app: AppHandle, tail: Option<u32>) -> Result<String, String> {
    let paths = paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || stack::logs(&paths, tail.unwrap_or(300)))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
struct Credentials {
    email: String,
    password: String,
}

/// The install's own account, so the app signs in without a login screen.
#[tauri::command]
fn stack_credentials(app: AppHandle) -> Result<Credentials, String> {
    let (email, password) = stack::credentials(&paths(&app)?)?;
    Ok(Credentials { email, password })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let mut init = String::from(ZOOM_SCRIPT);
    #[cfg(debug_assertions)]
    init.push_str(
        r#"
        document.addEventListener('keydown', function(e) {
            if (e.metaKey && e.altKey && e.key === 'i') {
                window.__TAURI_INTERNALS__.invoke('open_devtools');
            }
        });
        "#,
    );
    // Release builds run the stack themselves; the frontend's StackGate
    // sets the API/TiTiler URLs once the stack is up.
    #[cfg(not(debug_assertions))]
    init.push_str("\nwindow.__GEMI_MANAGED_STACK__ = true;\n");

    tauri::Builder::default()
        // Before other plugins: a second launch focuses the running window
        // instead of starting a second copy (two copies would race on the
        // same stack).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(stack::StackLock(std::sync::Mutex::new(())))
        .invoke_handler(tauri::generate_handler![
            download_to_file,
            open_devtools,
            stack_status,
            stack_configure,
            stack_start,
            stack_stop,
            stack_logs,
            stack_credentials,
        ])
        .setup(move |app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            install_app_menu(app.handle())?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("GEMI")
                .inner_size(1200.0, 800.0)
                .min_inner_size(800.0, 600.0)
                .center()
                .maximized(true)
                .initialization_script(&init)
                .build()?;
            // Quitting leaves the stack running: jobs in progress keep going
            // and the next launch is instant. Settings can stop it.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
