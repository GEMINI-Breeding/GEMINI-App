use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Manager;

pub struct SidecarManager {
    process: Mutex<Option<Child>>,
    port: Mutex<u16>,
}

impl SidecarManager {
    pub fn new() -> Self {
        SidecarManager {
            process: Mutex::new(None),
            port: Mutex::new(0),
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

    /// Return the port the backend was started on (0 if not started yet).
    pub fn port(&self) -> u16 {
        *self.port.lock().unwrap()
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

        let binary_name = if cfg!(target_os = "windows") {
            "gemi-backend.exe"
        } else {
            "gemi-backend"
        };

        let binary_path = resource_dir.join("gemi-backend").join(binary_name);

        println!("Starting backend at {:?} on port {}...", binary_path, port);

        let mut child = Command::new(&binary_path)
            .env("GEMI_BACKEND_PORT", port.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn backend {:?}: {}", binary_path, e))?;

        if let Some(stdout) = child.stdout.take() {
            thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    match line {
                        Ok(l) => println!("[backend] {}", l),
                        Err(_) => break,
                    }
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines() {
                    match line {
                        Ok(l) => eprintln!("[backend] {}", l),
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
