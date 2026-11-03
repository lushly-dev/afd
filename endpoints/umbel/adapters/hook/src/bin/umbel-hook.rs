//! `umbel-hook`: harness events to Umbel commands (phase 3 specification, section 10.3). Always
//! exits 0 for a hook event, so a memory problem never blocks a person's session.
#![forbid(unsafe_code)]

fn main() {
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    let environment = umbel_hook::Environment::from_process();
    let code = umbel_hook::run(
        &args,
        &environment,
        &mut std::io::stdin().lock(),
        &mut std::io::stdout().lock(),
        &mut std::io::stderr().lock(),
    );
    std::process::exit(code);
}
