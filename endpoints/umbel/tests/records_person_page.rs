//! Standing decided on the person page (records host specification, sections 6.1 and 15.2), end
//! to end with the test identity provider: a decision on the person page for a
//! `mcp = "verified"` command affirms, recorded with the login's assurance; the same mark with
//! another input, under another command's name or with no command does not; and a person who is
//! not the space's decides nothing, however well proven.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;

use afd::ManualClock;
use serde_json::{Value, json};
use support::hosted::{Client, PUBLIC_URL, Served};
use support::oauth::{Setup, now_ms};
use support::person::{
    ORIGIN, REDIRECT, SECRET, accepted, asked, call, decide_as_at, follow, result,
};
use support::standing::plugin;
use umbel::{Host, HostBuilder};
use umbel_testkit_idp::{Client as KitClient, TestIdp};

const ROSES: &str = "Prune roses in late winter, before the buds swell.";
const SUN: &str = "Roses want morning sun.";

const REST: &str = r#"[plugins]
enabled = ["notes"]

[plugins.notes]
source = "compiled:notes"

[plugins.notes.grants.records_write]
allow = ["main"]
default_access = "space"

[plugins.notes.grants.documents_write]
allow = ["main/*"]
"#;

/// A served `oauth` workspace whose space `main` has the person `human:corp/ada`, with the
/// `notes` plugin, the kit's person login and a browser.
struct Page {
    kit: TestIdp,
    dir: tempfile::TempDir,
    _host: Host,
    _served: Served,
    client: Client,
    clock: ManualClock,
}

impl Page {
    async fn start() -> Self {
        let kit = TestIdp::start().await.unwrap();
        kit.identity_provider().register_client(
            KitClient::confidential("umbel-person-page", SECRET).redirect_uri(REDIRECT),
        );
        let setup = Setup {
            rest: REST,
            ..Setup::default()
        };
        // The hosted fixture's configuration, at version 6, with the space's one person.
        let config = support::oauth::config(&kit, &setup)
            .replace("config_version = 5", "config_version = 6")
            .replace(
                "[spaces.main]\n",
                "[spaces.main]\nperson = \"human:corp/ada\"\n",
            );
        assert!(config.contains("person = \"human:corp/ada\""), "{config}");
        let dir = support::workspace(&config);
        let clock = afd::fixed_clock(now_ms());
        follow(&kit, &clock);
        let host = support::oauth::host_with(
            dir.path(),
            &kit,
            Some(&clock),
            None,
            |builder: HostBuilder| {
                builder
                    .with_compiled(plugin())
                    .with_auth_secret("UMBEL_TEST_PERSON_SECRET", SECRET)
            },
        );
        host.check_person_logins().await;
        let served = Served::start(&host).await;
        let client = Client::plain(served.address);
        Self {
            kit,
            dir,
            _host: host,
            _served: served,
            client,
            clock,
        }
    }

    /// An access token for `subject`'s client.
    fn token(&self, subject: &str) -> String {
        self.kit
            .authorization_server()
            .access_token(PUBLIC_URL)
            .issued_at(afd::Clock::now(&self.clock).div_euclid(1000))
            .lifetime(300)
            .subject(subject)
            .scopes(["umbel:read", "umbel:write", "umbel:approve"])
            .sign()
    }

    /// Run `op` of a command no person decides, as `subject`'s agent.
    async fn plain(&self, subject: &str, command: &str, op: &str, args: Value) -> Value {
        let answer = call(
            &self.client,
            &self.token(subject),
            command,
            json!({ "op": op, "args": args }),
            json!({}),
            true,
        )
        .await;
        result(&answer)
    }

    /// Call `notes-verify` with `input` as `subject`'s agent, have `user` approve it on the
    /// person page, and answer what the decided call returned.
    async fn decided(&self, subject: &str, user: &str, input: Value) -> Value {
        let token = self.token(subject);
        let begun = call(
            &self.client,
            &token,
            "notes-verify",
            input.clone(),
            json!({}),
            true,
        )
        .await;
        let prompt = asked(&begun);
        let page = decide_as_at(
            &self.kit,
            &self.client,
            &prompt.path(),
            user,
            "approve",
            ORIGIN,
        )
        .await;
        assert_eq!(page.status, 200, "{}", page.text);
        assert!(page.text.contains("You approved"), "{}", page.text);
        let answer = call(
            &self.client,
            &token,
            "notes-verify",
            input,
            accepted(&prompt.state),
            true,
        )
        .await;
        result(&answer)
    }

    async fn label(&self, id: &str) -> Value {
        let read = self
            .plain("ada", "notes-read", "read", json!({ "id": id }))
            .await;
        assert_eq!(read["success"], true, "{read}");
        read["data"]["result"]["dev.umbel/standing"].clone()
    }
}

fn count(dir: &Path, sql: &str) -> i64 {
    rusqlite::Connection::open(dir.join("state/spaces/main/store/store.sqlite3"))
        .unwrap()
        .query_row(sql, [], |row| row.get(0))
        .unwrap()
}

#[tokio::test]
async fn a_decision_on_the_person_page_affirms_and_the_same_mark_with_another_input_does_not() {
    let page = Page::start().await;
    for (id, statement) in [("n1", ROSES), ("another", SUN)] {
        let body = json!({ "statement": statement, "bed": "north" });
        let put = page
            .plain(
                "ada",
                "notes-write",
                "put",
                json!({ "id": id, "body": body }),
            )
            .await;
        assert_eq!(put["success"], true, "{put}");
    }
    // Over MCP, a command nobody decides cannot decide, whoever its agent acts for.
    let ungated = page
        .plain("ada", "notes-write", "affirm", json!({ "id": "n1" }))
        .await;
    assert!(
        ungated["error"]["message"]
            .as_str()
            .unwrap()
            .contains("RECORD_DECISION_NOT_GATED"),
        "{ungated}"
    );

    // The person decides `notes-verify` for this input, and its handler then asks the host
    // for services as itself with another input, as another command, and with no command:
    // the mark the call carries is for none of those.
    for via in ["other-input", "other", "nested"] {
        let refused = page
            .decided(
                "ada",
                "ada",
                json!({ "op": "affirm", "id": "n1", "via": via }),
            )
            .await;
        assert_eq!(refused["success"], false, "{via}: {refused}");
        assert!(
            refused["error"]["message"]
                .as_str()
                .unwrap()
                .contains("RECORD_DECISION_NOT_GATED"),
            "{via}: {refused}"
        );
    }
    for id in ["n1", "another"] {
        assert_eq!(page.label(id).await["standing"], "unverified", "{id}");
    }
    assert_eq!(
        count(page.dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        0
    );

    // Decided for this very call, it affirms, and records how the person was proven.
    let affirmed = page
        .decided("ada", "ada", json!({ "op": "affirm", "id": "n1" }))
        .await;
    assert_eq!(affirmed["success"], true, "{affirmed}");
    let label = affirmed["data"]["result"].clone();
    assert_eq!(label["standing"], "affirmed");
    assert_eq!(label["affirmed"]["by"], "human:corp/ada");
    let assurance = &label["affirmed"]["assurance"];
    assert_eq!(assurance["level"], "verified");
    assert_eq!(assurance["method"], "person-page");
    assert_eq!(assurance["namespace"], "corp");
    assert_eq!(assurance["acr"], "phr");
    assert!(assurance["authTime"].is_string(), "{assurance}");
    assert_eq!(page.label("n1").await, label);
    assert_eq!(page.label("another").await["standing"], "unverified");
    // Another reader of the record, who is neither the operator nor the space's person, sees
    // that it is affirmed, when and at what level: not who, and nothing of the login.
    let read = page
        .plain("bo", "notes-read", "read", json!({ "id": "n1" }))
        .await;
    let other = read["data"]["result"]["dev.umbel/standing"].clone();
    assert_eq!(other["standing"], "affirmed", "{read}");
    assert_eq!(
        other["affirmed"],
        json!({ "by": null, "at": label["affirmed"]["at"], "assurance": { "level": "verified" } })
    );
    let found = page.plain("bo", "notes-read", "find", json!({})).await;
    assert_eq!(found["success"], true, "{found}");
    // The labels of a find, that is: the records' own envelopes name their writer, as they
    // always have.
    let labels: Vec<Value> = found["data"]["result"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["dev.umbel/standing"].clone())
        .collect();
    assert!(labels.contains(&other), "{labels:?}");
    let text = json!(labels).to_string();
    for secret in [
        "corp/ada",
        "phr",
        "person-page",
        assurance["authTime"].as_str().unwrap(),
    ] {
        assert!(
            !text.contains(secret),
            "{secret} is shown to another reader: {text}"
        );
    }
    assert_eq!(
        count(page.dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        1
    );
    // The decision is one `standing` change. A hosted caller's result shows no revisions
    // (they are sealed), so the store says it.
    assert_eq!(
        count(
            page.dir.path(),
            "SELECT COUNT(*) FROM changes WHERE kind = 'standing'"
        ),
        1
    );
}

#[tokio::test]
async fn a_verified_person_who_is_not_the_spaces_decides_nothing() {
    let page = Page::start().await;
    let body = json!({ "statement": ROSES, "bed": "north" });
    let put = page
        .plain(
            "ada",
            "notes-write",
            "put",
            json!({ "id": "n1", "body": body }),
        )
        .await;
    assert_eq!(put["success"], true, "{put}");
    // `corp/bo` is proven on the person page, for this very call, and is not the space's
    // person: the gate's proof says a person decided, not that the person is the one whose
    // decisions give standing here.
    let by_bo = page
        .decided("bo", "bo", json!({ "op": "affirm", "id": "n1" }))
        .await;
    assert_eq!(by_bo["success"], false, "{by_bo}");
    assert!(
        by_bo["error"]["message"].as_str().unwrap().contains(
            "RECORD_DECISION_NOT_THE_PERSON: only the space's person decides standing here"
        ),
        "{by_bo}"
    );
    assert_eq!(page.label("n1").await["standing"], "unverified");
    assert_eq!(
        count(page.dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        0
    );
    // The space's person, for the same call, does.
    let by_ada = page
        .decided("ada", "ada", json!({ "op": "affirm", "id": "n1" }))
        .await;
    assert_eq!(
        by_ada["data"]["result"]["affirmed"]["by"], "human:corp/ada",
        "{by_ada}"
    );
}
