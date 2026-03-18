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
        // DEVELOPMENT MODE — backend started separately via npm run dev:backend
        println!("Running in DEVELOPMENT mode - backend should be started separately");

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
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }

    #[cfg(not(debug_assertions))]
    {
        // PRODUCTION MODE — start backend sidecar on a free port, inject URL
        use sidecar_manager::SidecarManager;
        use std::sync::Arc;
        use tauri::Manager;

        let sidecar = Arc::new(SidecarManager::new());
        let sidecar_for_exit = Arc::clone(&sidecar);

        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_dialog::init())
            .invoke_handler(tauri::generate_handler![download_to_file])
            .setup(move |app| {
                let app_handle = app.handle().clone();

                let port = match sidecar.start(&app_handle) {
                    Ok(p) => p,
                    Err(e) => {
                        eprintln!("Failed to start backend: {}", e);
                        return Ok(());
                    }
                };

                if let Err(e) = sidecar.wait_for_health(30) {
                    eprintln!("Backend health check failed: {}", e);
                }

                // Inject the backend base URL into every webview window so
                // the frontend can use it regardless of which port was chosen.
                let backend_url = format!("http://127.0.0.1:{}", port);
                let script = format!(
                    "window.__GEMI_BACKEND_URL__ = '{}';",
                    backend_url
                );

                for window in app_handle.webview_windows().values() {
                    if let Err(e) = window.eval(&script) {
                        eprintln!("Failed to inject backend URL: {}", e);
                    }
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
