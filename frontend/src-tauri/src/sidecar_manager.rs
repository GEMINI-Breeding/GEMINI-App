use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Manager;

pub struct SidecarManager {
    process: Mutex<Option<Child>>,
    port: Mutex<u16>,
    pub log_path: Mutex<Option<PathBuf>>,
}

impl SidecarManager {
    pub fn new() -> Self {
        SidecarManager {
            process: Mutex::new(None),
            port: Mutex::new(0),
            log_path: Mutex::new(None),
        }
    }

    /// Find a free TCP port by asking the OS to bind on port 0.
    fn find_free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .expect("Failed to bind to a free port")
            .local_addr()
            .expect("Failed to get local address")
            .port()
    }

    /// Start the backend on a free port.
    ///
    /// The backend is bundled as a --onedir PyInstaller directory placed in the
    /// Tauri resources folder.  We locate it via `app.path().resource_dir()`.
    pub fn start(&self, app: &tauri::AppHandle) -> Result<u16, String> {
        let mut process_guard = self.process.lock().unwrap();

        if process_guard.is_some() {
            return Ok(*self.port.lock().unwrap());
        }

        let port = Self::find_free_port();
        *self.port.lock().unwrap() = port;

        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?;

        // Log file in app data dir so it survives crashes and can be read later
        let log_dir = app
            .path()
            .app_log_dir()
            .map_err(|e| format!("Failed to get log dir: {}", e))?;
        std::fs::create_dir_all(&log_dir)
            .map_err(|e| format!("Failed to create log dir: {}", e))?;
        let log_path = log_dir.join("gemi-backend.log");
        *self.log_path.lock().unwrap() = Some(log_path.clone());

        let binary_name = if cfg!(target_os = "windows") {
            "gemi-backend.exe"
        } else {
            "gemi-backend"
        };

        let binary_path = resource_dir.join("gemi-backend").join(binary_name);

        // Write startup info to log before spawn so we always have something to read
        let mut log_file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&log_path)
            .map_err(|e| format!("Failed to open log file: {}", e))?;
        writeln!(log_file, "[tauri] Backend log — port {}", port).ok();
        writeln!(log_file, "[tauri] Binary path: {:?}", binary_path).ok();

        if !binary_path.exists() {
            let msg = format!("Backend binary not found: {:?}", binary_path);
            writeln!(log_file, "[tauri] ERROR: {}", msg).ok();
            return Err(msg);
        }

        // Ensure the binary is executable (artifact download can strip the bit).
        // This may fail if the app is installed system-wide and the user is not
        // the owner — that's fine: package managers set the bit at install time.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            match std::fs::metadata(&binary_path) {
                Ok(meta) => {
                    let mut perms = meta.permissions();
                    perms.set_mode(0o755);
                    match std::fs::set_permissions(&binary_path, perms) {
                        Ok(_) => writeln!(log_file, "[tauri] Set execute permission OK").ok(),
                        Err(e) => writeln!(log_file, "[tauri] chmod skipped ({}), assuming already executable", e).ok(),
                    };
                }
                Err(e) => writeln!(log_file, "[tauri] Cannot stat binary: {}", e).ok(),
            }
        }

        let mut child = Command::new(&binary_path)
            .env("GEMI_BACKEND_PORT", port.to_string())
            .env("ENVIRONMENT", "desktop")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                let msg = format!("Failed to spawn backend {:?}: {}", binary_path, e);
                writeln!(log_file, "[tauri] SPAWN ERROR: {}", msg).ok();
                msg
            })?;

        writeln!(log_file, "[tauri] Spawned OK (pid {:?})", child.id()).ok();
        drop(log_file); // threads will reopen for appending

        let log_path_out = log_path.clone();
        if let Some(stdout) = child.stdout.take() {
            thread::spawn(move || {
                let mut f = OpenOptions::new().append(true).open(&log_path_out).ok();
                for line in BufReader::new(stdout).lines() {
                    match line {
                        Ok(l) => {
                            println!("[backend] {}", l);
                            if let Some(ref mut file) = f {
                                writeln!(file, "[out] {}", l).ok();
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        let log_path_err = log_path.clone();
        if let Some(stderr) = child.stderr.take() {
            thread::spawn(move || {
                let mut f = OpenOptions::new().append(true).open(&log_path_err).ok();
                for line in BufReader::new(stderr).lines() {
                    match line {
                        Ok(l) => {
                            eprintln!("[backend] {}", l);
                            if let Some(ref mut file) = f {
                                writeln!(file, "[err] {}", l).ok();
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        *process_guard = Some(child);
        println!("Backend started on port {}", port);
        Ok(port)
    }

    /// Wait for the backend to respond to health checks.
    pub fn wait_for_health(&self, max_retries: u32) -> Result<(), String> {
        let port = *self.port.lock().unwrap();
        let url = format!("http://127.0.0.1:{}/api/v1/utils/health-check/", port);

        println!("Waiting for backend on port {}...", port);

        for i in 0..max_retries {
            thread::sleep(Duration::from_secs(1));
            match reqwest::blocking::get(&url) {
                Ok(r) if r.status().is_success() => {
                    println!("Backend is healthy on port {}", port);
                    return Ok(());
                }
                _ => println!("Not ready yet ({}/{})", i + 1, max_retries),
            }
        }

        Err(format!("Backend on port {} failed to become healthy", port))
    }

    /// Stop the backend process.
    pub fn stop(&self) -> Result<(), String> {
        let mut process_guard = self.process.lock().unwrap();
        if let Some(mut child) = process_guard.take() {
            println!("Stopping backend...");
            child.kill().map_err(|e| format!("Failed to kill backend: {}", e))?;
        }
        Ok(())
    }
}
