//! The agent service (the home page's backend), shipped with the app as one
//! executable (`gemi-agent`, built from `agent/` by `agent/build_desktop.py`)
//! and run for as long as the app is open.
//!
//! It keeps the person's settings and state in the app's data folder
//! (`GEMI_AGENT_HOME`) and reads the scripts it ships with from the app's
//! resources (`GEMI_AGENT_RESOURCES`). It listens on this computer only, on a
//! free port; the window is told the address before any page code runs.

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

/// The running service, so it can be stopped with the app.
pub struct Agent(pub Mutex<Option<Child>>);

/// Origins the app's window can have (macOS / Linux, Windows, and `tauri dev`).
const ORIGINS: &str = "tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:5173";

fn free_port() -> Option<u16> {
    TcpListener::bind(("127.0.0.1", 0)).ok()?.local_addr().ok().map(|a| a.port())
}

/// `gemi-agent` sits beside the app's own executable (Tauri's externalBin).
fn executable() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let name = if cfg!(windows) { "gemi-agent.exe" } else { "gemi-agent" };
    let path = dir.join(name);
    path.is_file().then_some(path)
}

/// Start the service; returns its address, or why it could not be started
/// (the app still opens: the home page then says the agent is not running).
pub fn start(app: &AppHandle) -> Result<String, String> {
    let exe = executable().ok_or("the agent executable is not part of this build")?;
    let port = free_port().ok_or("no free port for the agent service")?;
    let home = app.path().app_data_dir().map_err(|e| e.to_string())?.join("agent");
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?.join("agent");

    let mut cmd = Command::new(exe);
    // --parent-pid: the service watches this process and exits when it is gone,
    // so a crash or a forced quit cannot leave it behind.
    cmd.args(["serve", "--port", &port.to_string(), "--parent-pid", &std::process::id().to_string()])
        .env("GEMI_AGENT_HOME", &home)
        .env("GEMI_AGENT_RESOURCES", &resources)
        .env("GEMI_AGENT_ORIGINS", ORIGINS)
        .current_dir(&home)
        .stdin(Stdio::null());
    // Its output goes to a log in the data folder: what to look at when the
    // home page says the agent did not start.
    if let Ok(log) = std::fs::File::create(home.join("service.log")) {
        if let Ok(err) = log.try_clone() {
            cmd.stdout(Stdio::from(log)).stderr(Stdio::from(err));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console window beside the app
    }
    let child = cmd.spawn().map_err(|e| format!("could not start the agent service: {e}"))?;
    if let Some(state) = app.try_state::<Agent>() {
        *state.0.lock().unwrap() = Some(child);
    }
    Ok(format!("http://127.0.0.1:{port}"))
}

/// Stop the service (app exit). Cluster jobs and tunnels are not touched here:
/// a session on a cluster outlives the app on purpose.
pub fn stop(app: &AppHandle) {
    if let Some(state) = app.try_state::<Agent>() {
        if let Some(mut child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
