// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

// State to hold the sidecar process
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            child: Mutex::new(None),
        })
        .setup(|app| {
            // Start the sidecar backend server on app start
            let handle = app.handle().clone();
            start_backend(&handle)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Stop the sidecar when app closes
                if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                    if let Ok(mut child_guard) = state.child.lock() {
                        if let Some(child) = child_guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![start_server, stop_server, get_server_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn start_backend(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let sidecar_command = app.shell().sidecar("todo-server")?;

    let (mut rx, child) = sidecar_command
        .args(["--transport", "http", "--port", "3100"])
        .spawn()?;

    // Store the child process
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(mut guard) = state.child.lock() {
            *guard = Some(child);
        }
    }

    // Spawn a task to handle stdout/stderr
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    println!("[todo-server] {}", line_str);
                }
                CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    eprintln!("[todo-server] {}", line_str);
                }
                CommandEvent::Error(err) => {
                    eprintln!("[todo-server] Error: {}", err);
                }
                CommandEvent::Terminated(payload) => {
                    println!("[todo-server] Terminated with code: {:?}", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn start_server(app: AppHandle) -> Result<String, String> {
    start_backend(&app).map_err(|e| e.to_string())?;
    Ok("Server started".to_string())
}

#[tauri::command]
async fn stop_server(app: AppHandle) -> Result<String, String> {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(mut guard) = state.child.lock() {
            if let Some(child) = guard.take() {
                child.kill().map_err(|e| e.to_string())?;
                return Ok("Server stopped".to_string());
            }
        }
    }
    Err("No server running".to_string())
}

#[tauri::command]
async fn get_server_status(app: AppHandle) -> Result<bool, String> {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(guard) = state.child.lock() {
            return Ok(guard.is_some());
        }
    }
    Ok(false)
}
