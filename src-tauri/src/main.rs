#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rand::RngCore;
use serde::Serialize;
use std::{
    env, fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::Mutex,
    thread,
    time::Duration,
};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{webview::PageLoadEvent, AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandChild, process::CommandEvent, ShellExt};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct NodeSidecar {
    child: Mutex<Option<CommandChild>>,
    port: Mutex<u16>,
    token: String,
}

#[derive(Serialize)]
struct ServiceControlResponse {
    ok: bool,
    action: String,
    port: u16,
    token: String,
    control_url: String,
    message: String,
}

#[tauri::command]
fn control_service(
    action: String,
    app: AppHandle,
    state: State<'_, NodeSidecar>,
) -> Result<ServiceControlResponse, String> {
    let action = action.trim().to_ascii_lowercase();
    if action != "start" && action != "stop" && action != "restart" {
        return Err("不支持的服务操作。".to_string());
    }

    let current_port = *state
        .port
        .lock()
        .map_err(|_| "端口状态锁定失败。".to_string())?;

    if action == "stop" {
        let stopped = {
            let mut child = state
                .child
                .lock()
                .map_err(|_| "服务状态锁定失败。".to_string())?;
            child.take()
        };
        let had_child = stop_sidecar(stopped, current_port);

        return Ok(ServiceControlResponse {
            ok: true,
            action,
            port: current_port,
            token: state.token.clone(),
            control_url: control_url(current_port, &state.token),
            message: if had_child {
                "本地服务已停止。".to_string()
            } else {
                "本地服务已经停止。".to_string()
            },
        });
    }

    let existing_child_is_healthy = state
        .child
        .lock()
        .map_err(|_| "服务状态锁定失败。".to_string())?
        .is_some()
        && health_ok(current_port, &state.token);
    if action == "start" && existing_child_is_healthy {
        return Ok(ServiceControlResponse {
            ok: true,
            action,
            port: current_port,
            token: state.token.clone(),
            control_url: control_url(current_port, &state.token),
            message: "本地服务已经在运行。".to_string(),
        });
    }

    if action == "restart" || !existing_child_is_healthy {
        let stopped = {
            let mut child = state
                .child
                .lock()
                .map_err(|_| "服务状态锁定失败。".to_string())?;
            child.take()
        };
        stop_sidecar(stopped, current_port);
    }

    let port = configured_port().unwrap_or_else(|| find_available_port(8787, 20).unwrap_or(8787));
    let child = spawn_node_sidecar(&app, port, &state.token)?;
    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "服务状态锁定失败。".to_string())?;
        *guard = Some(child);
    }
    {
        let mut guard = state
            .port
            .lock()
            .map_err(|_| "端口状态锁定失败。".to_string())?;
        *guard = port;
    }

    let healthy = wait_for_health(port, &state.token, Duration::from_secs(12));
    Ok(ServiceControlResponse {
        ok: healthy,
        action: action.clone(),
        port,
        token: state.token.clone(),
        control_url: control_url(port, &state.token),
        message: if healthy {
            if action == "start" {
                "本地服务已启动。".to_string()
            } else {
                "本地服务已重启。".to_string()
            }
        } else {
            "已发起服务操作，但健康检查暂未完成。".to_string()
        },
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![control_service])
        .setup(|app| {
            let port =
                configured_port().unwrap_or_else(|| find_available_port(8787, 20).unwrap_or(8787));
            let token = configured_token().unwrap_or_else(generate_token);
            let control_url = control_url(port, &token);
            let child = spawn_node_sidecar(app.handle(), port, &token)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;

            app.manage(NodeSidecar {
                child: Mutex::new(Some(child)),
                port: Mutex::new(port),
                token: token.clone(),
            });

            wait_for_health(port, &token, Duration::from_secs(12));
            let (window_width, window_height) = adaptive_window_size(app);

            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(control_url.parse().expect("valid control URL")),
            )
            .title("CodexPanel 控制面板")
            .inner_size(window_width, window_height)
            .min_inner_size(window_width, window_height)
            .max_inner_size(window_width, window_height)
            .center()
            .resizable(false)
            .maximizable(false)
            .zoom_hotkeys_enabled(false)
            .on_page_load(|window, payload| {
                if matches!(payload.event(), PageLoadEvent::Finished) {
                    let _ = window.set_zoom(1.0);
                }
            })
            .build()?;
            window.set_resizable(false)?;
            window.set_maximizable(false)?;
            window.set_zoom(1.0)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                if let Some(state) = window.try_state::<NodeSidecar>() {
                    let port = state.port.lock().map(|port| *port).unwrap_or(0);
                    if let Ok(mut child) = state.child.lock() {
                        stop_sidecar(child.take(), port);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running CodexPanel desktop app");
}

fn control_url(port: u16, token: &str) -> String {
    format!("http://127.0.0.1:{}/control.html?token={}", port, token)
}

fn adaptive_window_size(app: &tauri::App) -> (f64, f64) {
    const TARGET_WIDTH: f64 = 760.0;
    const TARGET_HEIGHT: f64 = 392.0;
    const MIN_WIDTH: f64 = 720.0;
    const MIN_HEIGHT: f64 = 372.0;
    const EDGE_MARGIN: f64 = 64.0;

    let Some(monitor) = app.primary_monitor().ok().flatten() else {
        return (TARGET_WIDTH, TARGET_HEIGHT);
    };

    let scale_factor = if monitor.scale_factor().is_finite() && monitor.scale_factor() > 0.0 {
        monitor.scale_factor()
    } else {
        1.0
    };
    let work_area = monitor.work_area();
    let available_width = (f64::from(work_area.size.width) / scale_factor - EDGE_MARGIN).max(480.0);
    let available_height =
        (f64::from(work_area.size.height) / scale_factor - EDGE_MARGIN).max(420.0);
    let fit = (available_width / TARGET_WIDTH)
        .min(available_height / TARGET_HEIGHT)
        .min(1.0);

    let width = (TARGET_WIDTH * fit)
        .round()
        .min(TARGET_WIDTH)
        .min(available_width)
        .max(MIN_WIDTH.min(available_width));
    let height = (TARGET_HEIGHT * fit)
        .round()
        .min(TARGET_HEIGHT)
        .min(available_height)
        .max(MIN_HEIGHT.min(available_height));

    (width, height)
}

fn spawn_node_sidecar(app: &AppHandle, port: u16, token: &str) -> Result<CommandChild, String> {
    let mut sidecar = app
        .shell()
        .sidecar("codexpanel-node-sidecar")
        .map_err(|error| format!("无法加载本地服务 sidecar：{error}"))?
        .env("PORT", port.to_string())
        .env("MOBILE_TYPER_TOKEN", token.to_string())
        .env("CODEX_APP_NAME", "CodexPanel")
        .env("CODEX_OPEN_BROWSER", "0");
    if let Some(remote_key) = configured_remote_key() {
        sidecar = sidecar.env("CODEX_REMOTE_KEY", remote_key);
    }
    if let Some(relay_url) = configured_relay_url() {
        sidecar = sidecar.env("CODEX_RELAY_URL", relay_url);
    }

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|error| format!("启动本地服务失败：{error}"))?;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    print!("{}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Stderr(bytes) => {
                    eprint!("{}", String::from_utf8_lossy(&bytes));
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

fn stop_sidecar(child: Option<CommandChild>, port: u16) -> bool {
    let had_child = child.is_some();
    if let Some(child) = child {
        let pid = child.pid();
        kill_process_tree(pid);
        let _ = child.kill();
    }
    kill_sidecar_orphans();
    if port > 0 {
        wait_for_port_release(port, Duration::from_secs(5));
    }
    had_child
}

#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
fn kill_process_tree(_pid: u32) {}

#[cfg(windows)]
fn kill_sidecar_orphans() {
    let script = r#"
$pattern = 'codexpanel-tauri-node-sidecar|node-sidecar\.js'
Get-CimInstance Win32_Process |
  Where-Object {
    $_.ProcessId -ne $PID -and
    $_.CommandLine -and
    ($_.Name -eq 'node.exe' -or $_.Name -eq 'codexpanel-node-sidecar.exe') -and
    $_.CommandLine -match $pattern
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"#;
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
fn kill_sidecar_orphans() {}

fn find_available_port(start: u16, attempts: u16) -> Option<u16> {
    for port in start..start.saturating_add(attempts) {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}

fn wait_for_port_release(port: u16, timeout: Duration) {
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(120));
    }
}

fn configured_port() -> Option<u16> {
    env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| TcpListener::bind(("127.0.0.1", *port)).is_ok())
        .or_else(|| {
            saved_control_value("port")
                .and_then(parse_saved_port)
                .filter(|port| TcpListener::bind(("127.0.0.1", *port)).is_ok())
        })
}

fn configured_token() -> Option<String> {
    env::var("MOBILE_TYPER_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn generate_token() -> String {
    let mut bytes = [0u8; 18];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn configured_remote_key() -> Option<String> {
    env::var("CODEX_REMOTE_KEY")
        .ok()
        .and_then(|value| normalize_remote_key(&value))
        .or_else(|| {
            saved_control_value("remoteKey")
                .and_then(|value| value.as_str().and_then(normalize_remote_key))
        })
}

fn configured_relay_url() -> Option<String> {
    env::var("CODEX_RELAY_URL")
        .ok()
        .and_then(|value| normalize_non_empty(&value))
        .or_else(|| {
            saved_control_value("relayUrl")
                .and_then(|value| value.as_str().and_then(normalize_non_empty))
        })
}

fn saved_control_value(key: &str) -> Option<serde_json::Value> {
    let text = fs::read_to_string(codex_state_path()).ok()?;
    let state: serde_json::Value = serde_json::from_str(&text).ok()?;
    state.get("controlConfig")?.get(key).cloned()
}

fn codex_state_path() -> PathBuf {
    env::var_os("CODEX_STATE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".codex"))
        .join("state.json")
}

fn home_dir() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn parse_saved_port(value: serde_json::Value) -> Option<u16> {
    if let Some(port) = value.as_u64() {
        return u16::try_from(port).ok().filter(|port| *port > 0);
    }
    value
        .as_str()?
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
}

fn normalize_non_empty(value: &str) -> Option<String> {
    let normalized = value.trim().trim_end_matches('/').to_string();
    (!normalized.is_empty()).then_some(normalized)
}

fn normalize_remote_key(value: &str) -> Option<String> {
    let normalized: String = value
        .trim()
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .take(80)
        .collect();
    (!normalized.is_empty()).then_some(normalized)
}

fn wait_for_health(port: u16, token: &str, timeout: Duration) -> bool {
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if health_ok(port, token) {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

fn health_ok(port: u16, token: &str) -> bool {
    let mut stream = match TcpStream::connect(("127.0.0.1", port)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));

    let request = format!(
        "GET /codex/health?token={} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        token, port
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = [0u8; 64];
    match stream.read(&mut response) {
        Ok(size) => String::from_utf8_lossy(&response[..size]).starts_with("HTTP/1.1 200"),
        Err(_) => false,
    }
}
