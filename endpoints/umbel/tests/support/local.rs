//! The local person page end to end (the Ideas host-review specification, section 6): a
//! workspace in mode `none` with `[person.local]` enabled, the `gate` plugin, its page served on a
//! loopback bind the test holds, and a browser on this machine.

use std::net::SocketAddr;

use afd::ManualClock;
use serde_json::{Value, json};
use umbel::testkit::mcp::{Stdio, command_result};
use umbel::{Host, HostBuilder};

use super::hosted::{Client, Reply};
use super::person::{Seen, plugin};

pub const FORM: &str = "application/x-www-form-urlencoded";

/// A workspace in mode `none` whose local page is enabled at `bind`, the stdio caller acting for
/// `ada`, with the `gate` plugin; `extra` is appended.
pub fn config(bind: SocketAddr, extra: &str) -> String {
    format!(
        "config_version = 7\n\n[principal]\non_behalf_of = \"ada\"\n\n[mcp]\nfirst_class_tools = [\"gate-approve\", \"gate-reject\"]\n\n[person.local]\nenabled = true\nbind = \"{bind}\"\n\n[plugins]\nenabled = [\"gate\"]\n{extra}"
    )
}

/// A local workspace, its host, and its local page served on its bind.
pub struct Local {
    pub dir: tempfile::TempDir,
    pub host: Host,
    pub seen: Seen,
    pub clock: ManualClock,
    pub bind: SocketAddr,
    pub page: Client,
}

impl Local {
    pub async fn start() -> Self {
        Self::start_with("").await
    }

    pub async fn start_with(extra: &str) -> Self {
        // The page's own listener, bound first so the bind is known and held.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let bind = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let dir = super::workspace(&config(bind, extra));
        let seen = Seen::default();
        let clock = afd::fixed_clock(1_800_000_000_000);
        let host = HostBuilder::open(dir.path())
            .unwrap()
            .with_compiled(plugin(&seen))
            .with_auth_clock(clock.clone())
            .seal()
            .unwrap();
        let server = host
            .local_person_server()
            .unwrap()
            .expect("the local page is served");
        let listener = tokio::net::TcpListener::from_std(listener).unwrap();
        tokio::spawn(server.serve(listener, std::future::pending()));
        let page = Client::plain(bind).with_host(&bind.to_string());
        Self {
            dir,
            host,
            seen,
            clock,
            bind,
            page,
        }
    }

    pub fn origin(&self) -> String {
        format!("http://{}", self.bind)
    }

    /// A stdio `tools/call` of `tool`, answered as a `CommandResult`, with AFD's own
    /// acknowledgement (`mcp.confirmations` is `enforce` by default), which grants nothing the
    /// plugin gate needs.
    pub async fn call(&self, tool: &str, arguments: Value) -> Value {
        let mut arguments = arguments;
        arguments["confirm"] = json!(true);
        let mut stdio = Stdio::connect(&self.host).await;
        let response = stdio
            .request(
                "tools/call",
                json!({ "name": tool, "arguments": arguments }),
            )
            .await;
        command_result(&response)
    }

    /// GET `path` on the page, as the browser on this machine opens a link.
    pub async fn open(&self, path: &str) -> Reply {
        self.page.get(path, &[("sec-fetch-site", "none")]).await
    }

    /// POST `body` to decision `id`'s form from the page's own origin.
    pub async fn post(&self, id: &str, body: &str) -> Reply {
        self.post_with(id, body, &[("origin", &self.origin())])
            .await
    }

    pub async fn post_with(&self, id: &str, body: &str, headers: &[(&str, &str)]) -> Reply {
        let mut all = vec![("content-type", FORM)];
        all.extend_from_slice(headers);
        self.page
            .send(
                self.page
                    .request("POST", &format!("/d/{id}"), &all, body.to_owned()),
            )
            .await
    }
}

/// The refusal's code and details.
pub fn refused(outcome: &Value) -> (String, Value) {
    assert_eq!(outcome["success"], false, "{outcome}");
    assert!(outcome["error"]["code"].is_string(), "{outcome}");
    (
        outcome["error"]["code"].as_str().unwrap().to_owned(),
        outcome["error"].clone(),
    )
}

/// The decision a `CONFIRMATION_REQUIRED` names.
pub fn decision_of(outcome: &Value) -> String {
    let (code, error) = refused(outcome);
    assert_eq!(code, "CONFIRMATION_REQUIRED", "{outcome}");
    error["details"]["decision"]
        .as_str()
        .unwrap_or_else(|| panic!("{outcome}"))
        .to_owned()
}

/// The value of the hidden input `name` on a rendered page.
pub fn hidden(page: &str, name: &str) -> String {
    let marker = format!("name=\"{name}\" value=\"");
    let start = page
        .find(&marker)
        .unwrap_or_else(|| panic!("no {name}: {page}"))
        + marker.len();
    page[start..start + page[start..].find('"').unwrap()].to_owned()
}

/// Decide `id` on the page: page 1 shown, then `action` posted from it with every item checked.
pub async fn decide(local: &Local, id: &str, action: &str) -> Reply {
    let shown = local.open(&format!("/d/{id}")).await;
    assert_eq!(shown.status, 200, "{}", shown.text);
    let csrf = hidden(&shown.text, "csrf");
    local
        .post(id, &format!("csrf={csrf}&page=1&decision={action}"))
        .await
}
