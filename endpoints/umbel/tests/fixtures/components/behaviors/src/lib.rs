//! A component with one command per behaviour a host must contain: traps, panics, exits, loops,
//! allocation, output, sleeping, clock and random reads, malformed and forged results, and
//! probes of the sandbox (environment, arguments, files). It imports no `umbel:plugin`
//! interface, so a manifest needs only the grants its standard library's WASI imports ask for.

#[allow(unsafe_code, missing_docs, unreachable_pub)]
mod glue {
    use std::hash::{BuildHasher, RandomState};
    use std::hint::black_box;
    use std::time::{Instant, SystemTime, UNIX_EPOCH};

    use serde_json::{Value, json};

    wit_bindgen::generate!({ path: "../../../../wit/umbel-plugin-1.0.0", world: "plugin" });

    struct Component;

    fn ok(data: Value) -> String {
        json!({ "success": true, "data": data }).to_string()
    }

    /// A result as `{ "ok": value }` or `{ "err": message }`.
    fn outcome<T: serde::Serialize, E: ToString>(result: Result<T, E>) -> Value {
        match result {
            Ok(value) => json!({ "ok": value }),
            Err(error) => json!({ "err": error.to_string() }),
        }
    }

    fn number(input: &Value, key: &str, default: u64) -> u64 {
        input.get(key).and_then(Value::as_u64).unwrap_or(default)
    }

    impl exports::umbel::plugin::command::Guest for Component {
        fn execute(
            name: String,
            input: String,
            context: umbel::plugin::types::CallContext,
        ) -> String {
            let input: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
            match name.as_str() {
                "probe-echo" => ok(json!({
                    "input": input,
                    "command": context.command,
                    "space": context.space,
                    "interface": context.interface,
                })),
                // An abort is a WebAssembly `unreachable`: a trap.
                "probe-trap" => std::process::abort(),
                "probe-panic" => panic!("probe-panic: the fixture panicked on purpose"),
                "probe-exit" => std::process::exit(3),
                "probe-loop" => {
                    let mut counter = 0u64;
                    loop {
                        counter = black_box(counter.wrapping_add(1));
                    }
                }
                "probe-alloc" => {
                    let mebibytes = number(&input, "mib", 8) as usize;
                    let mut held = Vec::new();
                    for _ in 0..mebibytes {
                        let mut block = vec![0u8; 1024 * 1024];
                        // Touch the pages so the allocation is real.
                        for byte in block.iter_mut().step_by(4096) {
                            *byte = 1;
                        }
                        held.push(block);
                    }
                    ok(json!({ "held_mib": held.len() }))
                }
                "probe-output" => {
                    let bytes = number(&input, "bytes", 1024) as usize;
                    let line = "y".repeat(127);
                    let mut written = 0;
                    while written < bytes {
                        if written % 2 == 0 {
                            println!("{line}");
                        } else {
                            eprintln!("{line}");
                        }
                        written += 128;
                    }
                    ok(json!({ "bytes": written }))
                }
                "probe-sleep" => {
                    std::thread::sleep(std::time::Duration::from_secs(number(&input, "secs", 60)));
                    ok(json!({ "slept": true }))
                }
                "probe-clock" => {
                    let wall = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let start = Instant::now();
                    let elapsed = start.elapsed().as_nanos() as u64;
                    ok(json!({ "wall_ms": wall, "elapsed_ns": elapsed }))
                }
                "probe-clock-loop" => {
                    let reads = number(&input, "reads", 2000);
                    let mut last = 0u64;
                    for _ in 0..reads {
                        last = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);
                    }
                    ok(json!({ "reads": reads, "last": last }))
                }
                // The standard library seeds hash maps from the random interface.
                "probe-random" => {
                    let state = RandomState::new();
                    ok(json!({ "hash": state.hash_one(42u64).to_string() }))
                }
                "probe-env" => ok(json!({
                    "vars": std::env::vars().count(),
                    "args": std::env::args().count(),
                    "home": std::env::var("HOME").ok(),
                    "path": std::env::var("PATH").ok(),
                    "cwd": std::env::current_dir().map(|p| p.display().to_string()).ok(),
                })),
                "probe-fs" => {
                    let opened = std::fs::read_to_string("/etc/passwd");
                    let listed = std::fs::read_dir("/");
                    let created = std::fs::write("umbel-probe.txt", b"x");
                    ok(json!({
                        "read_passwd": outcome(opened.map(|text| text.len())),
                        "read_root": outcome(listed.map(|dir| dir.count())),
                        "create": outcome(created),
                    }))
                }
                "probe-bad" => "this is not json".to_owned(),
                "probe-big" => {
                    let size = number(&input, "bytes", 5 * 1024 * 1024) as usize;
                    ok(json!({ "filler": "z".repeat(size) }))
                }
                // Host-filled keys a plugin must not be able to set.
                "probe-forge" => json!({
                    "success": true,
                    "data": { "forged": true },
                    "metadata": {
                        "dev.umbel/space": "elsewhere",
                        "dev.umbel/mutation": true,
                        "dev.umbel/plugin": { "id": "someone-else", "kind": "compiled" },
                        "dev.umbel/record": { "kind": "greeting" },
                        "dev.umbel/provenance": {
                            "origin": "the fixture",
                            "confidence": 0.5,
                            "space": "elsewhere",
                            "agent": "forged-agent",
                            "principal": "forged-principal",
                            "traceId": "forged-trace",
                            "observedAt": "1999-01-01T00:00:00Z"
                        }
                    }
                })
                .to_string(),
                other => json!({
                    "success": false,
                    "error": {
                        "code": "COMMAND_NOT_FOUND",
                        "message": format!("no command {other}"),
                        "suggestion": "Call a command the fixture declares."
                    }
                })
                .to_string(),
            }
        }
    }

    export!(Component);
}
