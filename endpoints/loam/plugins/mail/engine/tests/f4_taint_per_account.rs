//! Step F4 (taint per account, M36 / plugin.spec.md section 10, F-T11):
//! per-account policy overrides (`mail-policy-set { account, reset }`,
//! `mail-policy-show`), single-account enforcement for non-human callers
//! (`SELECTION_SPANS_ACCOUNTS`) on changes, resumes and undos whether or not
//! any account is guarded, and per-account `trashPerDay` accounting.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;
use std::time::Duration;

use afd::{Actor, ActorKind, CommandContext, CommandInterface, CommandRegistry};
use async_trait::async_trait;
use loam_mail::cli::{Caller, EXIT_OK, run};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::operate::ChangeOptions;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, ImapConnector};
use loam_mail::provider::{Connector, Provider, ProviderError};
use loam_mail::secrets::InMemory;
use loam_mail::store::{AccountId, AccountRow, ItemStep, Policy, Step};
use loam_mail::sync::{Options, sync_account};
use serde_json::{Value, json};
use support::imap::{PASSWORD, Server, USER};
use support::synced::{Scripted, mail};

const WORK: &str = "work@example.com";
const PERSONAL: &str = "personal@example.com";
const SENDER: &str = "Sender <sender@example.org>";

struct Two {
    work: ImapConnector,
    personal: ImapConnector,
}

fn connector(server: &Server) -> ImapConnector {
    ImapConnector::new(
        Endpoint {
            host: "127.0.0.1".to_string(),
            port: server.address.port(),
            tls: false,
        },
        ICLOUD_NAMES,
        |_| {
            Ok(Credentials {
                user: USER.to_string(),
                password: PASSWORD.to_string(),
            })
        },
    )
}

#[async_trait]
impl Connector for Two {
    async fn connect(&self, account: &AccountRow) -> Result<Box<dyn Provider>, ProviderError> {
        if account.address == WORK {
            self.work.connect(account).await
        } else {
            self.personal.connect(account).await
        }
    }
}

struct TwoAccountFixture {
    _directory: tempfile::TempDir,
    work_server: Server,
    personal_server: Server,
    engine: Arc<Engine>,
    registry: Arc<CommandRegistry>,
    work: AccountRow,
    personal: AccountRow,
}

impl TwoAccountFixture {
    fn new() -> Self {
        let work_server = Server::start(true, true);
        let personal_server = Server::start(true, true);
        for (server, prefix) in [(&work_server, "w"), (&personal_server, "p")] {
            let mut world = server.world();
            world.mailbox("INBOX", &[]);
            world.mailbox("Archive", &["\\Archive"]);
            world.mailbox("Deleted Messages", &["\\Trash"]);
            for i in 0..4 {
                world.add("INBOX", mail(SENDER, &format!("{prefix}{i}"), ""), &[]);
            }
        }
        let directory = tempfile::tempdir().unwrap();
        let home = Home::at(directory.path().join("data"));
        let engine = Arc::new(
            Engine::new(Some(home))
                .with_connector(Arc::new(Two {
                    work: connector(&work_server),
                    personal: connector(&personal_server),
                }))
                .with_sync_options(Options {
                    backoff: Duration::ZERO,
                    ..Options::default()
                })
                .with_change_options(ChangeOptions {
                    batch: 1,
                    ..ChangeOptions::default()
                }),
        );
        let (work, personal) = engine
            .with_store(|store| {
                let w_id = store.add_account("icloud", WORK, 0)?;
                let p_id = store.add_account("icloud", PERSONAL, 0)?;
                let accounts = store.accounts()?;
                let work = accounts.iter().find(|a| a.id == w_id).unwrap().clone();
                let personal = accounts.iter().find(|a| a.id == p_id).unwrap().clone();
                Ok((work, personal))
            })
            .unwrap();
        let registry = loam_mail::registry(&engine).unwrap();
        let fixture = Self {
            _directory: directory,
            work_server,
            personal_server,
            engine,
            registry,
            work,
            personal,
        };
        fixture.sync(&fixture.work);
        fixture.sync(&fixture.personal);
        fixture
    }

    fn sync(&self, account: &AccountRow) {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let connector = Arc::clone(self.engine.connector().unwrap());
        runtime
            .block_on(sync_account(
                &self.engine,
                connector.as_ref(),
                account,
                self.engine.sync_options(),
                &afd::SystemClock,
                &|_| {},
            ))
            .unwrap();
    }

    fn execute(&self, name: &str, input: Value, context: CommandContext) -> Value {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(self.registry.execute(name, input, Some(context)));
        serde_json::to_value(&result).unwrap()
    }

    fn agent(&self, token: &str, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Mcp)
            .with_actor(Actor::new(ActorKind::Agent).with_id(token));
        self.execute(name, input, context)
    }

    fn script(&self, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Script);
        self.execute(name, input, context)
    }

    fn person(&self, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human);
        self.execute(name, input, context)
    }

    fn person_cli_yes(&self, args: &[&str]) -> (u8, String, String, Vec<String>) {
        let args: Vec<String> = args.iter().map(ToString::to_string).collect();
        let mut out = Vec::new();
        let mut err = Vec::new();
        let mut person = Scripted {
            approve: true,
            asked: Vec::new(),
            typed: std::collections::VecDeque::new(),
        };
        let status = run(
            &args,
            &self.registry,
            Caller::Terminal(&mut person),
            &InMemory::default(),
            &mut out,
            &mut err,
        )
        .unwrap();
        (
            status,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
            person.asked,
        )
    }

    fn message(&self, word: &str) -> i64 {
        let found = self.person("mail-search", json!({ "query": word }));
        assert_eq!(found["success"], true, "{found}");
        found["data"]["hits"][0]["message"].as_i64().unwrap()
    }

    fn select(&self, query: Value) -> (i64, i64) {
        let made = self.agent("a", "mail-selection-create", query);
        assert_eq!(made["success"], true, "{made}");
        (
            made["data"]["selection"].as_i64().unwrap(),
            made["data"]["count"].as_i64().unwrap(),
        )
    }

    fn provider_mutated(server: &Server) -> bool {
        server.take_log().iter().any(|line| {
            [
                "UID COPY",
                "UID MOVE",
                "UID STORE",
                "UID EXPUNGE",
                "EXPUNGE",
            ]
            .iter()
            .any(|cmd| line.starts_with(cmd))
        })
    }
}

#[test]
fn non_human_change_spanning_two_accounts_is_refused_even_when_neither_is_guarded() {
    let fixture = TwoAccountFixture::new();
    let w0 = fixture.message("w0");
    let p0 = fixture.message("p0");

    // Neither account has a per-account override yet.
    let shown = fixture.agent("a", "mail-policy-show", json!({}));
    assert_eq!(shown["success"], true, "{shown}");
    assert_eq!(shown["data"]["accounts"], json!([]));

    let _ = fixture.work_server.take_log();
    let _ = fixture.personal_server.take_log();

    let work_archive = fixture
        .engine
        .with_store(|store| {
            let mailboxes = store.mailboxes(fixture.work.id)?;
            Ok(mailboxes
                .iter()
                .find(|m| m.role == loam_mail::store::Role::Archive)
                .unwrap()
                .id
                .0)
        })
        .unwrap();

    // Agent change via explicit messages spanning both accounts -> SELECTION_SPANS_ACCOUNTS.
    for (cmd, extra) in [
        ("mail-archive", json!({})),
        ("mail-label", json!({ "mailbox": work_archive })),
        ("mail-mark", json!({ "read": true })),
        ("mail-trash", json!({})),
    ] {
        let mut input = json!({ "messages": [w0, p0] });
        if let Some(obj) = extra.as_object() {
            for (k, v) in obj {
                input[k] = v.clone();
            }
        }
        let refused = fixture.agent("a", cmd, input.clone());
        assert_eq!(refused["success"], false, "{cmd}: {refused}");
        assert_eq!(
            refused["error"]["code"], "SELECTION_SPANS_ACCOUNTS",
            "{cmd}: {refused}"
        );
        assert_eq!(refused["error"]["retryable"], false, "{cmd}: {refused}");
        assert_eq!(
            refused["error"]["suggestion"], "Make one selection per account.",
            "{cmd}: {refused}"
        );

        // Script caller is refused the same way.
        let script_refused = fixture.script(cmd, input);
        assert_eq!(
            script_refused["error"]["code"], "SELECTION_SPANS_ACCOUNTS",
            "script {cmd}: {script_refused}"
        );
    }

    // Agent change via a selection spanning both accounts -> SELECTION_SPANS_ACCOUNTS.
    let (selection, count) = fixture.select(json!({ "unread": true }));
    assert!(count >= 2, "selection should cover both accounts");
    let sel_refused = fixture.agent(
        "a",
        "mail-archive",
        json!({ "selection": selection, "expectedCount": count }),
    );
    assert_eq!(sel_refused["success"], false, "{sel_refused}");
    assert_eq!(sel_refused["error"]["code"], "SELECTION_SPANS_ACCOUNTS");

    assert!(
        !TwoAccountFixture::provider_mutated(&fixture.work_server),
        "work provider untouched"
    );
    assert!(
        !TwoAccountFixture::provider_mutated(&fixture.personal_server),
        "personal provider untouched"
    );

    // Human caller spanning both accounts succeeds.
    let human_mark = fixture.person("mail-mark", json!({ "messages": [w0, p0], "read": true }));
    assert_eq!(human_mark["success"], true, "{human_mark}");
    assert_eq!(human_mark["data"]["state"], "done");
}

#[test]
fn guarded_account_requires_proposal_while_other_account_keeps_defaults_and_reset_restores() {
    let fixture = TwoAccountFixture::new();
    let w0 = fixture.message("w0");
    let w1 = fixture.message("w1");
    let p0 = fixture.message("p0");

    // Set work account limits to 0 through the terminal approval flow.
    let work_arg = fixture.work.id.0.to_string();
    let payload = json!({
        "account": fixture.work.id.0,
        "changePerCall": 0,
        "trashPerCall": 0,
        "trashPerDay": 0,
    })
    .to_string();
    let (status, out, err, _asked) = fixture.person_cli_yes(&["mail-policy-set", &payload]);
    assert_eq!(status, EXIT_OK, "out={out}\nerr={err}");
    assert!(
        err.contains(&format!("account {work_arg}")),
        "approval summary should name account id: {err}"
    );
    assert!(
        !err.contains(WORK) && !err.contains("sender@"),
        "approval summary must not contain addresses or mail content: {err}"
    );

    // mail-policy-show reports global defaults plus the work override.
    let all = fixture.agent("a", "mail-policy-show", json!({}));
    assert_eq!(all["success"], true, "{all}");
    assert_eq!(
        all["data"]["policy"]["changePerCall"],
        Policy::DEFAULT.change_per_call
    );
    assert_eq!(all["data"]["accounts"].as_array().unwrap().len(), 1);
    assert_eq!(all["data"]["accounts"][0]["account"], fixture.work.id.0);
    assert_eq!(all["data"]["accounts"][0]["policy"]["changePerCall"], 0);
    assert_eq!(all["data"]["accounts"][0]["policy"]["trashPerCall"], 0);
    assert_eq!(all["data"]["accounts"][0]["policy"]["trashPerDay"], 0);
    assert_eq!(
        all["data"]["accounts"][0]["policy"]["askAbove"],
        Policy::DEFAULT.ask_above
    );
    assert_eq!(
        all["data"]["accounts"][0]["overrides"],
        json!({ "changePerCall": 0, "trashPerCall": 0, "trashPerDay": 0 })
    );

    // Per-account show for work vs personal vs unknown.
    let work_show = fixture.agent(
        "a",
        "mail-policy-show",
        json!({ "account": fixture.work.id.0 }),
    );
    assert_eq!(work_show["data"]["policy"]["changePerCall"], 0);
    let personal_show = fixture.agent(
        "a",
        "mail-policy-show",
        json!({ "account": fixture.personal.id.0 }),
    );
    assert_eq!(
        personal_show["data"]["policy"]["changePerCall"],
        Policy::DEFAULT.change_per_call
    );
    assert_eq!(personal_show["data"]["overrides"], json!({}));
    let missing = fixture.agent("a", "mail-policy-show", json!({ "account": 9999 }));
    assert_eq!(missing["error"]["code"], "ACCOUNT_NOT_FOUND");

    let _ = fixture.work_server.take_log();
    let _ = fixture.personal_server.take_log();

    // Agent change of 1 message in guarded work account becomes a proposal; nothing asked of provider.
    let work_prop = fixture.agent("a", "mail-archive", json!({ "messages": [w0] }));
    assert_eq!(work_prop["success"], true, "{work_prop}");
    assert_eq!(work_prop["data"]["state"], "proposed", "{work_prop}");
    assert!(
        !TwoAccountFixture::provider_mutated(&fixture.work_server),
        "guarded account must not touch provider on proposal"
    );

    // Agent change of 1 message in unguarded personal account runs immediately.
    let personal_run = fixture.agent("a", "mail-archive", json!({ "messages": [p0] }));
    assert_eq!(personal_run["success"], true, "{personal_run}");
    assert_eq!(personal_run["data"]["state"], "done", "{personal_run}");
    assert!(
        TwoAccountFixture::provider_mutated(&fixture.personal_server),
        "unguarded account should execute within default policy"
    );

    // Invalid reset inputs are refused before approval.
    let bad_reset_no_acc = fixture.person("mail-policy-set", json!({ "reset": true }));
    assert_eq!(bad_reset_no_acc["error"]["code"], "INVALID_INPUT");
    let bad_reset_with_limit = fixture.person(
        "mail-policy-set",
        json!({ "account": fixture.work.id.0, "reset": true, "changePerCall": 10 }),
    );
    assert_eq!(bad_reset_with_limit["error"]["code"], "INVALID_INPUT");

    // Reset work account policy back to defaults.
    let reset_payload = json!({ "account": fixture.work.id.0, "reset": true }).to_string();
    let (status, out, err, _) = fixture.person_cli_yes(&["mail-policy-set", &reset_payload]);
    assert_eq!(status, EXIT_OK, "out={out}\nerr={err}");

    let after_reset = fixture.agent("a", "mail-policy-show", json!({}));
    assert_eq!(after_reset["data"]["accounts"], json!([]));

    // Now an agent can archive 1 message in work immediately.
    let work_run = fixture.agent("a", "mail-archive", json!({ "messages": [w1] }));
    assert_eq!(work_run["success"], true, "{work_run}");
    assert_eq!(work_run["data"]["state"], "done", "{work_run}");
}

#[test]
fn non_human_resume_and_undo_spanning_accounts_are_refused_and_guarded_single_account_proposes() {
    let fixture = TwoAccountFixture::new();
    let w0 = fixture.message("w0");
    let w1 = fixture.message("w1");
    let p0 = fixture.message("p0");
    let p1 = fixture.message("p1");

    // 1. Human runs a multi-account mark to completion.
    let multi_done = fixture.person("mail-mark", json!({ "messages": [w0, p0], "read": true }));
    assert_eq!(multi_done["success"], true, "{multi_done}");
    assert_eq!(multi_done["data"]["state"], "done");
    let multi_op = multi_done["data"]["operation"].as_i64().unwrap();

    // Agent undo on multi-account operation -> SELECTION_SPANS_ACCOUNTS.
    let agent_undo = fixture.agent("a", "mail-operation-undo", json!({ "operation": multi_op }));
    assert_eq!(agent_undo["success"], false, "{agent_undo}");
    assert_eq!(agent_undo["error"]["code"], "SELECTION_SPANS_ACCOUNTS");
    assert_eq!(
        agent_undo["error"]["suggestion"],
        "Make one selection per account."
    );

    // Human undo on multi-account operation -> succeeds.
    let human_undo = fixture.person("mail-operation-undo", json!({ "operation": multi_op }));
    assert_eq!(human_undo["success"], true, "{human_undo}");
    assert_eq!(human_undo["data"]["state"], "done");

    // 2. Human starts a multi-account mark while both servers are down, leaving it stopped
    // with open items across both accounts.
    fixture.work_server.world().down = true;
    fixture.personal_server.world().down = true;
    let stopped_multi = fixture.person(
        "mail-mark",
        json!({ "messages": [w1, p1], "flagged": true }),
    );
    fixture.work_server.world().down = false;
    fixture.personal_server.world().down = false;
    assert_eq!(stopped_multi["success"], false, "{stopped_multi}");
    let stopped_op = stopped_multi["error"]["details"]["operation"]
        .as_i64()
        .expect("stopped operation id in error details");

    // Agent resume of multi-account stopped op -> SELECTION_SPANS_ACCOUNTS.
    let agent_resume = fixture.agent(
        "a",
        "mail-operation-resume",
        json!({ "operation": stopped_op }),
    );
    assert_eq!(agent_resume["success"], false, "{agent_resume}");
    assert_eq!(agent_resume["error"]["code"], "SELECTION_SPANS_ACCOUNTS");

    // Human resume succeeds.
    let human_resume = fixture.person("mail-operation-resume", json!({ "operation": stopped_op }));
    assert_eq!(human_resume["success"], true, "{human_resume}");
    assert_eq!(human_resume["data"]["state"], "done");

    // 3. Guard work account (all 0) and verify single-account undo and resume become proposals.
    let guard_payload = json!({
        "account": fixture.work.id.0,
        "changePerCall": 0,
        "trashPerCall": 0,
        "trashPerDay": 0,
    })
    .to_string();
    let (status, _, _, _) = fixture.person_cli_yes(&["mail-policy-set", &guard_payload]);
    assert_eq!(status, EXIT_OK);

    // Single-account human mark on work, then agent undo -> proposed.
    let work_done = fixture.person("mail-mark", json!({ "messages": [w0], "flagged": true }));
    assert_eq!(work_done["data"]["state"], "done");
    let work_op = work_done["data"]["operation"].as_i64().unwrap();
    let undo_prop = fixture.agent("a", "mail-operation-undo", json!({ "operation": work_op }));
    assert_eq!(undo_prop["success"], true, "{undo_prop}");
    assert_eq!(undo_prop["data"]["state"], "proposed", "{undo_prop}");

    // Single-account stopped op on work, then agent resume -> proposed.
    fixture.work_server.world().down = true;
    let work_stopped = fixture.person("mail-mark", json!({ "messages": [w1], "read": true }));
    fixture.work_server.world().down = false;
    assert_eq!(work_stopped["success"], false);
    let work_stopped_op = work_stopped["error"]["details"]["operation"]
        .as_i64()
        .unwrap();
    let resume_prop = fixture.agent(
        "a",
        "mail-operation-resume",
        json!({ "operation": work_stopped_op }),
    );
    assert_eq!(resume_prop["success"], true, "{resume_prop}");
    assert_eq!(resume_prop["data"]["state"], "proposed", "{resume_prop}");
}

#[test]
fn per_account_trash_per_day_override_and_account_removal_cleanup() {
    let fixture = TwoAccountFixture::new();
    let p0 = fixture.message("p0");
    let p1 = fixture.message("p1");
    let w0 = fixture.message("w0");

    // Stateless invalid inputs (bad reset combinations, non-positive account) refuse without prompting.
    for bad_shape in [
        json!({ "reset": true }),
        json!({ "account": fixture.personal.id.0, "reset": true, "changePerCall": 10 }),
        json!({ "account": 0, "changePerCall": 10 }),
        json!({ "account": fixture.personal.id.0, "trashPerCall": 300, "trashPerDay": 200 }),
    ] {
        let payload = bad_shape.to_string();
        let (st, out, _, asked) = fixture.person_cli_yes(&["mail-policy-set", &payload]);
        assert_ne!(st, EXIT_OK, "{bad_shape}: {out}");
        assert!(out.contains("INVALID_INPUT"), "{bad_shape}: {out}");
        assert!(
            asked.is_empty(),
            "stateless invalid input must refuse without prompting: {bad_shape} -> {asked:?}"
        );
    }

    // Store-dependent invalid inputs are held with a truthful "nothing will change" preview
    // (preserving the stateless-approval invariant in tests/selections.rs) and refused.
    let too_low = json!({
        "account": fixture.personal.id.0,
        "trashPerDay": 1,
    })
    .to_string();
    let (bad_status, bad_out, bad_err, _) = fixture.person_cli_yes(&["mail-policy-set", &too_low]);
    assert_ne!(bad_status, EXIT_OK);
    assert!(bad_out.contains("INVALID_INPUT"), "{bad_out}");
    assert!(bad_err.contains("cannot be set as given"), "{bad_err}");

    let missing_acc = json!({ "account": 9999, "changePerCall": 10 }).to_string();
    let (miss_status, miss_out, miss_err, _) =
        fixture.person_cli_yes(&["mail-policy-set", &missing_acc]);
    assert_ne!(miss_status, EXIT_OK);
    assert!(miss_out.contains("ACCOUNT_NOT_FOUND"), "{miss_out}");
    assert!(miss_err.contains("ACCOUNT_NOT_FOUND"), "{miss_err}");

    // Set personal trashPerCall = 1 and trashPerDay = 1.
    let payload = json!({
        "account": fixture.personal.id.0,
        "trashPerCall": 1,
        "trashPerDay": 1,
    })
    .to_string();
    let (status, out, err, _) = fixture.person_cli_yes(&["mail-policy-set", &payload]);
    assert_eq!(status, EXIT_OK, "out={out}\nerr={err}");

    // First trash in personal succeeds immediately.
    let first = fixture.agent("a", "mail-trash", json!({ "messages": [p0] }));
    assert_eq!(first["success"], true, "{first}");
    assert_eq!(first["data"]["state"], "done", "{first}");

    // Second trash in personal exceeds personal's trashPerDay = 1 -> proposed.
    let second = fixture.agent("a", "mail-trash", json!({ "messages": [p1] }));
    assert_eq!(second["success"], true, "{second}");
    assert_eq!(second["data"]["state"], "proposed", "{second}");

    // Work account still has default trashPerDay (50), so trashing in work succeeds immediately.
    let work_trash = fixture.agent("a", "mail-trash", json!({ "messages": [w0] }));
    assert_eq!(work_trash["success"], true, "{work_trash}");
    assert_eq!(work_trash["data"]["state"], "done", "{work_trash}");

    // Removing the personal account cleans up its account_policy row without FK failure.
    let personal_id = fixture.personal.id;
    let secrets = InMemory::default();
    let _ = secrets; // ensures InMemory import stays cleanly exercised if needed
    let removed = fixture
        .engine
        .with_store(|store| store.remove_account(personal_id, 100));
    assert!(removed.is_ok(), "remove_account failed: {removed:?}");

    let remaining = fixture
        .engine
        .with_store(|store| store.account_policy(AccountId(personal_id.0)))
        .unwrap();
    assert!(remaining.is_none());
}

#[test]
fn clamped_override_revalidation_and_per_account_ask_above_and_inherited_daily_trash_and_resume() {
    let fixture = TwoAccountFixture::new();
    let w0 = fixture.message("w0");
    let w1 = fixture.message("w1");
    let p0 = fixture.message("p0");
    let p1 = fixture.message("p1");

    // 1. Clamped raw override consistency:
    // Set work trashPerCall = 40, then lower default to 10/10, then raise work trashPerDay = 50.
    // Approval summary, return value, and mail-policy-show must all agree on trashPerCall = 40.
    let set_work_40 = json!({ "account": fixture.work.id.0, "trashPerCall": 40 }).to_string();
    let (s, out, err, _) = fixture.person_cli_yes(&["mail-policy-set", &set_work_40]);
    assert_eq!(s, EXIT_OK, "out={out}\nerr={err}");

    let lower_default = json!({ "trashPerCall": 10, "trashPerDay": 10 }).to_string();
    let (s, out, err, _) = fixture.person_cli_yes(&["mail-policy-set", &lower_default]);
    assert_eq!(s, EXIT_OK, "out={out}\nerr={err}");

    // Raising work trashPerDay to 20 (still below raw stored trashPerCall = 40) is refused
    // with a truthful preview saying nothing will change.
    let too_low = json!({ "account": fixture.work.id.0, "trashPerDay": 20 }).to_string();
    let (s, out, err, _) = fixture.person_cli_yes(&["mail-policy-set", &too_low]);
    assert_ne!(s, EXIT_OK);
    assert!(out.contains("INVALID_INPUT"), "{out}");
    assert!(err.contains("cannot be set as given"), "{err}");

    // Raising work trashPerDay to 50 un-clamps raw stored trashPerCall = 40 consistently.
    let raise_50 = json!({ "account": fixture.work.id.0, "trashPerDay": 50 }).to_string();
    let (s, out, err, asked) = fixture.person_cli_yes(&["mail-policy-set", &raise_50]);
    assert_eq!(s, EXIT_OK, "out={out}\nerr={err}");
    assert!(!asked.is_empty());
    assert!(
        err.contains("trash up to 40 a call and 50 a day"),
        "approval preview must match persisted effective limits: {err}"
    );
    let parsed_out: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed_out["data"]["policy"]["trashPerCall"], 40);
    assert_eq!(parsed_out["data"]["policy"]["trashPerDay"], 50);
    let shown_work = fixture.agent(
        "a",
        "mail-policy-show",
        json!({ "account": fixture.work.id.0 }),
    );
    assert_eq!(shown_work["data"]["policy"]["trashPerCall"], 40);
    assert_eq!(shown_work["data"]["policy"]["trashPerDay"], 50);

    // 2. Per-account askAbove override is honored by CLI terminal prompts.
    let ask_zero = json!({ "account": fixture.work.id.0, "askAbove": 0 }).to_string();
    let (s, out, err, _) = fixture.person_cli_yes(&["mail-policy-set", &ask_zero]);
    assert_eq!(s, EXIT_OK, "out={out}\nerr={err}");

    let mark_work = json!({ "messages": [w0], "read": true }).to_string();
    let (s, out, err, asked) = fixture.person_cli_yes(&["mail-mark", &mark_work]);
    assert_eq!(s, EXIT_OK, "out={out}\nerr={err}");
    assert!(
        !asked.is_empty(),
        "work askAbove=0 must prompt for 1 message"
    );
    assert!(err.contains("Mark 1 messages"), "{err}");

    let mark_personal = json!({ "messages": [p0], "read": true }).to_string();
    let (s, out, err, asked) = fixture.person_cli_yes(&["mail-mark", &mark_personal]);
    assert_eq!(s, EXIT_OK, "out={out}\nerr={err}");
    assert!(
        asked.is_empty(),
        "personal inherits askAbove=200 and must not prompt for 1 message: {asked:?}"
    );

    // 3. Inherited trashPerDay is isolated per account, and resuming a human's stopped trash op
    // checks the resuming agent's daily trash limit.
    let reset_work = json!({ "account": fixture.work.id.0, "reset": true }).to_string();
    let (s, _, _, _) = fixture.person_cli_yes(&["mail-policy-set", &reset_work]);
    assert_eq!(s, EXIT_OK);
    let one_per_day = json!({ "trashPerCall": 1, "trashPerDay": 1 }).to_string();
    let (s, _, _, _) = fixture.person_cli_yes(&["mail-policy-set", &one_per_day]);
    assert_eq!(s, EXIT_OK);

    // Agent trashes 1 in personal -> done.
    let p_trash = fixture.agent("a", "mail-trash", json!({ "messages": [p0] }));
    assert_eq!(p_trash["data"]["state"], "done", "{p_trash}");

    // Agent trashes 1 in work -> done (personal's daily count does not bleed into work).
    let w_trash = fixture.agent("a", "mail-trash", json!({ "messages": [w0] }));
    assert_eq!(w_trash["data"]["state"], "done", "{w_trash}");

    // Second trash in work exceeds work's inherited trashPerDay = 1 -> proposed.
    let w_second = fixture.agent("a", "mail-trash", json!({ "messages": [w1] }));
    assert_eq!(w_second["data"]["state"], "proposed", "{w_second}");

    // Human starts a trash in personal while personal_server is down -> stopped.
    fixture.personal_server.world().down = true;
    let human_stopped = fixture.person("mail-trash", json!({ "messages": [p1] }));
    fixture.personal_server.world().down = false;
    assert_eq!(human_stopped["success"], false, "{human_stopped}");
    let stopped_op = human_stopped["error"]["details"]["operation"]
        .as_i64()
        .expect("stopped op id");

    // Agent at personal's daily trash limit cannot bypass it by resuming the human's stopped op.
    let resumed = fixture.agent(
        "a",
        "mail-operation-resume",
        json!({ "operation": stopped_op }),
    );
    assert_eq!(resumed["success"], true, "{resumed}");
    assert_eq!(
        resumed["data"]["state"], "proposed",
        "resuming another caller's trash op over daily limit must propose: {resumed}"
    );
}

#[test]
fn resume_with_copying_items_enforces_per_account_policy_and_multi_account_guard() {
    let fixture = TwoAccountFixture::new();
    let w0 = fixture.message("w0");
    let w1 = fixture.message("w1");
    let p0 = fixture.message("p0");

    // Guard `work` with changePerCall = 0 while default remains permissive (50).
    let guard_work = json!({ "account": fixture.work.id.0, "changePerCall": 0 }).to_string();
    let (s, out, err, _) = fixture.person_cli_yes(&["mail-policy-set", &guard_work]);
    assert_eq!(s, EXIT_OK, "out={out}\nerr={err}");

    // Stop a single-account `work` op, then put its open item into `Step::Copying`
    // (as happens when a provider fails after `record(&asking)` in `operate.rs`).
    fixture.work_server.world().down = true;
    let stopped = fixture.person("mail-mark", json!({ "messages": [w0], "read": true }));
    fixture.work_server.world().down = false;
    assert_eq!(stopped["success"], false, "{stopped}");
    let work_op = stopped["error"]["details"]["operation"].as_i64().unwrap();

    let work_accounts = fixture
        .engine
        .with_store(|store| {
            let items = store.operation_items(work_op, None, 10)?;
            assert_eq!(items.len(), 1);
            let item = &items[0];
            store.record_steps(
                work_op,
                item.mailbox,
                &item.validity,
                &[ItemStep::only(&item.provider_id, Step::Copying)],
                100,
            )?;
            store.operation_open_accounts(work_op)
        })
        .unwrap();
    assert_eq!(work_accounts, vec![fixture.work.id]);

    // Agent resuming must still see `work` and propose under `work`'s changePerCall = 0.
    let resumed = fixture.agent(
        "a",
        "mail-operation-resume",
        json!({ "operation": work_op }),
    );
    assert_eq!(resumed["success"], true, "{resumed}");
    assert_eq!(
        resumed["data"]["state"], "proposed",
        "copying item must not bypass per-account policy on resume: {resumed}"
    );

    // Stop a multi-account op with items in both `work` and `personal`, move all open items
    // to `Step::Copying`, and verify non-human resume still refuses with SELECTION_SPANS_ACCOUNTS.
    fixture.work_server.world().down = true;
    fixture.personal_server.world().down = true;
    let both_stopped = fixture.person("mail-mark", json!({ "messages": [w1, p0], "read": true }));
    fixture.work_server.world().down = false;
    fixture.personal_server.world().down = false;
    assert_eq!(both_stopped["success"], false, "{both_stopped}");
    let both_op = both_stopped["error"]["details"]["operation"]
        .as_i64()
        .unwrap();

    let both_accounts = fixture
        .engine
        .with_store(|store| {
            let items = store.operation_items(both_op, None, 10)?;
            assert_eq!(items.len(), 2);
            for item in items {
                store.record_steps(
                    both_op,
                    item.mailbox,
                    &item.validity,
                    &[ItemStep::only(&item.provider_id, Step::Copying)],
                    100,
                )?;
            }
            store.operation_open_accounts(both_op)
        })
        .unwrap();
    assert_eq!(
        both_accounts.len(),
        2,
        "both accounts must stay open: {both_accounts:?}"
    );

    let multi_resumed = fixture.agent(
        "a",
        "mail-operation-resume",
        json!({ "operation": both_op }),
    );
    assert_eq!(multi_resumed["success"], false, "{multi_resumed}");
    assert_eq!(
        multi_resumed["error"]["code"], "SELECTION_SPANS_ACCOUNTS",
        "copying items spanning accounts must not bypass SELECTION_SPANS_ACCOUNTS: {multi_resumed}"
    );
}
