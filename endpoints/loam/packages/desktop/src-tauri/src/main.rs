// No console window on Windows in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Subcommands dispatched BEFORE Tauri or the single-instance plugin starts:
    // - `loam-desktop engine-run ...` (phase 5 amendment, 6.2/6.3): runs windowless WITHOUT
    //   `attach_console()` so Windows logon launches produce zero console flash.
    // - `loam-desktop mcp` (phase 6, 10.8) and `loam-desktop plugin` (phase 5 amendment, 10):
    //   attach to their parent console on Windows.
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("engine-run") => {
            std::process::exit(loam_desktop::engine_run::run(&args[1..]));
        }
        Some("mcp") => {
            attach_console();
            std::process::exit(loam_desktop::bridge::run(&args[1..]));
        }
        Some("plugin") => {
            attach_console();
            std::process::exit(loam_desktop::plugins_cli::run(&args[1..]));
        }
        _ => {}
    }
    loam_desktop::run();
}

/// A release build on Windows has no console of its own: the bridge and `--print-connection` use their parent's.
#[cfg(windows)]
fn attach_console() {
    use windows_sys::Win32::System::Console::{ATTACH_PARENT_PROCESS, AttachConsole};
    // SAFETY: `AttachConsole` has no preconditions; failing (no parent console, or one already attached) changes nothing.
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg(not(windows))]
fn attach_console() {}
