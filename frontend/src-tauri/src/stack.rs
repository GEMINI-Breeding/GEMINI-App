//! The local GEMINIbase stack: Docker Compose, managed by the app.
//!
//! The app bundles `docker-compose.prod.yaml` (GEMINIbase) and pins the image
//! release in `stack-version`. At first run the user picks where the stack's
//! data lives; the app then writes two files into its config directory:
//!
//! - `stack.json` — the user's choices (data folder, ports)
//! - `gemini.env` — everything compose needs, including secrets generated
//!   once per install. Rewrites keep the secrets: a new password would lock
//!   the app out of its own database.
//!
//! Starting the stack is `docker compose pull` then `up -d --wait`. Quitting
//! the app leaves it running (jobs keep going; `restart: unless-stopped`
//! brings it back with Docker); Settings can stop it.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Image release the bundled compose file runs (a GEMINIbase tag, without
/// the leading `v`, or `edge` before the first release).
pub const STACK_VERSION: &str = include_str!("../stack-version");

pub const PROJECT: &str = "gemini";
const DEFAULT_API_PORT: u16 = 7777;
const DEFAULT_TITILER_PORT: u16 = 8091;

// ── Persisted choices ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StackConfig {
    pub data_dir: PathBuf,
    pub api_port: u16,
    pub titiler_port: u16,
}

impl StackConfig {
    pub fn api_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.api_port)
    }
    pub fn titiler_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.titiler_port)
    }
}

pub struct Paths {
    pub config_dir: PathBuf,
    pub compose_file: PathBuf,
}

impl Paths {
    pub fn from_app(app: &AppHandle) -> Result<Self, String> {
        let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
        let compose_file = app
            .path()
            .resolve("stack/docker-compose.yaml", tauri::path::BaseDirectory::Resource)
            .map_err(|e| e.to_string())?;
        Ok(Paths { config_dir, compose_file })
    }
    fn config_file(&self) -> PathBuf {
        self.config_dir.join("stack.json")
    }
    pub fn env_file(&self) -> PathBuf {
        self.config_dir.join("gemini.env")
    }
    fn env_backup(&self) -> PathBuf {
        self.config_dir.join("gemini.env.bak")
    }
}

/// A copy of the secrets kept beside the data, so reinstalling the app (which
/// can clear its config folder) and pointing it at the same data folder
/// reuses them. Postgres only takes its password when it creates the
/// database, so a regenerated one locks the app out of its own data.
const DATA_SECRETS_FILE: &str = ".gemini-secrets.env";

pub fn load_config(paths: &Paths) -> Option<StackConfig> {
    let text = std::fs::read_to_string(paths.config_file()).ok()?;
    serde_json::from_str(&text).ok()
}

// ── Env file ────────────────────────────────────────────────────────────────

/// Keys whose values are generated once and then preserved forever.
const SECRET_KEYS: &[&str] = &[
    "GEMINI_DB_PASSWORD",
    "GEMINI_LOGGER_PASSWORD",
    "GEMINI_STORAGE_ROOT_PASSWORD",
    "GEMINI_STORAGE_SECRET_KEY",
    "GEMINI_JWT_SECRET",
    "GEMINI_FIRST_SUPERUSER_PASSWORD",
];

pub fn parse_env(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect()
}

fn secret_missing(env: &BTreeMap<String, String>, key: &str) -> bool {
    env.get(key).map_or(true, |v| v.is_empty())
}

/// The env this install already has: `gemini.env`, with any missing secret
/// filled from its backups (a crash mid-write, an unreadable file, a
/// reinstall). Refuses when the database password is gone but the data
/// folder already holds a database: generating a new one would leave the
/// stack unable to connect, with no way back.
fn existing_env(paths: &Paths, data_dir: &Path) -> Result<BTreeMap<String, String>, String> {
    let read = |p: &Path| {
        std::fs::read_to_string(p)
            .map(|t| parse_env(&t))
            .unwrap_or_default()
    };
    let mut env = read(&paths.env_file());
    for backup in [paths.env_backup(), data_dir.join(DATA_SECRETS_FILE)] {
        let saved = read(&backup);
        for k in SECRET_KEYS {
            if secret_missing(&env, k) && !secret_missing(&saved, k) {
                env.insert(k.to_string(), saved[*k].clone());
            }
        }
    }
    if secret_missing(&env, "GEMINI_DB_PASSWORD") && data_dir.join("postgres/PG_VERSION").exists() {
        return Err(format!(
            "GEMINI's saved passwords are missing ({}), but {} already holds a \
             database that needs them. Restore that file from a backup, or \
             choose a new, empty data folder.",
            paths.env_file().display(),
            data_dir.display()
        ));
    }
    Ok(env)
}

/// Write the env file, then its two backups (see `DATA_SECRETS_FILE`).
fn write_env(paths: &Paths, config: &StackConfig) -> Result<(), String> {
    let existing = existing_env(paths, &config.data_dir)?;
    let text = render_env(config, &paths.env_file(), &existing, legacy_mounts().as_ref());
    write_private(&paths.env_file(), &text)?;
    write_private(&paths.env_backup(), &text)?;
    let secrets = parse_env(&text);
    let mut saved = String::from("# GEMINI secrets for this data folder. Do not share it.\n");
    for k in SECRET_KEYS {
        saved.push_str(&format!("{k}={}\n", secrets[*k]));
    }
    write_private(&config.data_dir.join(DATA_SECRETS_FILE), &saved)
}

fn random_secret() -> String {
    let mut bytes = [0u8; 24];
    getrandom::getrandom(&mut bytes).expect("OS random source unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The full env file for `config`, keeping any secrets already in `existing`.
pub fn render_env(
    config: &StackConfig,
    env_file: &Path,
    existing: &BTreeMap<String, String>,
    legacy: Option<&LegacyMounts>,
) -> String {
    let secret = |key: &str| {
        existing
            .get(key)
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or_else(random_secret)
    };
    let data_dir = config.data_dir.to_string_lossy();
    let mut out = String::from(
        "# Written by the GEMINI app. Secrets were generated for this install;\n\
         # the app keeps them when it rewrites this file. Do not share it.\n",
    );
    let mut line = |k: &str, v: &str| out.push_str(&format!("{k}={v}\n"));
    line("GEMINI_VERSION", STACK_VERSION.trim());
    line("GEMINI_IMAGE_REGISTRY", "ghcr.io/gemini-breeding");
    line("GEMINI_ENV_FILE", &env_file.to_string_lossy());
    line("GEMINI_DATA_DIR", &data_dir);
    // Postgres refuses a data directory on an NTFS bind mount (ownership
    // and permission checks), so on Windows it lives in a Docker volume.
    // The bulk of the data (MinIO) is still in the user's folder.
    if cfg!(windows) {
        line("GEMINI_DB_MOUNT", "gemini_db");
    }
    // The previous GEMI app, mounted read-only for the import (compose
    // falls back to an empty volume when these are absent).
    if let Some(l) = legacy {
        line("GEMINI_LEGACY_APP_HOST_DIR", &l.app_dir.to_string_lossy());
        if let Some(d) = &l.data_dir {
            line("GEMINI_LEGACY_DATA_HOST_DIR", &d.to_string_lossy());
        }
    }
    line("GEMINI_REST_API_HOST_PORT", &config.api_port.to_string());
    line("GEMINI_TITILER_HOST_PORT", &config.titiler_port.to_string());
    // The webview's origin: tauri://localhost (macOS, Linux) or
    // http://tauri.localhost (Windows).
    line(
        "GEMINI_CORS_ORIGINS",
        "tauri://localhost,http://tauri.localhost,https://tauri.localhost",
    );
    for (k, v) in [
        ("GEMINI_DB_HOSTNAME", "geminibase-db"),
        ("GEMINI_DB_PORT", "5432"),
        ("GEMINI_LOGGER_HOSTNAME", "geminibase-logger"),
        ("GEMINI_LOGGER_PORT", "6379"),
        ("GEMINI_STORAGE_HOSTNAME", "geminibase-storage"),
        ("GEMINI_STORAGE_PORT", "9000"),
        ("GEMINI_STORAGE_API_PORT", "9001"),
        ("GEMINI_REST_API_HOSTNAME", "geminibase-rest-api"),
        ("GEMINI_REST_API_PORT", "7777"),
        ("GEMINI_DB_USER", "gemini"),
        ("GEMINI_DB_NAME", "gemini"),
        ("GEMINI_STORAGE_ROOT_USER", "gemini_root"),
        ("GEMINI_STORAGE_ACCESS_KEY", "gemini_storage_user"),
        ("GEMINI_STORAGE_BUCKET_NAME", "gemini"),
        ("GEMINI_JWT_ALGORITHM", "HS256"),
        ("GEMINI_JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "11520"),
        ("GEMINI_FIRST_SUPERUSER_EMAIL", "user@gemini.local"),
        ("GEMINI_FIRST_SUPERUSER_FULL_NAME", "GEMINI User"),
    ] {
        line(k, existing.get(k).map(String::as_str).unwrap_or(v));
    }
    for k in SECRET_KEYS {
        line(k, &secret(k));
    }
    out
}

fn port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn free_port_near(preferred: u16) -> u16 {
    (preferred..preferred.saturating_add(100))
        .find(|p| port_free(*p))
        .unwrap_or_else(|| {
            TcpListener::bind("127.0.0.1:0")
                .and_then(|l| l.local_addr())
                .map(|a| a.port())
                .unwrap_or(preferred)
        })
}

/// First run (or a new data folder): record the choice and write the env file.
pub fn configure(paths: &Paths, data_dir: PathBuf) -> Result<StackConfig, String> {
    if !data_dir.is_absolute() {
        return Err("Choose a full folder path.".into());
    }
    for sub in ["minio", "postgres", "redis", "nodeodm"] {
        std::fs::create_dir_all(data_dir.join(sub))
            .map_err(|e| format!("Can't create {}: {e}", data_dir.join(sub).display()))?;
    }
    let config = match load_config(paths) {
        // Keep the ports an existing install already uses.
        Some(old) => StackConfig { data_dir, ..old },
        None => StackConfig {
            data_dir,
            api_port: free_port_near(DEFAULT_API_PORT),
            titiler_port: free_port_near(DEFAULT_TITILER_PORT),
        },
    };
    std::fs::create_dir_all(&paths.config_dir).map_err(|e| e.to_string())?;
    write_env(paths, &config)?;
    std::fs::write(
        paths.config_file(),
        serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(config)
}

/// Write a file only this user can read (it holds the install's secrets).
///
/// Written to a temp file (created 0600) and renamed into place, so a crash
/// or power loss mid-write never leaves a truncated file — which the next
/// start would read as "no secrets" and regenerate.
fn write_private(path: &Path, text: &str) -> Result<(), String> {
    use std::io::Write;
    let err = |e: std::io::Error| format!("Can't write {}: {e}", path.display());
    let tmp = path.with_extension("tmp");
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&tmp).map_err(err)?;
    f.write_all(text.as_bytes()).map_err(err)?;
    f.sync_all().map_err(err)?;
    drop(f);
    #[cfg(unix)]
    {
        // `mode` only applies when the file is created.
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)).map_err(err)?;
    }
    std::fs::rename(&tmp, path).map_err(err)
}

/// Before every start: bring the env file up to date with this app version
/// (a new release pins new images) without touching the secrets.
fn refresh_env(paths: &Paths, config: &StackConfig) -> Result<(), String> {
    write_env(paths, config)
}

// ── Docker ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DockerStatus {
    /// No docker CLI found.
    Missing,
    /// CLI found, but the engine isn't answering (Docker Desktop not started).
    NotRunning { detail: String },
    /// `docker compose` isn't available (very old Docker).
    NoCompose,
    Ready { version: String },
}

/// Apps started from the Dock / Start menu don't get the shell's PATH, so
/// look where Docker Desktop installs its CLI as well.
fn docker_search_path() -> std::ffi::OsString {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    #[cfg(target_os = "macos")]
    {
        dirs.push("/usr/local/bin".into());
        dirs.push("/opt/homebrew/bin".into());
        dirs.push("/Applications/Docker.app/Contents/Resources/bin".into());
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join(".docker/bin"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        dirs.push(r"C:\Program Files\Docker\Docker\resources\bin".into());
    }
    #[cfg(target_os = "linux")]
    {
        dirs.push("/usr/bin".into());
        dirs.push("/usr/local/bin".into());
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

fn find_docker(search: &std::ffi::OsStr) -> Option<PathBuf> {
    let exe = if cfg!(windows) { "docker.exe" } else { "docker" };
    std::env::split_paths(search)
        .map(|d| d.join(exe))
        .find(|p| p.is_file())
}

/// A `docker …` command with the search PATH set, so compose finds its
/// credential helper (`docker-credential-desktop`) too.
fn docker() -> Result<Command, DockerStatus> {
    let search = docker_search_path();
    let bin = find_docker(&search).ok_or(DockerStatus::Missing)?;
    let mut cmd = Command::new(bin);
    cmd.env("PATH", &search);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    Ok(cmd)
}

pub fn docker_status() -> DockerStatus {
    let mut info = match docker() {
        Ok(c) => c,
        Err(s) => return s,
    };
    let out = match info.args(["info", "--format", "{{.ServerVersion}}"]).output() {
        Ok(o) => o,
        Err(_) => return DockerStatus::Missing,
    };
    if !out.status.success() {
        let detail = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return DockerStatus::NotRunning { detail };
    }
    let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
    match docker().map(|mut c| c.args(["compose", "version"]).output()) {
        Ok(Ok(o)) if o.status.success() => DockerStatus::Ready { version },
        _ => DockerStatus::NoCompose,
    }
}

fn compose(paths: &Paths) -> Result<Command, String> {
    let mut cmd = docker().map_err(|_| "Docker isn't installed.".to_string())?;
    cmd.arg("compose")
        .arg("-p")
        .arg(PROJECT)
        .arg("-f")
        .arg(&paths.compose_file)
        .arg("--env-file")
        .arg(paths.env_file());
    Ok(cmd)
}

// ── Start / stop ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    /// "pull" | "start" | "ready" | "error"
    pub phase: &'static str,
    pub message: String,
}

fn emit(app: &AppHandle, phase: &'static str, message: impl Into<String>) {
    let _ = app.emit("stack:progress", Progress { phase, message: message.into() });
}

/// Run a compose command, streaming its output lines as progress. Returns
/// the last lines on failure so the error says something useful.
fn run_streaming(app: &AppHandle, mut cmd: Command, phase: &'static str) -> Result<(), String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take();
    let app2 = app.clone();
    let out_thread = std::thread::spawn(move || {
        if let Some(s) = stdout {
            for line in BufReader::new(s).lines().map_while(Result::ok) {
                emit(&app2, phase, line);
            }
        }
    });
    let mut tail: Vec<String> = Vec::new();
    if let Some(s) = child.stderr.take() {
        for line in BufReader::new(s).lines().map_while(Result::ok) {
            emit(app, phase, line.clone());
            tail.push(line);
            if tail.len() > 20 {
                tail.remove(0);
            }
        }
    }
    let _ = out_thread.join();
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(tail.join("\n"))
    }
}

/// Serializes starts: a second click while pulling must not run two pulls.
pub struct StackLock(pub Mutex<()>);

pub fn start(app: &AppHandle, paths: &Paths, config: &StackConfig) -> Result<(), String> {
    refresh_env(paths, config)?;
    // A port taken by something else fails compose with a cryptic error;
    // say which port and why. (Our own running stack holds them too, so
    // only complain when the API isn't ours.)
    if !api_healthy(config) {
        for (port, what) in [(config.api_port, "API"), (config.titiler_port, "map tiles")] {
            if !port_free(port) && !own_container_on(paths, port) {
                return Err(format!(
                    "Port {port} (GEMINI {what}) is in use by another program. \
                     Close it and try again."
                ));
            }
        }
    }
    emit(app, "pull", "Downloading GEMINI services…");
    let mut pull = compose(paths)?;
    pull.args(["pull", "--ignore-pull-failures"]);
    run_streaming(app, pull, "pull")?;
    emit(app, "start", "Starting GEMINI services…");
    let mut up = compose(paths)?;
    up.args(["up", "-d", "--remove-orphans", "--wait", "--wait-timeout", "600"]);
    run_streaming(app, up, "start")?;
    emit(app, "ready", "Ready");
    Ok(())
}

/// Whether one of this stack's containers publishes `port` (after a reboot,
/// `restart: unless-stopped` brings them back before the API answers).
fn own_container_on(paths: &Paths, port: u16) -> bool {
    let Ok(mut ps) = compose(paths) else { return false };
    // `-a`: a container that is restarting still holds its port.
    ps.args(["ps", "-a", "--format", "json"])
        .output()
        .map(|o| publishes_port(&String::from_utf8_lossy(&o.stdout), port))
        .unwrap_or(false)
}

/// `docker compose ps --format json` prints one object per line (Compose
/// ≥ 2.21) or a single array (older). `{{.Publishers}}` — the old check —
/// prints `[{0.0.0.0 7777 7777 tcp}]` without field names, so looking for
/// "PublishedPort:" never matched and a cold boot refused to start.
fn publishes_port(ps_json: &str, port: u16) -> bool {
    let rows: Vec<serde_json::Value> = match serde_json::from_str(ps_json.trim()) {
        Ok(serde_json::Value::Array(rows)) => rows,
        _ => ps_json
            .lines()
            .filter_map(|l| serde_json::from_str(l.trim()).ok())
            .collect(),
    };
    rows.iter()
        .filter_map(|r| r.get("Publishers")?.as_array())
        .flatten()
        .any(|p| p.get("PublishedPort").and_then(|v| v.as_u64()) == Some(port as u64))
}

pub fn api_healthy(config: &StackConfig) -> bool {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .and_then(|c| c.get(format!("{}/healthz", config.api_url())).send())
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

pub fn stop(paths: &Paths) -> Result<(), String> {
    let out = compose(paths)?.arg("stop").output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

pub fn logs(paths: &Paths, tail: u32) -> Result<String, String> {
    let out = compose(paths)?
        .args(["logs", "--no-color", "--tail", &tail.to_string()])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    ))
}

// ── Moving the data folder (Settings, D5) ──────────────────────────────────

/// The pinned db image: Debian with coreutils, already pulled. File work on
/// the data folder runs in it as root, because on Linux the Postgres files
/// belong to the container's postgres user and the desktop user can't read
/// them. (Docker Desktop on macOS/Windows hides ownership; this works there
/// too.)
fn tools_image() -> String {
    format!("ghcr.io/gemini-breeding/geminibase-db:{}", STACK_VERSION.trim())
}

fn in_container(mounts: &[(&Path, &str)], script: &str) -> Result<String, String> {
    let mut cmd = docker().map_err(|_| "Docker isn't installed.".to_string())?;
    cmd.args(["run", "--rm", "--user", "0", "--entrypoint", "sh"]);
    for (host, inside) in mounts {
        cmd.arg("-v").arg(format!("{}:{inside}", host.display()));
    }
    let out = cmd.arg(tools_image()).arg("-c").arg(script).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// (files, KiB) under a folder, counted inside a container.
fn tally(dir: &Path) -> Result<(u64, u64), String> {
    let out = in_container(&[(dir, "/d")], "cd /d && find . | wc -l && du -sk . | cut -f1")?;
    let mut nums = out.split_whitespace().map(|n| n.parse::<u64>().unwrap_or(0));
    Ok((nums.next().unwrap_or(0), nums.next().unwrap_or(0)))
}

/// Size of the current data folder in bytes (Settings shows it).
pub fn data_size(config: &StackConfig) -> Result<u64, String> {
    tally(&config.data_dir).map(|(_, kib)| kib * 1024)
}

/// Why `to` can't receive the data, if it can't.
pub fn check_move_target(from: &Path, to: &Path) -> Result<(), String> {
    if !to.is_absolute() {
        return Err("Choose a full folder path.".into());
    }
    if to.starts_with(from) || from.starts_with(to) {
        return Err("The new folder can't be inside the current one, or contain it.".into());
    }
    if to.exists() {
        let mut entries = std::fs::read_dir(to).map_err(|e| e.to_string())?;
        // Finder/Explorer droppings don't count.
        if entries.any(|e| {
            e.map(|e| !matches!(e.file_name().to_str(), Some(".DS_Store" | "desktop.ini")))
                .unwrap_or(true)
        }) {
            return Err("Choose an empty folder: GEMINI won't mix its data with other files.".into());
        }
    }
    Ok(())
}

/// Copy the stack's data to `to`, verify the copy, switch to it and start
/// again. The old folder is left exactly as it was — the user deletes it
/// once they're satisfied (nothing is ever deleted for them, D1).
pub fn move_data(app: &AppHandle, paths: &Paths, to: PathBuf) -> Result<StackConfig, String> {
    let config = load_config(paths).ok_or("GEMINI isn't set up yet.")?;
    let from = config.data_dir.clone();
    check_move_target(&from, &to)?;
    std::fs::create_dir_all(&to).map_err(|e| format!("Can't create {}: {e}", to.display()))?;

    emit(app, "start", "Measuring the data…");
    let (files, kib) = tally(&from)?;
    let free = fs2::available_space(&to).map_err(|e| e.to_string())?;
    if free < kib * 1024 + (1 << 30) {
        return Err(format!(
            "Not enough space: the data is {:.1} GB, and {} has {:.1} GB free.",
            (kib * 1024) as f64 / 1e9,
            to.display(),
            free as f64 / 1e9
        ));
    }

    emit(app, "start", "Stopping GEMINI services…");
    stop(paths)?;
    emit(app, "start", format!("Copying {files} files ({:.1} GB)…", (kib * 1024) as f64 / 1e9));
    in_container(&[(&from, "/from:ro"), (&to, "/to")], "cp -a /from/. /to/")?;
    let copied = tally(&to)?;
    // du can differ by a few blocks across filesystems; the file count can't.
    if copied.0 != files || copied.1 + 1024 < kib {
        // Keep using the old folder; the partial copy is the user's to remove.
        let _ = start(app, paths, &config);
        return Err(format!(
            "The copy doesn't match ({} of {files} files). GEMINI is still using {}.",
            copied.0,
            from.display()
        ));
    }
    let moved = configure(paths, to)?;
    start(app, paths, &moved)?;
    Ok(moved)
}

/// The install's own account, for signing in without a login screen.
pub fn credentials(paths: &Paths) -> Result<(String, String), String> {
    let env = parse_env(&std::fs::read_to_string(paths.env_file()).map_err(|e| e.to_string())?);
    match (
        env.get("GEMINI_FIRST_SUPERUSER_EMAIL"),
        env.get("GEMINI_FIRST_SUPERUSER_PASSWORD"),
    ) {
        (Some(e), Some(p)) if !e.is_empty() && !p.is_empty() => Ok((e.clone(), p.clone())),
        _ => Err("The stack has no account configured.".into()),
    }
}

// ── The previous app (v0.0.5) ───────────────────────────────────────────────

/// Where the Python-sidecar app (v0.0.5 and earlier) kept its database.
/// Only ever read — its data must survive the upgrade untouched (D1).
pub fn legacy_install() -> Option<PathBuf> {
    let base: PathBuf = if cfg!(target_os = "macos") {
        PathBuf::from(std::env::var_os("HOME")?).join("Library/Application Support/GEMI")
    } else if cfg!(windows) {
        PathBuf::from(std::env::var_os("APPDATA")?).join("GEMI")
    } else {
        PathBuf::from(std::env::var_os("HOME")?).join(".local/share/gemi")
    };
    let db = base.join("gemi.db");
    db.is_file().then_some(db)
}

/// The previous app's folders, to mount read-only for the import.
#[derive(Debug, Clone, PartialEq)]
pub struct LegacyMounts {
    /// The folder holding gemi.db.
    pub app_dir: PathBuf,
    /// Its data folder, if it still exists.
    pub data_dir: Option<PathBuf>,
}

pub fn legacy_mounts() -> Option<LegacyMounts> {
    let db = legacy_install()?;
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    Some(legacy_mounts_for(&db, home.as_deref()))
}

/// Where the old data folder is: the database's `data_root` setting if it
/// exists on this machine, else ~/GEMI-Data (the old default).
pub fn legacy_mounts_for(db: &Path, home: Option<&Path>) -> LegacyMounts {
    let configured = legacy_data_root(db).map(PathBuf::from).filter(|p| p.is_dir());
    let default = home.map(|h| h.join("GEMI-Data")).filter(|p| p.is_dir());
    LegacyMounts {
        app_dir: db.parent().map(Path::to_path_buf).unwrap_or_default(),
        data_dir: configured.or(default),
    }
}

/// `appsetting.data_root` from the old database, opened read-only.
fn legacy_data_root(db: &Path) -> Option<String> {
    use rusqlite::{Connection, OpenFlags};
    let conn = Connection::open_with_flags(
        db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    conn.query_row("SELECT value FROM appsetting WHERE key = 'data_root'", [], |r| {
        r.get::<_, String>(0)
    })
    .ok()
    .filter(|v| !v.trim().is_empty())
}

pub fn default_data_dir() -> Option<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    // A name no earlier version used: v0.0.5 keeps ~/GEMI-Data (never
    // touched, D1) and the older GEMINI app used ~/GEMINI-Data.
    Some(PathBuf::from(home).join("GEMINI-Stack"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(dir: &str) -> StackConfig {
        StackConfig { data_dir: dir.into(), api_port: 7777, titiler_port: 8091 }
    }

    #[test]
    fn env_has_every_key_compose_requires() {
        let text = render_env(&cfg("/data/gemini"), Path::new("/cfg/gemini.env"), &BTreeMap::new(), None);
        let env = parse_env(&text);
        for k in [
            "GEMINI_VERSION",
            "GEMINI_ENV_FILE",
            "GEMINI_DATA_DIR",
            "GEMINI_DB_USER",
            "GEMINI_DB_NAME",
            "GEMINI_STORAGE_ROOT_USER",
            "GEMINI_STORAGE_ACCESS_KEY",
            "GEMINI_FIRST_SUPERUSER_EMAIL",
        ] {
            assert!(env.get(k).is_some_and(|v| !v.is_empty()), "{k} missing");
        }
        for k in SECRET_KEYS {
            assert_eq!(env[*k].len(), 48, "{k} should be a 24-byte hex secret");
        }
        assert_eq!(env["GEMINI_DATA_DIR"], "/data/gemini");
        assert_eq!(env["GEMINI_ENV_FILE"], "/cfg/gemini.env");
        assert_eq!(env["GEMINI_VERSION"], STACK_VERSION.trim());
    }

    #[test]
    fn secrets_are_unique_per_install() {
        let a = parse_env(&render_env(&cfg("/d"), Path::new("/e"), &BTreeMap::new(), None));
        let b = parse_env(&render_env(&cfg("/d"), Path::new("/e"), &BTreeMap::new(), None));
        for k in SECRET_KEYS {
            assert_ne!(a[*k], b[*k]);
        }
        let all: std::collections::HashSet<_> = SECRET_KEYS.iter().map(|k| &a[*k]).collect();
        assert_eq!(all.len(), SECRET_KEYS.len());
    }

    #[test]
    fn rewrite_keeps_secrets_and_updates_paths() {
        let first = parse_env(&render_env(&cfg("/old"), Path::new("/e"), &BTreeMap::new(), None));
        let mut moved = cfg("/new");
        moved.api_port = 7780;
        let second = parse_env(&render_env(&moved, Path::new("/e"), &first, None));
        for k in SECRET_KEYS {
            assert_eq!(first[*k], second[*k], "{k} changed on rewrite");
        }
        assert_eq!(second["GEMINI_DATA_DIR"], "/new");
        assert_eq!(second["GEMINI_REST_API_HOST_PORT"], "7780");
    }

    #[test]
    fn parse_env_ignores_comments_and_blank_lines() {
        let env = parse_env("# c\n\nA=1\n  B = two words \nbad line\n");
        assert_eq!(env.len(), 2);
        assert_eq!(env["B"], "two words");
    }

    #[test]
    fn configure_writes_private_env_and_keeps_ports() {
        let tmp = std::env::temp_dir().join(format!("gemini-stack-test-{}", random_secret()));
        let paths = Paths { config_dir: tmp.join("cfg"), compose_file: tmp.join("c.yaml") };
        let first = configure(&paths, tmp.join("data1")).unwrap();
        assert!(tmp.join("data1/minio").is_dir() && tmp.join("data1/postgres").is_dir());
        let secrets1 = parse_env(&std::fs::read_to_string(paths.env_file()).unwrap());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(paths.env_file()).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let second = configure(&paths, tmp.join("data2")).unwrap();
        assert_eq!((first.api_port, first.titiler_port), (second.api_port, second.titiler_port));
        assert_eq!(load_config(&paths), Some(second));
        let secrets2 = parse_env(&std::fs::read_to_string(paths.env_file()).unwrap());
        assert_eq!(secrets1["GEMINI_JWT_SECRET"], secrets2["GEMINI_JWT_SECRET"]);
        assert_eq!(secrets2["GEMINI_DATA_DIR"], tmp.join("data2").to_string_lossy());
        std::fs::remove_dir_all(tmp).unwrap();
    }

    #[test]
    fn configure_rejects_relative_paths() {
        let paths = Paths { config_dir: "/nonexistent".into(), compose_file: "/x".into() };
        assert!(configure(&paths, "relative/dir".into()).is_err());
    }

    #[test]
    fn legacy_data_folder_comes_from_the_old_setting_else_the_default() {
        let tmp = std::env::temp_dir().join(format!("gemini-legacy-test-{}", random_secret()));
        let app = tmp.join("GEMI");
        let custom = tmp.join("Big Drive/GEMI-Data");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::create_dir_all(&custom).unwrap();
        std::fs::create_dir_all(tmp.join("GEMI-Data")).unwrap();
        let db = app.join("gemi.db");
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE appsetting (key VARCHAR(255) PRIMARY KEY, value VARCHAR(4096));",
        )
        .unwrap();
        // No setting → the old default under home.
        let m = legacy_mounts_for(&db, Some(&tmp));
        assert_eq!(m.app_dir, app);
        assert_eq!(m.data_dir, Some(tmp.join("GEMI-Data")));
        // The user had moved it.
        conn.execute(
            "INSERT INTO appsetting VALUES ('data_root', ?1)",
            [custom.to_string_lossy()],
        )
        .unwrap();
        assert_eq!(legacy_mounts_for(&db, Some(&tmp)).data_dir, Some(custom.clone()));
        // A setting from another machine that doesn't exist here → default.
        conn.execute("UPDATE appsetting SET value = 'D:\\\\gone'", []).unwrap();
        assert_eq!(legacy_mounts_for(&db, Some(&tmp)).data_dir, Some(tmp.join("GEMI-Data")));
        drop(conn);
        // Written into the env file for compose to mount.
        let env = parse_env(&render_env(
            &cfg("/d"),
            Path::new("/e"),
            &BTreeMap::new(),
            Some(&legacy_mounts_for(&db, Some(&tmp))),
        ));
        assert_eq!(env["GEMINI_LEGACY_APP_HOST_DIR"], app.to_string_lossy());
        assert_eq!(env["GEMINI_LEGACY_DATA_HOST_DIR"], tmp.join("GEMI-Data").to_string_lossy());
        std::fs::remove_dir_all(tmp).unwrap();
    }

    #[test]
    fn move_target_rules() {
        let tmp = std::env::temp_dir().join(format!("gemini-move-test-{}", random_secret()));
        let from = tmp.join("data");
        std::fs::create_dir_all(&from).unwrap();
        assert!(check_move_target(&from, Path::new("relative")).is_err());
        assert!(check_move_target(&from, &from.join("inner")).is_err());
        assert!(check_move_target(&from, &tmp).is_err());
        assert!(check_move_target(&from, &tmp.join("new")).is_ok()); // doesn't exist yet
        let empty = tmp.join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        std::fs::write(empty.join(".DS_Store"), "").unwrap();
        assert!(check_move_target(&from, &empty).is_ok());
        std::fs::write(empty.join("thesis.docx"), "").unwrap();
        assert!(check_move_target(&from, &empty).is_err());
        std::fs::remove_dir_all(tmp).unwrap();
    }

    #[test]
    fn publishes_port_reads_compose_json_in_both_formats() {
        let row = r#"{"Name":"geminibase-rest-api","Publishers":[{"URL":"0.0.0.0","TargetPort":7777,"PublishedPort":7777,"Protocol":"tcp"},{"URL":"","TargetPort":9000,"PublishedPort":0,"Protocol":"tcp"}]}"#;
        let lines = format!("{row}\n{}\n", r#"{"Name":"db","Publishers":[]}"#);
        assert!(publishes_port(&lines, 7777));
        assert!(!publishes_port(&lines, 8091));
        assert!(publishes_port(&format!("[{row}]"), 7777)); // Compose < 2.21
        assert!(!publishes_port("", 7777));
        // What `{{.Publishers}}` printed: no field names to match on.
        assert!(!publishes_port("[{0.0.0.0 7777 7777 tcp}]", 7777));
    }

    #[test]
    fn lost_env_file_reuses_saved_secrets_or_refuses() {
        let tmp = std::env::temp_dir().join(format!("gemini-secrets-test-{}", random_secret()));
        let paths = Paths { config_dir: tmp.join("cfg"), compose_file: tmp.join("c.yaml") };
        let data = tmp.join("data");
        configure(&paths, data.clone()).unwrap();
        let original = parse_env(&std::fs::read_to_string(paths.env_file()).unwrap());
        assert!(!tmp.join("cfg/gemini.tmp").exists()); // renamed into place
        std::fs::write(data.join("postgres/PG_VERSION"), "16").unwrap();

        // Truncated env file (crash mid-write, old app): the backup fills it.
        std::fs::write(paths.env_file(), "").unwrap();
        refresh_env(&paths, &load_config(&paths).unwrap()).unwrap();
        let env = parse_env(&std::fs::read_to_string(paths.env_file()).unwrap());
        for k in SECRET_KEYS {
            assert_eq!(env[*k], original[*k], "{k}");
        }

        // Reinstall: config folder gone, same data folder → its copy is used.
        std::fs::remove_dir_all(tmp.join("cfg")).unwrap();
        configure(&paths, data.clone()).unwrap();
        let env = parse_env(&std::fs::read_to_string(paths.env_file()).unwrap());
        assert_eq!(env["GEMINI_DB_PASSWORD"], original["GEMINI_DB_PASSWORD"]);

        // Every copy lost but a database exists → refuse, don't regenerate.
        std::fs::remove_dir_all(tmp.join("cfg")).unwrap();
        std::fs::remove_file(data.join(DATA_SECRETS_FILE)).unwrap();
        let err = configure(&paths, data.clone()).unwrap_err();
        assert!(err.contains("saved passwords are missing"), "{err}");

        // A fresh folder with no database is fine: new secrets.
        assert!(configure(&paths, tmp.join("fresh")).is_ok());
        std::fs::remove_dir_all(tmp).unwrap();
    }

    #[test]
    fn free_port_skips_taken_ports() {
        let held = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = held.local_addr().unwrap().port();
        assert_ne!(free_port_near(port), port);
    }
}
