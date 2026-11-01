//! The built `umbel` binary serving MCP (specification section 10): stdio carries only JSON-RPC
//! and shares a workspace with one-shot commands; startup failures are one line of JSON on stderr
//! with exit code 1; HTTP binds a loopback port, prints the listening line, requires the bearer
//! token, and stops on SIGINT or SIGTERM with exit code 0.
//!
//! Every child is killed when its handle drops, and HTTP tests bind port 0, so a failing test
//! leaks neither a server nor a port.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![cfg(feature = "cli")]

mod support;

use serde_json::{Value, json};
use std::path::Path;
use support::process::{Process, command, http, json as parse, listening_port};
use support::*;

const MODERN_LIST: &str = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}"#;

fn initialize() -> String {
    json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": { "name": "process-test", "version": "0" },
        },
    })
    .to_string()
}

fn tool_names(response: &Value) -> Vec<&str> {
    response["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect()
}

fn run_once(dir: &Path, args: &[&str]) -> std::process::Output {
    command(dir, args).output().unwrap()
}

mod stdio {
    use super::*;

    fn serve(dir: &Path) -> Process {
        Process::spawn(dir, &["serve", "--stdio"])
    }

    #[test]
    fn a_legacy_initialize_and_a_modern_tools_list_are_answered_and_stdout_is_only_json_rpc() {
        let dir = minimal();
        let mut legacy = serve(dir.path());
        legacy.send_line(&initialize());
        let initialized = parse(&legacy.stdout_line());
        assert_eq!(initialized["jsonrpc"], "2.0");
        assert_eq!(initialized["result"]["protocolVersion"], "2025-11-25");
        assert_eq!(initialized["result"]["serverInfo"]["name"], "umbel");
        legacy.send_line(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        legacy.send_line(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#);
        let list = parse(&legacy.stdout_line());
        assert_eq!(list["id"], 2);
        assert!(tool_names(&list).contains(&"workspace-show"), "{list}");

        let mut modern = serve(dir.path());
        modern.send_line(MODERN_LIST);
        let list = parse(&modern.stdout_line());
        assert_eq!(list["result"]["resultType"], "complete");
        assert_eq!(list["result"]["ttlMs"], 300_000);
        let names = tool_names(&list);
        assert_eq!(
            &names[..5],
            [
                "afd-discover",
                "afd-detail",
                "afd-call",
                "afd-batch",
                "afd-pipe"
            ]
        );
        assert!(names.contains(&"workspace-show"));

        // A tool call, then a clean end when the client closes stdin.
        modern.send_line(
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"workspace-show","arguments":{},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}"#,
        );
        let call = parse(&modern.stdout_line());
        let text = call["result"]["content"][0]["text"].as_str().unwrap();
        assert_eq!(parse(text)["data"]["host"]["name"], "umbel");

        let (code, stdout, stderr) = modern.finish();
        assert_eq!(code, Some(0), "stderr: {stderr:?}");
        // Whatever else was printed, stdout held JSON-RPC lines alone.
        for line in stdout {
            assert_eq!(parse(&line)["jsonrpc"], "2.0", "{line}");
        }
        let (code, stdout, _) = legacy.finish();
        assert_eq!(code, Some(0));
        for line in stdout {
            assert_eq!(parse(&line)["jsonrpc"], "2.0", "{line}");
        }
    }

    #[test]
    fn logs_go_to_stderr_never_stdout() {
        let dir = minimal();
        let mut server = Process::spawn(dir.path(), &["--log", "debug", "serve", "--stdio"]);
        server.send_line(MODERN_LIST);
        let list = parse(&server.stdout_line());
        assert!(list["result"]["tools"].is_array());
        let (code, stdout, _stderr) = server.finish();
        assert_eq!(code, Some(0));
        for line in stdout {
            assert_eq!(parse(&line)["jsonrpc"], "2.0", "{line}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn sigterm_stops_a_stdio_server_with_exit_code_0() {
        let dir = minimal();
        let mut server = serve(dir.path());
        server.send_line(MODERN_LIST);
        let _ = server.stdout_line();
        let status = std::process::Command::new("kill")
            .args(["-TERM", &server.id().to_string()])
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(server.wait(), Some(0));
    }

    #[test]
    fn one_shot_commands_run_beside_a_serving_process_and_share_its_workspace() {
        let dir = minimal();
        let mut server = serve(dir.path());
        server.send_line(MODERN_LIST);
        let names = parse(&server.stdout_line());
        assert!(tool_names(&names).contains(&"event-list"), "{names}");
        for args in [
            vec!["event", "ack", "cursor=v0:main:0"],
            vec!["event", "list"],
        ] {
            let output = run_once(dir.path(), &args);
            assert_eq!(output.status.code(), Some(0), "{args:?}: {output:?}");
        }
        // The server answers while the one-shots ran, and the journal holds the entries of the
        // one-shot processes with contiguous `seq`.
        server.send_line(MODERN_LIST);
        let again = parse(&server.stdout_line());
        assert!(again["result"]["tools"].is_array());
        let journal = std::fs::read_to_string(dir.path().join("state/journal.jsonl")).unwrap();
        let entries = afd::parse_journal(&journal).unwrap();
        let commands: Vec<&str> = entries.iter().map(|entry| entry.command.as_str()).collect();
        assert!(
            commands.contains(&"event-ack") && commands.contains(&"event-list"),
            "{commands:?}"
        );
        for (index, entry) in entries.iter().enumerate() {
            assert_eq!(entry.seq, index as u64 + 1);
        }
    }
}

mod startup_failures {
    use super::*;

    /// The single failure line a startup failure leaves on stderr, with nothing on stdout.
    fn failure_of(dir: &Path, args: &[&str]) -> Value {
        let output = run_once(dir, args);
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        assert!(
            output.stdout.is_empty(),
            "stdout holds nothing: {}",
            String::from_utf8_lossy(&output.stdout)
        );
        let stderr = String::from_utf8_lossy(&output.stderr);
        let lines: Vec<&str> = stderr.lines().collect();
        assert_eq!(lines.len(), 1, "one line on stderr: {stderr}");
        let result = parse(lines[0]);
        assert_eq!(result["success"], false, "{result}");
        assert!(result["error"]["suggestion"].is_string(), "{result}");
        result
    }

    #[test]
    fn an_invalid_umbel_toml_is_one_failure_line_on_stderr_and_exit_1() {
        for flag in ["--stdio", "--http"] {
            let dir = workspace("config_version = 1\nnonsense = true\n");
            let result = failure_of(dir.path(), &["serve", flag]);
            assert_eq!(
                result["error"]["code"], "WORKSPACE_CONFIG_INVALID",
                "{flag}"
            );
            assert!(
                result["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("nonsense")
            );
        }
    }

    #[test]
    fn a_missing_workspace_is_a_failure_line() {
        let dir = tempfile::tempdir().unwrap();
        let result = failure_of(dir.path(), &["serve", "--stdio"]);
        assert_eq!(result["error"]["code"], "WORKSPACE_NOT_FOUND");
    }

    #[test]
    fn an_unusable_confirmation_key_is_a_failure_line() {
        let dir = minimal();
        let key = dir.path().join("state/keys");
        std::fs::create_dir_all(&key).unwrap();
        std::fs::write(key.join("confirmation.key"), [0u8; 16]).unwrap();
        let result = failure_of(dir.path(), &["serve", "--stdio"]);
        assert_eq!(result["error"]["code"], "WORKSPACE_KEY_INVALID");
    }

    #[test]
    fn a_non_loopback_bind_is_refused_from_the_flag_the_environment_and_the_file() {
        let dir = minimal();
        for bind in ["0.0.0.0:0", "192.168.1.5:7410", "[::]:0", "example.com:80"] {
            let result = failure_of(dir.path(), &["serve", "--http", "--bind", bind]);
            assert_eq!(
                result["error"]["code"], "WORKSPACE_CONFIG_INVALID",
                "{bind}"
            );
            assert!(
                result["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("http.bind"),
                "{bind}"
            );
        }
        let output = command(dir.path(), &["serve", "--http"])
            .env("UMBEL_HTTP_BIND", "0.0.0.0:0")
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1));
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).contains("http.bind"));

        let file = workspace("config_version = 1\n\n[http]\nbind = \"0.0.0.0:7410\"\n");
        let result = failure_of(file.path(), &["serve", "--http"]);
        assert_eq!(result["error"]["code"], "WORKSPACE_CONFIG_INVALID");
    }

    #[test]
    fn a_malformed_token_file_stops_serve_http_and_is_left_alone() {
        let dir = minimal();
        let keys = dir.path().join("state/keys");
        std::fs::create_dir_all(&keys).unwrap();
        std::fs::write(keys.join("http.token"), "short").unwrap();
        let result = failure_of(dir.path(), &["serve", "--http", "--bind", "127.0.0.1:0"]);
        assert_eq!(result["error"]["code"], "WORKSPACE_KEY_INVALID");
        assert_eq!(
            std::fs::read_to_string(keys.join("http.token")).unwrap(),
            "short"
        );
    }

    #[test]
    fn an_address_in_use_is_a_failure_line() {
        let dir = minimal();
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = taken.local_addr().unwrap().to_string();
        let result = failure_of(dir.path(), &["serve", "--http", "--bind", &address]);
        assert_eq!(result["error"]["code"], "SERVER_START_FAILED");
        assert!(
            result["error"]["message"]
                .as_str()
                .unwrap()
                .contains(&address)
        );
    }

    #[test]
    fn usage_errors_of_serve_are_stderr_lines_too() {
        let dir = minimal();
        for args in [
            vec!["serve"],
            vec!["serve", "--stdio", "--http"],
            vec!["serve", "--stdio", "--bind", "127.0.0.1:0"],
            vec!["serve", "--stdio", "--print-token"],
            vec!["serve", "--no-such-flag"],
        ] {
            let result = failure_of(dir.path(), &args);
            assert_eq!(result["error"]["code"], "INVALID_INPUT", "{args:?}");
        }
    }
}

mod http {
    use super::*;

    struct Served {
        process: Process,
        port: u16,
        token: String,
    }

    fn serve(dir: &Path) -> Served {
        let process = Process::spawn(
            dir,
            &["serve", "--http", "--bind", "127.0.0.1:0", "--print-token"],
        );
        let line = process.stderr_line();
        let port = listening_port(&line);
        assert!(line.contains("(token in "), "{line}");
        assert!(line.contains("state/keys/http.token"), "{line}");
        assert!(
            line.contains(&format!("http://127.0.0.1:{port}/mcp")),
            "{line}"
        );
        let token = process.stdout_line();
        Served {
            process,
            port,
            token,
        }
    }

    fn bearer(token: &str) -> String {
        format!("Bearer {token}")
    }

    fn list(served: &Served, authorization: Option<&str>) -> (u16, String) {
        let mut headers = vec![
            ("Content-Type", "application/json"),
            ("Accept", "application/json, text/event-stream"),
            ("Mcp-Protocol-Version", "2026-07-28"),
            ("Mcp-Method", "tools/list"),
        ];
        if let Some(authorization) = authorization {
            headers.push(("Authorization", authorization));
        }
        http(served.port, "POST", "/mcp", &headers, Some(MODERN_LIST))
    }

    #[test]
    fn it_prints_the_listening_line_and_the_token_and_requires_the_token() {
        let dir = minimal();
        let served = serve(dir.path());
        // The token on stdout is the token file's: 64 lowercase hex characters, mode 0600.
        let file = dir.path().join("state/keys/http.token");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), served.token);
        assert_eq!(served.token.len(), 64);
        assert!(
            served
                .token
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        let (status, body) = http(
            served.port,
            "GET",
            "/health",
            &[("Authorization", &bearer(&served.token))],
            None,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(parse(&body), json!({ "status": "ok" }));
        let (status, body) = http(served.port, "GET", "/health", &[], None);
        assert_eq!(status, 401, "{body}");
        assert_eq!(parse(&body)["error"], "UNAUTHORIZED");

        let (status, body) = list(&served, Some(&bearer(&served.token)));
        assert_eq!(status, 200, "{body}");
        assert!(
            tool_names(&parse(&body)).contains(&"workspace-show"),
            "{body}"
        );
        let (status, _) = list(&served, None);
        assert_eq!(status, 401);
        let (status, _) = list(&served, Some(&bearer(&"0".repeat(64))));
        assert_eq!(status, 401);
        let (status, _) = list(&served, Some(&bearer(&served.token[..10])));
        assert_eq!(status, 401);
    }

    #[test]
    fn nothing_but_the_token_reaches_stdout_and_a_second_start_reuses_the_token() {
        let dir = minimal();
        let first = serve(dir.path());
        let token = first.token.clone();
        drop(first);
        let second = serve(dir.path());
        assert_eq!(second.token, token);
    }

    #[cfg(unix)]
    #[test]
    fn sigint_and_sigterm_stop_it_with_exit_code_0() {
        for signal in ["-INT", "-TERM"] {
            let dir = minimal();
            let mut served = serve(dir.path());
            let (status, _) = http(
                served.port,
                "GET",
                "/health",
                &[("Authorization", &bearer(&served.token))],
                None,
            );
            assert_eq!(status, 200);
            let killed = std::process::Command::new("kill")
                .args([signal, &served.process.id().to_string()])
                .status()
                .unwrap();
            assert!(killed.success());
            assert_eq!(served.process.wait(), Some(0), "{signal}");
            // The port is free again.
            assert!(std::net::TcpStream::connect(("127.0.0.1", served.port)).is_err());
        }
    }

    #[test]
    fn the_bind_flag_overrides_the_file() {
        let dir = workspace("config_version = 1\n\n[http]\nbind = \"127.0.0.1:1\"\n");
        let served = serve(dir.path());
        assert_ne!(served.port, 1);
        let (status, _) = http(
            served.port,
            "GET",
            "/health",
            &[("Authorization", &bearer(&served.token))],
            None,
        );
        assert_eq!(status, 200);
    }

    #[test]
    fn a_configured_path_serves_there() {
        let dir = workspace("config_version = 1\n\n[http]\npath = \"/rpc\"\n");
        let process = Process::spawn(
            dir.path(),
            &["serve", "--http", "--bind", "127.0.0.1:0", "--print-token"],
        );
        let line = process.stderr_line();
        assert!(line.contains("/rpc (token in "), "{line}");
        let port = listening_port(&line);
        let token = process.stdout_line();
        let headers = [
            ("Content-Type", "application/json"),
            ("Accept", "application/json, text/event-stream"),
            ("Mcp-Protocol-Version", "2026-07-28"),
            ("Mcp-Method", "tools/list"),
            ("Authorization", &bearer(&token)),
        ];
        let (status, _) = http(port, "POST", "/rpc", &headers, Some(MODERN_LIST));
        assert_eq!(status, 200);
        let (status, _) = http(port, "POST", "/mcp", &headers, Some(MODERN_LIST));
        assert_eq!(status, 404);
    }
}
