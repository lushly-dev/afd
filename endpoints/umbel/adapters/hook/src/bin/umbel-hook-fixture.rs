//! The tests' stand-in for `$UMBEL_BIN` (phase 3 specification, section 1): it takes the
//! command line `umbel-first-party` takes, `--workspace <dir> --format json call <command> @-`,
//! appends `{ "args", "input" }` to `<dir>/calls.jsonl` and answers as `<dir>/mode` says:
//! `ok` (the default), `refuse` (`MEMORY_INVALID`), `busy` (`STORE_BUSY`, a lock timeout),
//! `garbage` (output that is not JSON) or `sleep` (never answers). A bundle's `data.text` is
//! `<dir>/bundle-text` when that file exists, else `null`. `memory-import` answers every entry
//! created; `memory-export` answers the page `<dir>/export.json` holds under the input's `after`
//! (`""` for the first), else an empty last page.
#![forbid(unsafe_code)]

use std::io::{Read, Write};
use std::path::PathBuf;

use serde_json::{Value, json};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let workspace = args
        .iter()
        .position(|arg| arg == "--workspace")
        .and_then(|at| args.get(at + 1))
        .map(PathBuf::from);
    let Some(workspace) = workspace else {
        println!(
            r#"{{"success":false,"error":{{"code":"WORKSPACE_NOT_FOUND","message":"no workspace"}}}}"#
        );
        std::process::exit(1);
    };
    let command = args
        .iter()
        .position(|arg| arg == "call")
        .and_then(|at| args.get(at + 1))
        .cloned()
        .unwrap_or_default();
    let mut stdin = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut stdin);
    let input: Value = serde_json::from_slice(&stdin).unwrap_or(Value::Null);
    if let Ok(mut log) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(workspace.join("calls.jsonl"))
    {
        let _ = writeln!(log, "{}", json!({ "args": args, "input": input }));
    }
    let mode = std::fs::read_to_string(workspace.join("mode")).unwrap_or_default();
    let failure = |code: &str| {
        println!(
            "{}",
            json!({ "success": false, "error": { "code": code, "message": "the fixture refused", "suggestion": "none" } })
        );
        std::process::exit(1);
    };
    match mode.trim() {
        "refuse" => failure("MEMORY_INVALID"),
        "busy" => failure("STORE_BUSY"),
        "garbage" => {
            println!("this is not a command result");
            std::process::exit(1);
        }
        "sleep" => std::thread::sleep(std::time::Duration::from_secs(600)),
        _ => {}
    }
    let data = match command.as_str() {
        "memory-capture" => {
            let entries = input
                .get("episodes")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            json!({ "captureId": "cap-000000000000000000000000", "created": entries, "observed": 0, "replayed": 0, "refused": 0, "flagged": 0, "redactions": [], "records": [] })
        }
        "memory-import" => {
            let entries = input
                .get("entries")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            json!({ "created": entries, "observed": 0, "flagged": 0, "redactions": [], "records": [], "verification": "unverified" })
        }
        "memory-export" => {
            let pages: Value = std::fs::read_to_string(workspace.join("export.json"))
                .ok()
                .and_then(|text| serde_json::from_str(&text).ok())
                .unwrap_or(Value::Null);
            let after = input.get("after").and_then(Value::as_str).unwrap_or("");
            pages.get(after).cloned().unwrap_or_else(
                || json!({ "records": [], "next": null, "unreadable": 0, "tooLarge": [] }),
            )
        }
        "context-bundle" => {
            let text = std::fs::read_to_string(workspace.join("bundle-text")).ok();
            json!({ "text": text })
        }
        _ => json!({}),
    };
    println!("{}", json!({ "success": true, "data": data }));
}
