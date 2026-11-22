//! P6-D7's bridge, run as the real binary (phase 6 specification, 10.8): `loam-desktop mcp` against the inbound
//! endpoint served in this process over a data directory of its own, with a kernel that answers each request. The
//! desktop suite runs the same against the running app; this proves the bridge's own rules on every platform's
//! `cargo test`: the round trip, the re-read after a restart, the answer when the app is closed, `--print-connection`,
//! and the owner-only rule.
use loam_desktop::connection::{self, Connection};
use loam_desktop::inbound::{self, Deliver, Inbound};
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

/// The endpoint on `port` (0 for a free one), its kernel echoing each request's method, and `inbound.json` written for
/// it with this process's id, so the bridge finds a running desktop.
fn serve(runtime: &tokio::runtime::Runtime, data: &Path, port: u16) -> (u16, watch::Sender<bool>) {
    // The same port when asked, as a restart may get; where the system holds it a moment longer, a new one.
    let listener = runtime
        .block_on(tokio::net::TcpListener::bind(("127.0.0.1", port)))
        .or_else(|_| runtime.block_on(tokio::net::TcpListener::bind(("127.0.0.1", 0))))
        .expect("a listener");
    let port = listener.local_addr().unwrap().port();
    let token = inbound::token();
    let held: Arc<Mutex<Option<Arc<Inbound>>>> = Arc::new(Mutex::new(None));
    let deliver: Deliver = {
        let held = held.clone();
        let handle = runtime.handle().clone();
        Arc::new(move |statement: String| {
            // `{detail:JSON.parse("<the detail's JSON>")}`, as the page reads it.
            let start =
                statement.find("{detail:JSON.parse(").unwrap() + "{detail:JSON.parse(".len();
            let text: String =
                serde_json::from_str(&statement[start..statement.len() - 4]).unwrap();
            let detail: Value = serde_json::from_str(&text).unwrap();
            let Some(id) = detail["id"].as_u64() else {
                return;
            };
            let message = &detail["message"];
            let reply = json!({ "jsonrpc": "2.0", "id": message["id"], "result": { "method": message["method"] } });
            let endpoint = held.lock().unwrap().clone().unwrap();
            handle.spawn(async move { endpoint.reply(id, &reply) });
        })
    };
    let endpoint = Inbound::new(port, &token, deliver);
    assert!(endpoint.set_ready());
    *held.lock().unwrap() = Some(endpoint.clone());
    let (stop, stopped) = watch::channel(false);
    runtime.spawn(inbound::serve(listener, endpoint, stopped));
    connection::write(data, &Connection::new(port, token)).expect("inbound.json");
    (port, stop)
}

struct Bridge {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Bridge {
    fn start(data: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_loam-desktop"))
            .arg("mcp")
            .env("LOAM_DESKTOP_DATA_DIR", data)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the bridge");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Self {
            child,
            stdin,
            stdout,
        }
    }

    fn send(&mut self, message: Value) {
        writeln!(self.stdin, "{message}").unwrap();
        self.stdin.flush().unwrap();
    }

    fn answer(&mut self) -> Value {
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        assert!(line.ends_with('\n'), "one line per answer: {line:?}");
        serde_json::from_str(&line).unwrap()
    }

    fn answer_to(&mut self, message: Value) -> Value {
        self.send(message);
        self.answer()
    }

    fn finish(self) -> (i32, String) {
        drop(self.stdin);
        let output = self.child.wait_with_output().unwrap();
        (
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        )
    }
}

fn request(id: u64, method: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method })
}

#[test]
fn p6_d7_the_bridge_round_trips_re_reads_after_a_restart_and_answers_when_the_app_is_closed() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let data = tempfile::tempdir().unwrap();
    let (port, stop) = serve(&runtime, data.path(), 0);

    let mut bridge = Bridge::start(data.path());
    bridge.send(request(1, "initialize"));
    assert_eq!(
        bridge.answer(),
        json!({ "jsonrpc": "2.0", "id": 1, "result": { "method": "initialize" } })
    );
    // A notification has no answer: the next line is the next request's.
    bridge.send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
    bridge.send(request(2, "tools/list"));
    assert_eq!(bridge.answer()["result"]["method"], "tools/list");

    // The app restarts: a new token, on the same port where it can be had. The bridge's token is refused, or its port
    // is closed, once; it reads the file again, and goes on.
    let _ = stop.send(true);
    std::thread::sleep(std::time::Duration::from_millis(100));
    let (_, stop) = serve(&runtime, data.path(), port);
    bridge.send(request(3, "tools/call"));
    assert_eq!(bridge.answer()["result"]["method"], "tools/call");

    // A line that is not JSON is answered, and the bridge goes on.
    writeln!(bridge.stdin, "not json").unwrap();
    assert_eq!(bridge.answer()["error"]["code"], -32700);

    // The app closes: its file goes and nothing listens. The next request is answered with the code, and the bridge
    // exits non-zero.
    let _ = stop.send(true);
    connection::remove(data.path());
    bridge.send(request(4, "ping"));
    let answer = bridge.answer();
    assert_eq!(answer["id"], 4);
    assert_eq!(
        answer["error"]["data"]["code"],
        "DESKTOP_INBOUND_UNAVAILABLE"
    );
    assert_eq!(
        answer["error"]["data"]["suggestion"],
        "Open Loam, then retry"
    );
    let (code, stderr) = bridge.finish();
    assert_ne!(code, 0);
    assert!(stderr.contains("DESKTOP_INBOUND_UNAVAILABLE"));
}

#[test]
fn p6_d7_with_the_app_closed_the_first_request_is_answered_and_the_bridge_exits_non_zero() {
    let data = tempfile::tempdir().unwrap();
    let mut bridge = Bridge::start(data.path());
    bridge.send(request(7, "initialize"));
    let answer = bridge.answer();
    assert_eq!(answer["id"], 7);
    assert_eq!(
        answer["error"]["data"]["code"],
        "DESKTOP_INBOUND_UNAVAILABLE"
    );
    assert_ne!(bridge.finish().0, 0);
}

#[test]
fn p6_d7_print_connection_prints_the_url_and_this_runs_header() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let data = tempfile::tempdir().unwrap();
    let print = || {
        Command::new(env!("CARGO_BIN_EXE_loam-desktop"))
            .args(["mcp", "--print-connection"])
            .env("LOAM_DESKTOP_DATA_DIR", data.path())
            .output()
            .unwrap()
    };
    let closed = print();
    assert_ne!(closed.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&closed.stderr).contains("DESKTOP_INBOUND_UNAVAILABLE"));
    let (port, _stop) = serve(&runtime, data.path(), 0);
    let output = print();
    assert_eq!(output.status.code(), Some(0));
    let token = connection::read(data.path()).unwrap().token;
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        format!("http://127.0.0.1:{port}/mcp\nAuthorization: Bearer {token}\n")
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let path = data.path().join(connection::FILE);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let refused = print();
        assert_ne!(refused.status.code(), Some(0));
        assert!(refused.stdout.is_empty());
        assert!(String::from_utf8_lossy(&refused.stderr).contains("DESKTOP_INBOUND_PERMISSIONS"));
    }
}

#[test]
fn p6_d7_a_message_that_may_have_reached_loam_is_never_sent_again() {
    use std::io::Read;
    let data = tempfile::tempdir().unwrap();
    // A listener that reads each request and closes the connection without an answer, counting them.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(0usize));
    let counted = seen.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut buffer = [0u8; 4096];
            let _ = stream.read(&mut buffer);
            *counted.lock().unwrap() += 1;
            drop(stream);
        }
    });
    connection::write(data.path(), &Connection::new(port, "t".into())).unwrap();
    let mut bridge = Bridge::start(data.path());
    bridge.send(request(1, "tools/call"));
    let answer = bridge.answer();
    assert_eq!(answer["id"], 1);
    assert!(
        answer["error"]["message"]
            .as_str()
            .unwrap()
            .contains("may have run")
    );
    assert_eq!(*seen.lock().unwrap(), 1, "sent once, never again");
    assert_eq!(bridge.finish().0, 0);
}

#[test]
fn p6_d7_once_inbound_json_is_gone_no_line_is_sent_to_its_port() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let data = tempfile::tempdir().unwrap();
    let (_port, _stop) = serve(&runtime, data.path(), 0);
    let mut bridge = Bridge::start(data.path());
    assert_eq!(
        bridge.answer_to(request(1, "ping"))["result"]["method"],
        "ping"
    );
    // Loam exited and its port may be another program's now: the endpoint is still listening here, and must hear nothing.
    connection::remove(data.path());
    let answer = bridge.answer_to(request(2, "ping"));
    assert_eq!(
        answer["error"]["data"]["code"],
        "DESKTOP_INBOUND_UNAVAILABLE"
    );
    assert_ne!(bridge.finish().0, 0);
}
