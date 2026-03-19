// Prevents additional console window on Windows in release
#[cfg(not(debug_assertions))]
mod sidecar_manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    {
        // DEVELOPMENT MODE — backend started separately via npm run dev:backend.
        // Window is created here (not in tauri.conf.json) to keep parity with
        // production; no initialization_script needed because dev uses relative
        // URLs proxied by Vite.
        use tauri::{WebviewUrl, WebviewWindowBuilder};

        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_dialog::init())
            .invoke_handler(tauri::generate_handler![download_to_file])
            .setup(|app| {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;

                WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title("GEMI")
                    .inner_size(1200.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .center()
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
        use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

        let sidecar = Arc::new(SidecarManager::new());
        let sidecar_for_exit = Arc::clone(&sidecar);

        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_dialog::init())
            .invoke_handler(tauri::generate_handler![download_to_file])
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
                // from the very first line of main.tsx.
                let init_script = format!(
                    "window.__GEMI_BACKEND_URL__ = '{}';",
                    backend_url
                );

                WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title("GEMI")
                    .inner_size(1200.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .center()
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
