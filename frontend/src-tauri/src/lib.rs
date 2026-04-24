// Prevents additional console window on Windows in release
#[cfg(not(debug_assertions))]
mod sidecar_manager;

/// Fetch `url` (GET or POST) and write the response body to `dest` on disk.
/// Optional `headers` map (e.g. Authorization) is forwarded to the request.
#[tauri::command]
async fn download_to_file(
    url: String,
    dest: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let mut req = match method.as_deref().unwrap_or("POST") {
        "GET" => client.get(&url),
        _ => client.post(&url),
    };
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.header(k, v);
        }
    }
    let response = req.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Server returned {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// POST a JSON body to `url` and write the response bytes directly to `dest`.
/// Used for authenticated downloads that need a Save As dialog (avoids passing
/// large byte arrays over Tauri IPC, which serialises to JSON and freezes the UI).
#[tauri::command]
async fn download_post_to_file(
    url: String,
    dest: String,
    body: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body);
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.header(k, v);
        }
    }
    let response = req.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Server returned {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(debug_assertions))]
/// Read the sidecar startup log (captured before the HTTP server is ready).
/// Returns raw text so the Console tab can show it even when the backend is down.
#[tauri::command]
fn read_sidecar_log(
    state: tauri::State<std::sync::Arc<sidecar_manager::SidecarManager>>,
) -> String {
    let path_guard = state.log_path.lock().unwrap();
    match path_guard.as_ref() {
        Some(p) => std::fs::read_to_string(p)
            .unwrap_or_else(|e| format!("(cannot read log: {})", e)),
        None => "(sidecar not started yet)".into(),
    }
}

#[cfg(debug_assertions)]
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    {
        // DEVELOPMENT MODE — backend started separately via npm run dev:backend.
        use tauri::{WebviewUrl, WebviewWindowBuilder};

        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_dialog::init())
            .invoke_handler(tauri::generate_handler![download_to_file, download_post_to_file, open_devtools])
            .setup(|app| {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;

                const DEVTOOLS_SCRIPT: &str = r#"
                    document.addEventListener('keydown', function(e) {
                        if (e.metaKey && e.altKey && e.key === 'i') {
                            window.__TAURI_INTERNALS__.invoke('open_devtools');
                        }
                    });
                "#;
                let init = format!("{}\n{}", ZOOM_SCRIPT, DEVTOOLS_SCRIPT);

                WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title("GEMI")
                    .inner_size(1200.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .center()
                    .maximized(true)
                    .initialization_script(&init)
                    .build()?;

                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }

    #[cfg(not(debug_assertions))]
    {
        // PRODUCTION MODE — start the backend sidecar, then create the window
        // with an initialization_script so __GEMI_BACKEND_URL__ is available
        // before any JavaScript runs (avoids the race where main.tsx reads the
        // variable before window.eval() injects it).
        use sidecar_manager::SidecarManager;
        use std::sync::Arc;
        use std::thread;
        use tauri::{WebviewUrl, WebviewWindowBuilder};

        let sidecar = Arc::new(SidecarManager::new());
        let sidecar_for_exit = Arc::clone(&sidecar);
        let sidecar_for_state = Arc::clone(&sidecar);

        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_dialog::init())
            .manage(sidecar_for_state)
            .invoke_handler(tauri::generate_handler![download_to_file, download_post_to_file, read_sidecar_log])
            .setup(move |app| {
                let app_handle = app.handle().clone();

                // Spawn the sidecar — returns the port immediately after the
                // process starts (does NOT wait for the HTTP server to be ready).
                let port = match sidecar.start(&app_handle) {
                    Ok(p) => p,
                    Err(e) => {
                        eprintln!("Failed to start backend: {}", e);
                        0
                    }
                };

                let backend_url = if port > 0 {
                    format!("http://127.0.0.1:{}", port)
                } else {
                    String::new()
                };

                // Inject the URL *before* JS runs so OpenAPI.BASE is correct
                // from the very first line of main.tsx.  Also inject zoom handler.
                let init_script = format!(
                    "window.__GEMI_BACKEND_URL__ = '{}';\n{}",
                    backend_url, ZOOM_SCRIPT
                );

                WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title("GEMI")
                    .inner_size(1200.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .center()
                    .maximized(true)
                    .initialization_script(&init_script)
                    .build()?;

                // Health check runs in the background — it only logs; the
                // frontend's own polling handles "backend not ready yet" state.
                if port > 0 {
                    let sidecar_clone = Arc::clone(&sidecar);
                    thread::spawn(move || {
                        if let Err(e) = sidecar_clone.wait_for_health(60) {
                            eprintln!("Backend health check failed: {}", e);
                        } else {
                            println!("Backend ready on port {}", port);
                        }
                    });
                }

                Ok(())
            })
            .on_window_event(move |_window, event| {
                if let tauri::WindowEvent::Destroyed = event {
                    if let Err(e) = sidecar_for_exit.stop() {
                        eprintln!("Failed to stop backend: {}", e);
                    }
                }
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
