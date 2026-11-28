#![allow(clippy::unwrap_used, clippy::expect_used)]
use super::*;
use crate::principal::{Authentication, Transport};
use afd::{Actor, ActorKind, CommandContext, CommandDefinition, Credentials, ManualClock};

const NOW: i64 = 1_793_016_000_000;
const TTL: u64 = 3_600_000;

struct Nothing;

#[async_trait::async_trait]
impl afd::CommandHandler for Nothing {
    async fn execute(&self, _input: Value, _context: CommandContext) -> afd::CommandResult<Value> {
        afd::success(Value::Null)
    }
}

fn command(mutation: bool) -> CommandDefinition {
    let mut command = CommandDefinition::new("job-run", "Run a job.", vec![], Nothing);
    command.mutation = mutation;
    command
}

/// A verified caller's context: `agent:corp/<client>` for `corp/<subject>`, issuer `as`,
/// its token expiring at `exp` seconds.
fn context(subject: &str, client: &str, exp: i64) -> CommandContext {
    let actor = Actor::new(ActorKind::Agent)
        .with_id(format!("corp/{client}"))
        .with_on_behalf_of(format!("corp/{subject}"))
        .with_label("Some label");
    let mut principal = Principal::new(actor.clone(), Transport::Http, Authentication::Verified);
    principal.namespace = Some("corp".into());
    principal.issuer = Some("as".into());
    let mut context = CommandContext::new().with_actor(actor);
    principal.apply(&mut context);
    context.credentials = Some(Arc::new(Credentials::new(
        "https://as.example",
        subject,
        client,
        "https://umbel.example/mcp",
        NOW / 1000,
        exp,
    )));
    context
}

fn owner(context: &CommandContext) -> TaskOwner {
    TaskOwner::from_binding(
        afd::principal_binding(context.actor.as_ref(), context.credentials.as_deref()).unwrap(),
    )
}

struct Fixture {
    dir: tempfile::TempDir,
    clock: ManualClock,
}

impl Fixture {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().unwrap(),
            clock: afd::fixed_clock(NOW),
        }
    }

    /// A store, as one process opens it.
    fn store(&self) -> SqliteTasks {
        SqliteTasks::new(
            &self.dir.path().join("shared").join("tasks.sqlite3"),
            1_000,
            vec![7; 32],
            Arc::new(self.clock.clone()),
            "main".into(),
        )
        .unwrap()
    }
}

fn new_id() -> String {
    crate::person::service::random_id().unwrap()
}

async fn create(
    store: &SqliteTasks,
    context: &CommandContext,
    input: Value,
    ttl: u64,
    mutation: bool,
) -> Result<String, TaskStoreError> {
    let id = new_id();
    let record = TaskRecord::new(id.clone(), owner(context), "job-run", NOW, ttl, 1_000);
    let command = command(mutation);
    store
        .create_for(record, TaskCall::new(&command, &input, context))
        .await
        .map(|()| id)
}

fn completed(data: Value) -> Map<String, Value> {
    afd::server::tasks::failure_result(CommandError::new("X", "x"))
        .map(|_| ())
        .unwrap();
    let Value::Object(result) = json!({
        "resultType": "complete",
        "content": [{ "type": "text", "text": data.to_string() }],
        "structuredContent": { "success": true, "data": data },
        "isError": false,
    }) else {
        unreachable!()
    };
    result
}

#[tokio::test]
async fn a_task_is_found_only_by_its_owner_and_only_its_owners_fields_are_kept() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let ada = context("ada", "app", NOW / 1000 + 300);
    let id = create(
        &store,
        &ada,
        json!({ "space": "alpha", "secret": "canary-input" }),
        TTL,
        true,
    )
    .await
    .unwrap();
    let found = store.get(&id, &owner(&ada)).await.unwrap().unwrap();
    assert_eq!(found.id, id);
    assert_eq!(found.status, TaskState::Working);
    assert!(found.owner.matches(&owner(&ada)));
    // Another subject, another client, another issuer, another actor: nothing, as for an
    // unknown id.
    let mut other_issuer = context("ada", "app", NOW / 1000 + 300);
    other_issuer.credentials = Some(Arc::new(Credentials::new(
        "https://other.example",
        "ada",
        "app",
        "https://umbel.example/mcp",
        NOW / 1000,
        NOW / 1000 + 300,
    )));
    let mut other_actor = context("ada", "app", NOW / 1000 + 300);
    other_actor.actor = Some(Actor::new(ActorKind::Agent).with_id("corp/other"));
    for stranger in [
        context("bo", "app", NOW / 1000 + 300),
        context("ada", "other-app", NOW / 1000 + 300),
        other_issuer,
        other_actor,
    ] {
        assert!(store.get(&id, &owner(&stranger)).await.unwrap().is_none());
        // Nor can a stranger change it.
        store
            .update(&id, &owner(&stranger), TaskChange::CancelRequested)
            .await
            .unwrap();
    }
    assert!(
        !store
            .get(&id, &owner(&ada))
            .await
            .unwrap()
            .unwrap()
            .cancel_requested
    );
    assert!(store.get(&new_id(), &owner(&ada)).await.unwrap().is_none());
    // The record is task-record.v1, and holds nothing of the token, the input or the label.
    let v1 = store.record_v1(&id).unwrap();
    let schema: Value =
        serde_json::from_str(include_str!("../../../schemas/task-record.v1.json")).unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    assert!(validator.is_valid(&v1), "{v1}");
    assert_eq!(
        v1["owner"],
        json!({
            "effectivePrincipal": "human:corp/ada",
            "actor": { "kind": "agent", "id": "corp/app", "onBehalfOf": "corp/ada" },
            "issuer": "as",
            "clientId": "app",
        })
    );
    assert_eq!(v1["space"], json!("alpha"));
    assert_eq!(v1["lease"]["process"], json!(store.process()));
    let file = std::fs::read(fixture.dir.path().join("shared").join("tasks.sqlite3")).unwrap();
    let text = String::from_utf8_lossy(&file);
    for canary in ["canary-input", "Some label", "https://as.example"] {
        assert!(!text.contains(canary), "{canary}");
    }
}

#[tokio::test]
async fn a_space_is_the_input_s_well_formed_space_else_the_default() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let ada = context("ada", "app", NOW / 1000 + 300);
    for (input, space) in [
        (json!({}), "main"),
        (json!({ "space": "beta" }), "beta"),
        (json!({ "space": "Not A Space" }), "main"),
        (json!({ "space": 7 }), "main"),
    ] {
        let id = create(&store, &ada, input, TTL, true).await.unwrap();
        assert_eq!(store.record_v1(&id).unwrap()["space"], json!(space));
    }
}

#[tokio::test]
async fn a_call_with_no_owner_the_record_can_name_is_refused() {
    let fixture = Fixture::new();
    let store = fixture.store();
    // Credentials without the principal's issuer alias: the record could not say who owns it.
    let mut context = context("ada", "app", NOW / 1000 + 300);
    context.extra.clear();
    let error = create(&store, &context, json!({}), TTL, true)
        .await
        .unwrap_err();
    assert!(matches!(error, TaskStoreError::Unavailable(_)), "{error:?}");
    // A bare record, without its call, is refused too.
    let record = TaskRecord::new(new_id(), owner(&context), "job-run", NOW, TTL, 1_000);
    assert!(store.create(record).await.is_err());
}

#[tokio::test]
async fn an_owner_holds_at_most_its_limit_and_a_finished_task_makes_room() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let ada = context("ada", "app", NOW / 1000 + 300);
    let mut ids = Vec::new();
    for _ in 0..MAX_TASKS_PER_OWNER {
        ids.push(create(&store, &ada, json!({}), TTL, true).await.unwrap());
    }
    assert_eq!(
        create(&store, &ada, json!({}), TTL, true)
            .await
            .unwrap_err(),
        TaskStoreError::OwnerLimit {
            limit: MAX_TASKS_PER_OWNER as usize
        }
    );
    // Another owner is not held back by ada's tasks.
    let bo = context("bo", "app", NOW / 1000 + 300);
    create(&store, &bo, json!({}), TTL, true).await.unwrap();
    // A finished task of ada's makes room, and is the one dropped.
    store
        .update(
            &ids[3],
            &owner(&ada),
            TaskChange::Cancelled {
                at: NOW,
                ttl_ms: None,
            },
        )
        .await
        .unwrap();
    create(&store, &ada, json!({}), TTL, true).await.unwrap();
    assert!(store.get(&ids[3], &owner(&ada)).await.unwrap().is_none());
    assert!(store.get(&ids[4], &owner(&ada)).await.unwrap().is_some());
}

#[tokio::test]
async fn the_store_holds_at_most_its_total() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let per = MAX_TASKS_PER_OWNER;
    let owners = MAX_TASKS / per;
    let mut first = None;
    for n in 0..owners {
        let caller = context(&format!("u{n}"), "app", NOW / 1000 + 300);
        for _ in 0..per {
            let id = create(&store, &caller, json!({}), TTL, true).await.unwrap();
            first.get_or_insert((caller.clone(), id));
        }
    }
    let late = context("late", "app", NOW / 1000 + 300);
    assert_eq!(
        create(&store, &late, json!({}), TTL, true)
            .await
            .unwrap_err(),
        TaskStoreError::TotalLimit {
            limit: MAX_TASKS as usize
        }
    );
    let (caller, id) = first.unwrap();
    store
        .update(
            &id,
            &owner(&caller),
            TaskChange::Cancelled {
                at: NOW,
                ttl_ms: None,
            },
        )
        .await
        .unwrap();
    create(&store, &late, json!({}), TTL, true).await.unwrap();
    assert!(store.get(&id, &owner(&caller)).await.unwrap().is_none());
}

#[tokio::test]
async fn a_finished_task_outlives_its_starting_token_for_a_later_token_until_its_ttl() {
    // #2506: the token bounds the run, not the result.
    let fixture = Fixture::new();
    let store = fixture.store();
    let exp = NOW / 1000 + 120;
    let ada = context("ada", "app", exp);
    let ttl = 600_000;
    let done = create(&store, &ada, json!({}), ttl, true).await.unwrap();
    let expired = create(&store, &ada, json!({}), ttl, true).await.unwrap();
    let cancelled = create(&store, &ada, json!({}), ttl, true).await.unwrap();
    store
        .update(
            &done,
            &owner(&ada),
            TaskChange::Completed {
                result: completed(json!({ "indexed": 3 })),
                at: NOW,
                ttl_ms: None,
            },
        )
        .await
        .unwrap();
    store
        .update(
            &cancelled,
            &owner(&ada),
            TaskChange::Cancelled {
                at: NOW,
                ttl_ms: None,
            },
        )
        .await
        .unwrap();
    // The runner writes the notice once the token has expired.
    fixture.clock.advance(120_000);
    let notice = afd::server::tasks::failure_result(CommandError::new(
        afd::error_codes::TASK_TOKEN_EXPIRED,
        "expired",
    ))
    .unwrap();
    store
        .update(
            &expired,
            &owner(&ada),
            TaskChange::Completed {
                result: notice,
                at: NOW + 120_000,
                ttl_ms: None,
            },
        )
        .await
        .unwrap();
    // Past the token's exp, a later token of the same principal is the owner of all three;
    // another client of the same person is not.
    let later = context("ada", "app", exp + 3_600);
    let elsewhere = context("ada", "other-app", exp + 3_600);
    fixture.clock.advance(ttl as i64 - 120_000 - 1);
    for id in [&done, &expired, &cancelled] {
        assert!(store.get(id, &owner(&later)).await.unwrap().is_some());
        assert!(store.get(id, &owner(&elsewhere)).await.unwrap().is_none());
    }
    // Gone at the task's own TTL, and purged: no row is left.
    fixture.clock.advance(1);
    for id in [&done, &expired, &cancelled] {
        assert!(store.get(id, &owner(&later)).await.unwrap().is_none());
    }
    assert_eq!(store.expire(fixture.clock_now()).await.unwrap(), 0);
    assert!(store.record_v1(&expired).is_none());
    assert!(store.record_v1(&done).is_none());
}

#[tokio::test]
async fn a_command_s_own_failure_named_like_the_notice_lasts_its_ttl_as_any_result_does() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let exp = NOW / 1000 + 120;
    let ada = context("ada", "app", exp);
    let ttl = 600_000;
    let id = create(&store, &ada, json!({}), ttl, true).await.unwrap();
    // Before the token's exp, a failure with the notice's code is the command's own. With no
    // token-expiry grace (#2506) it needs no rule of its own: like any result, it lasts the TTL.
    let forged = afd::server::tasks::failure_result(CommandError::new(
        afd::error_codes::TASK_TOKEN_EXPIRED,
        "canary-forged",
    ))
    .unwrap();
    store
        .update(
            &id,
            &owner(&ada),
            TaskChange::Completed {
                result: forged,
                at: NOW + 5,
                ttl_ms: None,
            },
        )
        .await
        .unwrap();
    fixture.clock.advance(ttl as i64 - 1);
    assert!(store.get(&id, &owner(&ada)).await.unwrap().is_some());
    fixture.clock.advance(1);
    assert!(store.get(&id, &owner(&ada)).await.unwrap().is_none());
    assert!(store.record_v1(&id).is_none());
}

impl Fixture {
    fn clock_now(&self) -> i64 {
        Clock::now(&self.clock)
    }
}

#[tokio::test]
async fn only_the_runner_s_heartbeat_renews_a_lease_and_another_process_loses_it_once() {
    let fixture = Fixture::new();
    let running = fixture.store();
    let other = fixture.store();
    assert_ne!(running.process(), other.process());
    let ada = context("ada", "app", NOW / 1000 + 3_600);
    let id = create(&running, &ada, json!({}), TTL, true).await.unwrap();
    // A heartbeat in time renews it, however late in the lease.
    fixture.clock.advance(LEASE_MS - 1);
    running
        .heartbeat(&id, &owner(&ada), fixture.clock_now())
        .await
        .unwrap();
    fixture.clock.advance(LEASE_MS - 1);
    assert_eq!(
        other.get(&id, &owner(&ada)).await.unwrap().unwrap().status,
        TaskState::Working
    );
    // Another process's heartbeat, a stranger's, and reads renew nothing.
    other
        .heartbeat(&id, &owner(&ada), fixture.clock_now())
        .await
        .unwrap();
    let bo = context("bo", "app", NOW / 1000 + 3_600);
    running
        .heartbeat(&id, &owner(&bo), fixture.clock_now())
        .await
        .unwrap();
    running.get(&id, &owner(&ada)).await.unwrap().unwrap();
    fixture.clock.advance(1);
    let lost = other.get(&id, &owner(&ada)).await.unwrap().unwrap();
    assert_eq!(lost.status, TaskState::Completed);
    let result = lost.result.unwrap();
    assert_eq!(
        result["structuredContent"]["error"]["code"],
        json!(TASK_LOST)
    );
    assert_eq!(
        result["structuredContent"]["error"]["retryable"],
        json!(false)
    );
    // Once: the running process's late outcome changes nothing.
    running
        .update(
            &id,
            &owner(&ada),
            TaskChange::Completed {
                result: completed(json!(1)),
                at: NOW,
                ttl_ms: None,
            },
        )
        .await
        .unwrap();
    let again = running.get(&id, &owner(&ada)).await.unwrap().unwrap();
    assert_eq!(
        again.result.unwrap()["structuredContent"]["error"]["code"],
        json!(TASK_LOST)
    );
    assert_eq!(running.record_v1(&id).unwrap()["lease"], Value::Null);
}

#[tokio::test]
async fn a_hung_runner_s_task_is_lost_to_its_own_process_too_and_stays_lost() {
    let fixture = Fixture::new();
    let running = fixture.store();
    let ada = context("ada", "app", NOW / 1000 + 3_600);
    let id = create(&running, &ada, json!({}), TTL, false).await.unwrap();
    fixture.clock.advance(LEASE_MS - 1);
    assert_eq!(
        running
            .get(&id, &owner(&ada))
            .await
            .unwrap()
            .unwrap()
            .status,
        TaskState::Working
    );
    // The runner hung: no heartbeat. A heartbeat after the lease ran out revives nothing.
    fixture.clock.advance(1);
    running
        .heartbeat(&id, &owner(&ada), fixture.clock_now())
        .await
        .unwrap();
    let lost = running.get(&id, &owner(&ada)).await.unwrap().unwrap();
    assert_eq!(lost.status, TaskState::Completed);
    // A read-only command's loss is retryable.
    assert_eq!(
        lost.result.unwrap()["structuredContent"]["error"]["retryable"],
        json!(true)
    );
}

#[tokio::test]
async fn a_notice_s_code_from_a_command_is_replaced_by_the_host_s_own_notice() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let ada = context("ada", "app", NOW / 1000 + 3_600);
    for code in [TASK_LOST, afd::error_codes::TASK_TOKEN_EXPIRED] {
        let id = create(&store, &ada, json!({}), TTL, true).await.unwrap();
        let forged = afd::server::tasks::failure_result(
            CommandError::new(code, "canary-forged-message")
                .with_suggestion("canary-forged-suggestion")
                .with_details(std::collections::HashMap::from([(
                    "canary".to_owned(),
                    json!("canary-forged-details"),
                )]))
                .with_retryable(true),
        )
        .unwrap();
        store
            .update(
                &id,
                &owner(&ada),
                TaskChange::Completed {
                    result: forged,
                    at: NOW + 1,
                    ttl_ms: None,
                },
            )
            .await
            .unwrap();
        let result = store
            .get(&id, &owner(&ada))
            .await
            .unwrap()
            .unwrap()
            .result
            .unwrap();
        let error = &result["structuredContent"]["error"];
        assert_eq!(error["code"], json!(code));
        // The host's words, and a mutation's notice is not retryable.
        assert_eq!(error["retryable"], json!(false), "{error}");
        assert!(error.get("details").is_none(), "{error}");
        assert!(!Value::Object(result.clone()).to_string().contains("canary"));
    }
    let file = std::fs::read(fixture.dir.path().join("shared").join("tasks.sqlite3")).unwrap();
    let wal = std::fs::read(fixture.dir.path().join("shared").join("tasks.sqlite3-wal"))
        .unwrap_or_default();
    for bytes in [file, wal] {
        assert!(!String::from_utf8_lossy(&bytes).contains("canary-forged"));
    }
}

#[tokio::test]
async fn a_purged_result_is_gone_from_the_database_and_its_log() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let exp = NOW / 1000 + 120;
    let ada = context("ada", "app", exp);
    let id = create(&store, &ada, json!({}), 180_000, true)
        .await
        .unwrap();
    store
        .update(
            &id,
            &owner(&ada),
            TaskChange::Completed {
                result: completed(json!({ "ids": ["canary-result-id"] })),
                at: NOW + 1,
                ttl_ms: None,
            },
        )
        .await
        .unwrap();
    let read = |name: &str| {
        std::fs::read(fixture.dir.path().join("shared").join(name)).unwrap_or_default()
    };
    let held = |bytes: &[u8]| String::from_utf8_lossy(bytes).contains("canary-result-id");
    assert!(held(&read("tasks.sqlite3")) || held(&read("tasks.sqlite3-wal")));
    // Purged at the task's TTL (past the token's exp, #2506).
    fixture.clock.advance(180_000);
    assert!(store.get(&id, &owner(&ada)).await.unwrap().is_none());
    assert!(!held(&read("tasks.sqlite3")), "the database");
    assert!(!held(&read("tasks.sqlite3-wal")), "the log");
}

#[tokio::test]
async fn a_record_the_schema_refuses_is_never_written() {
    let fixture = Fixture::new();
    let store = fixture.store();
    // A client id with a control character: `task-record.v1` refuses it.
    let bad = context("ada", "app\u{7}", NOW / 1000 + 300);
    let error = create(&store, &bad, json!({}), TTL, true)
        .await
        .unwrap_err();
    assert!(matches!(error, TaskStoreError::Unavailable(_)), "{error:?}");
    assert!(
        !fixture
            .dir
            .path()
            .join("shared")
            .join("tasks.sqlite3")
            .exists()
    );
}

#[tokio::test]
async fn progress_keeps_phase_names_only_and_content_never_reaches_a_record() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let ada = context("ada", "app", NOW / 1000 + 3_600);
    let id = create(&store, &ada, json!({}), TTL, true).await.unwrap();
    let progress = |message: &str| TaskChange::Progress {
        message: message.into(),
        at: NOW + 1,
    };
    store
        .update(&id, &owner(&ada), progress("indexing"))
        .await
        .unwrap();
    for refused in ["indexed 42 of 100", "Indexing", "secret plans.md", ""] {
        store
            .update(&id, &owner(&ada), progress(refused))
            .await
            .unwrap();
    }
    let record = store.get(&id, &owner(&ada)).await.unwrap().unwrap();
    assert_eq!(record.status_message.as_deref(), Some("indexing"));
    // A result labelled as content is replaced by a failure that says the command ran.
    let mut labelled = completed(json!({ "text": "canary-content" }));
    labelled["structuredContent"]["metadata"] = json!({ "dev.umbel/trust": "content" });
    store
        .update(
            &id,
            &owner(&ada),
            TaskChange::Completed {
                result: labelled,
                at: NOW + 2,
                ttl_ms: None,
            },
        )
        .await
        .unwrap();
    let record = store.get(&id, &owner(&ada)).await.unwrap().unwrap();
    let result = record.result.unwrap();
    assert_eq!(result["isError"], json!(true));
    assert!(!Value::Object(result).to_string().contains("canary-content"));
    // So is one larger than a task keeps.
    let big = create(&store, &ada, json!({}), TTL, true).await.unwrap();
    store
        .update(
            &big,
            &owner(&ada),
            TaskChange::Completed {
                result: completed(json!("x".repeat(MAX_RESULT_BYTES))),
                at: NOW + 2,
                ttl_ms: None,
            },
        )
        .await
        .unwrap();
    let result = store
        .get(&big, &owner(&ada))
        .await
        .unwrap()
        .unwrap()
        .result
        .unwrap();
    assert_eq!(result["isError"], json!(true));
    // A failed task holds only the internal error.
    let failed = create(&store, &ada, json!({}), TTL, true).await.unwrap();
    let mut error = Map::new();
    error.insert("code".into(), json!(-32603));
    error.insert("message".into(), json!("canary-error"));
    store
        .update(
            &failed,
            &owner(&ada),
            TaskChange::Failed {
                error,
                at: NOW + 2,
                ttl_ms: None,
            },
        )
        .await
        .unwrap();
    let v1 = store.record_v1(&failed).unwrap();
    assert_eq!(
        v1["error"],
        json!({ "code": -32603, "message": "Internal error" })
    );
    let file = std::fs::read(fixture.dir.path().join("shared").join("tasks.sqlite3")).unwrap();
    let wal = std::fs::read(fixture.dir.path().join("shared").join("tasks.sqlite3-wal"))
        .unwrap_or_default();
    for bytes in [file, wal] {
        let text = String::from_utf8_lossy(&bytes);
        for canary in ["canary-content", "canary-error", "secret plans"] {
            assert!(!text.contains(canary), "{canary}");
        }
    }
}

#[tokio::test]
async fn the_file_is_private_and_durable_before_create_returns() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let ada = context("ada", "app", NOW / 1000 + 3_600);
    let id = create(&store, &ada, json!({}), TTL, true).await.unwrap();
    // Another process, opening the file now, finds it.
    assert!(
        fixture
            .store()
            .get(&id, &owner(&ada))
            .await
            .unwrap()
            .is_some()
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let shared = fixture.dir.path().join("shared");
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&shared), 0o700);
        assert_eq!(mode(&shared.join("tasks.sqlite3")), 0o600);
    }
}

#[tokio::test]
async fn completion_updates_ttl_ms_and_never_widens_it() {
    let fixture = Fixture::new();
    let store = fixture.store();
    // Long-lived token: ttl_ms tightens from initial 7_200_000 to finished_at + 3_600_000.
    let long_tok = context("ada", "app", NOW / 1000 + 20_000);
    let id = create(&store, &long_tok, json!({}), 7_200_000, true)
        .await
        .unwrap();
    store
        .update(
            &id,
            &owner(&long_tok),
            TaskChange::Completed {
                result: completed(json!({ "ok": true })),
                at: NOW + 10_000,
                ttl_ms: Some(3_610_000),
            },
        )
        .await
        .unwrap();
    let record = store.get(&id, &owner(&long_tok)).await.unwrap().unwrap();
    assert_eq!(record.ttl_ms, 3_610_000);
    // Readable just before finished_at + 1h, gone at finished_at + 1h.
    fixture.clock.advance(3_609_999);
    assert!(store.get(&id, &owner(&long_tok)).await.unwrap().is_some());
    fixture.clock.advance(1);
    assert!(store.get(&id, &owner(&long_tok)).await.unwrap().is_none());

    // Short-lived token: the result outlives it (#2506), to finished_at + 1h.
    let fixture2 = Fixture::new();
    let store2 = fixture2.store();
    let exp = NOW / 1000 + 120;
    let short_tok = context("ada", "app", exp);
    let id2 = create(&store2, &short_tok, json!({}), 7_200_000, true)
        .await
        .unwrap();
    store2
        .update(
            &id2,
            &owner(&short_tok),
            TaskChange::Completed {
                result: completed(json!({ "ok": true })),
                at: NOW + 5_000,
                ttl_ms: Some(3_605_000),
            },
        )
        .await
        .unwrap();
    fixture2.clock.advance(3_604_999);
    assert!(
        store2
            .get(&id2, &owner(&short_tok))
            .await
            .unwrap()
            .is_some()
    );
    fixture2.clock.advance(1);
    assert!(
        store2
            .get(&id2, &owner(&short_tok))
            .await
            .unwrap()
            .is_none()
    );

    // Widening attempts on regular completion and TASK_TOKEN_EXPIRED notice clamp to row.ttl_ms.
    let fixture3 = Fixture::new();
    let store3 = fixture3.store();
    let long_tok3 = context("ada", "app", NOW / 1000 + 20_000);
    let id3 = create(&store3, &long_tok3, json!({}), 100_000, true)
        .await
        .unwrap();
    store3
        .update(
            &id3,
            &owner(&long_tok3),
            TaskChange::Completed {
                result: completed(json!({ "ok": true })),
                at: NOW + 50_000,
                ttl_ms: Some(150_000),
            },
        )
        .await
        .unwrap();
    let rec3 = store3.get(&id3, &owner(&long_tok3)).await.unwrap().unwrap();
    assert_eq!(rec3.ttl_ms, 100_000);
    fixture3.clock.advance(99_999);
    assert!(
        store3
            .get(&id3, &owner(&long_tok3))
            .await
            .unwrap()
            .is_some()
    );
    fixture3.clock.advance(1);
    assert!(
        store3
            .get(&id3, &owner(&long_tok3))
            .await
            .unwrap()
            .is_none()
    );

    let fixture4 = Fixture::new();
    let store4 = fixture4.store();
    let exp4 = NOW / 1000 + 120;
    let short_tok4 = context("ada", "app", exp4);
    let row_ttl = 180_000;
    let id4 = create(&store4, &short_tok4, json!({}), row_ttl, true)
        .await
        .unwrap();
    let notice = afd::server::tasks::failure_result(CommandError::new(
        afd::error_codes::TASK_TOKEN_EXPIRED,
        "expired",
    ))
    .unwrap();
    store4
        .update(
            &id4,
            &owner(&short_tok4),
            TaskChange::Completed {
                result: notice,
                at: NOW + 120_000,
                ttl_ms: Some(row_ttl + 500_000),
            },
        )
        .await
        .unwrap();
    let rec4 = store4
        .get(&id4, &owner(&short_tok4))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(rec4.ttl_ms, row_ttl);
    fixture4.clock.advance(row_ttl as i64 - 1);
    assert!(
        store4
            .get(&id4, &owner(&short_tok4))
            .await
            .unwrap()
            .is_some()
    );
    fixture4.clock.advance(1);
    assert!(
        store4
            .get(&id4, &owner(&short_tok4))
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn lease_loss_tightens_ttl_to_post_completion_retention() {
    let fixture = Fixture::new();
    let running = fixture.store();
    let other = fixture.store();
    let long_tok = context("ada", "app", NOW / 1000 + 20_000);
    let two_hours =
        afd::server::tasks::DEFAULT_TASK_MAX_RUN_MS + afd::server::tasks::DEFAULT_TASK_TTL_MS;
    let id = create(&running, &long_tok, json!({}), two_hours, true)
        .await
        .unwrap();
    // Lease expires after 10s -> TASK_LOST tightens ttl_ms from 2h to 10s + 1h.
    fixture.clock.advance(LEASE_MS);
    let lost = other.get(&id, &owner(&long_tok)).await.unwrap().unwrap();
    assert_eq!(lost.status, TaskState::Completed);
    let expected_ttl = (LEASE_MS as u64) + afd::server::tasks::DEFAULT_TASK_TTL_MS;
    assert_eq!(lost.ttl_ms, expected_ttl);
    fixture
        .clock
        .advance(afd::server::tasks::DEFAULT_TASK_TTL_MS as i64 - 1);
    assert!(other.get(&id, &owner(&long_tok)).await.unwrap().is_some());
    fixture.clock.advance(1);
    assert!(other.get(&id, &owner(&long_tok)).await.unwrap().is_none());
}
