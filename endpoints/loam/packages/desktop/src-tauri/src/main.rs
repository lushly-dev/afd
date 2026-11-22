// No console window on Windows in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `loam-desktop mcp` is the stdio bridge (phase 6 specification, 10.8), decided before Tauri or the single-instance
    // plugin starts, so it opens no window and never focuses the running one.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("mcp") {
        attach_console();
        std::process::exit(loam_desktop::bridge::run(&args[1..]));
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
