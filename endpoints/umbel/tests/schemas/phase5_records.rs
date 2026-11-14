//! Phase 5's record shapes (phase 5 specification, section 2): the principal projection version
//! 1, the provenance envelope version 3 and the shapes that nest it (event version 3, memory
//! record version 2, proposal record version 3), cursor version 1, locator version 2, the task
//! record, the usage event and the person decision, version 1, and the protected-resource
//! metadata. Every example validates in `every_example_validates_against_its_schema`; these tests
//! hold what each schema refuses, and that the older versions keep their own schemas.

use jsonschema::Validator;
use serde_json::{Value, json};

use super::{assert_refuses, edited, example, examples, validator};

/// `base` with the member at the JSON pointer `pointer` set to `value`, inserted when missing.
fn with(base: &Value, pointer: &str, value: Value) -> Value {
    edited(base, |v| {
        let (parent, key) = pointer.rsplit_once('/').unwrap();
        let target = if parent.is_empty() {
            v
        } else {
            v.pointer_mut(parent).unwrap()
        };
        target
            .as_object_mut()
            .unwrap()
            .insert(key.to_owned(), value);
    })
}

/// `base` without the member at the JSON pointer `pointer`.
fn without(base: &Value, pointer: &str) -> Value {
    edited(base, |v| {
        let (parent, key) = pointer.rsplit_once('/').unwrap();
        let target = if parent.is_empty() {
            v
        } else {
            v.pointer_mut(parent).unwrap()
        };
        target.as_object_mut().unwrap().remove(key).unwrap();
    })
}

fn assert_accepts(validator: &Validator, label: &str, instance: &Value) {
    let errors: Vec<String> = validator
        .iter_errors(instance)
        .map(|e| e.to_string())
        .collect();
    assert!(errors.is_empty(), "{label} refused {instance}: {errors:?}");
}

/// Every top-level key of `base` is required.
fn assert_each_key_required(validator: &Validator, label: &str, base: &Value) {
    for field in base.as_object().unwrap().keys() {
        assert!(
            !validator.is_valid(&without(base, &format!("/{field}"))),
            "{label} accepted a missing {field}"
        );
    }
}

const CLIENT: &str = "corp/f53f191f9311af35";
const HASHED: &str = "corp/~abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst";

fn client() -> Value {
    json!({ "kind": "agent", "id": CLIENT })
}

// ── Principal projection, version 1 (section 2.1) ──────────────────────────────────────────────

#[test]
fn the_version_1_principal_refuses_what_the_specification_refuses() {
    let validator = validator("principal.v1");
    let base = example("principal.v1", "");
    assert_each_key_required(&validator, "principal.v1", &base);
    let terminal =
        json!({ "level": "terminal", "method": "cli-terminal", "at": "2026-11-09T10:00:00Z" });
    let scopes: Vec<String> = (0..65).map(|i| format!("umbel:read:s{i}")).collect();
    assert_refuses(
        &validator,
        "principal.v1",
        &[
            with(&base, "/version", json!(0)),
            // Reserved or never copied here.
            with(&base, "/tenant", json!("x")),
            with(&base, "/credentials", json!({})),
            // dpop is reserved (D19); mtls needs its thumbprint; a verified token has a binding.
            with(&base, "/tokenBinding", json!({ "kind": "dpop" })),
            with(&base, "/tokenBinding", json!({ "kind": "mtls" })),
            with(
                &base,
                "/tokenBinding",
                json!({ "kind": "mtls", "thumbprint": "abc" }),
            ),
            with(&base, "/tokenBinding", Value::Null),
            // A verified caller has a namespace and an issuer alias.
            with(&base, "/namespace", Value::Null),
            with(&base, "/issuer", Value::Null),
            with(&base, "/namespace", json!("Corp")),
            with(&base, "/issuer", json!("https://as.example.com")),
            // The chain: at least the client, at most 8, each entry mapped as a client.
            with(&base, "/delegationChain", json!([])),
            with(&base, "/delegationChain", Value::Array(vec![client(); 9])),
            with(
                &base,
                "/delegationChain",
                json!([{ "kind": "human", "id": "corp/U1" }]),
            ),
            with(
                &base,
                "/delegationChain",
                json!([{ "kind": "agent", "id": "f53f" }]),
            ),
            // The actor is a client acting for a namespaced person, with namespaced ids (4.1).
            with(&base, "/actor/kind", json!("human")),
            with(&base, "/actor/id", json!("f53f191f9311af35")),
            with(&base, "/actor/id", json!("corp/~f53f")),
            with(
                &base,
                "/actor/id",
                json!(format!("corp/{}", "x".repeat(121))),
            ),
            with(
                &base,
                "/actor/id",
                json!(format!("corporate-identity-namespace/{}", "x".repeat(110))),
            ),
            with(&base, "/actor/onBehalfOf", json!("U019488227")),
            without(&base, "/actor/onBehalfOf"),
            with(&base, "/transport", json!("stdio")),
            // Only the host sets presence: no terminal check over HTTP, and the levels keep
            // their methods; a verified login always shows its acr.
            with(&base, "/humanPresent", terminal.clone()),
            with(
                &base,
                "/humanPresent",
                json!({ "level": "verified", "method": "cli-terminal", "at": "2026-11-09T10:00:00Z", "authTime": "2026-11-09T10:00:00Z", "acr": "phr" }),
            ),
            with(
                &base,
                "/humanPresent",
                json!({ "level": "verified", "method": "person-page", "at": "2026-11-09T10:00:00Z", "authTime": "2026-11-09T10:00:00Z" }),
            ),
            with(&base, "/humanPresent", json!(true)),
            // Scopes follow 5.1's grammar, at most 64; a verified caller has scopes and spaces.
            with(&base, "/scopes", json!(["umbel:admin"])),
            with(&base, "/scopes", json!(["umbel:read:Main"])),
            with(&base, "/scopes", json!(["umbel:read:*"])),
            with(&base, "/scopes", json!(scopes)),
            with(&base, "/scopes", Value::Null),
            with(&base, "/spaces", Value::Null),
            with(&base, "/spaces", json!({ "main": [] })),
            with(&base, "/spaces", json!({ "main": ["delete"] })),
            // A policy decision's reason is a rule code, never a claim value.
            with(&base, "/policyDecision/decision", json!("maybe")),
            with(&base, "/policyDecision/reason", json!("U019488227")),
            with(&base, "/policyVersion", json!("9f86d081")),
        ],
    );
    assert_accepts(
        &validator,
        "a hashed id",
        &with(&base, "/actor/id", json!(HASHED)),
    );
    assert_accepts(
        &validator,
        "a chain of 8",
        &with(&base, "/delegationChain", Value::Array(vec![client(); 8])),
    );
    assert_accepts(&validator, "no scopes", &with(&base, "/scopes", json!([])));
    assert_accepts(&validator, "no spaces", &with(&base, "/spaces", json!({})));
}

#[test]
fn each_mode_of_the_version_1_principal_keeps_its_shape() {
    let validator = validator("principal.v1");
    let page = example("principal.v1", "person-page")["humanPresent"].clone();
    // Gateway: a service needs no person; an assertion is no token and claims no presence, but a
    // gateway user may be proven on the person page.
    let gateway = example("principal.v1", "gateway");
    assert_refuses(
        &validator,
        "gateway",
        &[
            with(&gateway, "/tokenBinding", json!({ "kind": "bearer" })),
            with(&gateway, "/actor/onBehalfOf", json!("corp/U1")),
        ],
    );
    assert_accepts(
        &validator,
        "a gateway user on the person page",
        &with(&gateway, "/humanPresent", page.clone()),
    );
    // None: the loopback agent, with nothing a token would carry.
    let loopback = example("principal.v1", "loopback");
    let cli = example("principal.v1", "cli");
    assert_refuses(
        &validator,
        "loopback",
        &[
            with(&loopback, "/actor/id", json!("ada")),
            with(&loopback, "/namespace", json!("corp")),
            with(&loopback, "/scopes", json!([])),
            with(&loopback, "/spaces", json!({})),
            with(&loopback, "/transport", json!("stdio")),
            with(&loopback, "/delegationChain", json!([client()])),
            with(&loopback, "/humanPresent", cli["humanPresent"].clone()),
            with(&loopback, "/tokenBinding", json!({ "kind": "bearer" })),
        ],
    );
    // Process: the CLI is a human, stdio an agent, and only the CLI's check is terminal.
    let stdio = edited(&cli, |v| {
        v["transport"] = json!("stdio");
        v["actor"]["kind"] = json!("agent");
    });
    assert_refuses(
        &validator,
        "process",
        &[
            with(&cli, "/actor/kind", json!("agent")),
            with(&cli, "/transport", json!("http")),
            with(&cli, "/issuer", json!("corp-as")),
            with(&cli, "/scopes", json!([])),
            stdio.clone(),
        ],
    );
    assert_accepts(
        &validator,
        "stdio",
        &with(&stdio, "/humanPresent", Value::Null),
    );
    assert_accepts(
        &validator,
        "a verified decision at the CLI",
        &with(&cli, "/humanPresent", page.clone()),
    );
    // A decision on the local page (the Ideas host-review specification, section 6.2): over
    // stdio only, with no login's time or class, and never at the CLI or over HTTP.
    let local =
        json!({ "level": "local", "method": "local-page", "at": "2026-11-13T09:00:00.000Z" });
    assert_accepts(
        &validator,
        "a decision on the local page over stdio",
        &with(&stdio, "/humanPresent", local.clone()),
    );
    let mut with_login = local.clone();
    with_login["authTime"] = json!("2026-11-13T09:00:00.000Z");
    assert_refuses(
        &validator,
        "a local decision",
        &[
            with(&cli, "/humanPresent", local.clone()),
            with(&loopback, "/humanPresent", local.clone()),
            with(&gateway, "/humanPresent", local.clone()),
            with(&stdio, "/humanPresent", with_login),
            with(&stdio, "/humanPresent", page),
        ],
    );
    // Embedder: the library, with no presence the host proved.
    let library = example("principal.v1", "library");
    assert_refuses(
        &validator,
        "library",
        &[
            with(&library, "/humanPresent", cli["humanPresent"].clone()),
            with(&library, "/transport", json!("cli")),
        ],
    );
}

#[test]
fn version_0_and_version_1_principals_keep_their_own_schemas() {
    let v0 = validator("principal.v0");
    let v1 = validator("principal.v1");
    for (name, principal) in examples("principal.v1") {
        assert!(!v0.is_valid(&principal), "{name}");
    }
    for (name, principal) in examples("principal.v0") {
        assert!(!v1.is_valid(&principal), "{name}");
    }
}

// ── Provenance envelope, version 3 (section 2.4) ───────────────────────────────────────────────

#[test]
fn the_version_3_envelope_gives_delegation_and_assurance_their_meaning() {
    let validator = validator("provenance-envelope.v3");
    let base = example("provenance-envelope.v3", "");
    let verified = example("provenance-envelope.v3", "verified");
    assert_each_key_required(&validator, "provenance-envelope.v3", &base);
    let mut cases = vec![
        with(&base, "/version", json!(2)),
        with(&base, "/tenant", json!("x")),
        with(&base, "/delegationChain", Value::Null),
        with(&base, "/delegationChain", Value::Array(vec![client(); 9])),
        with(
            &base,
            "/delegationChain",
            json!([{ "kind": "agent", "id": "x" }]),
        ),
        without(&base, "/confirmation/assurance"),
        with(
            &base,
            "/confirmation/assurance",
            json!({ "level": "terminal", "method": "person-page" }),
        ),
        with(
            &base,
            "/confirmation/assurance",
            json!({ "level": "terminal", "method": "cli-terminal", "namespace": "corp" }),
        ),
        with(&base, "/confirmation/assurance/level", json!("strong")),
        with(
            &verified,
            "/confirmation/assurance/method",
            json!("cli-terminal"),
        ),
        with(&verified, "/confirmation/assurance/subject", json!("U1")),
    ];
    for field in ["namespace", "authTime", "acr"] {
        cases.push(without(
            &verified,
            &format!("/confirmation/assurance/{field}"),
        ));
    }
    assert_refuses(&validator, "provenance-envelope.v3", &cases);
    // Each version keeps its schema: version 2 reserves delegationChain.
    let v2 = super::validator("provenance-envelope.v2");
    for (name, envelope) in examples("provenance-envelope.v3") {
        assert!(!v2.is_valid(&envelope), "{name}");
    }
    for (name, envelope) in examples("provenance-envelope.v2") {
        assert!(!validator.is_valid(&envelope), "{name}");
    }
}

#[test]
fn the_library_assurance_and_the_erasure_notice_are_closed_shapes() {
    // Step 10: the library's person is recorded as `embedder`, never as `terminal`, and holds
    // nothing more; an erase event's notice is host-owned and closed; a record never holds one.
    let validator = validator("provenance-envelope.v3");
    let embedder = example("provenance-envelope.v3", "embedder");
    assert!(validator.is_valid(&embedder), "{embedder}");
    let mut cases = vec![
        with(
            &embedder,
            "/confirmation/assurance",
            json!({ "level": "embedder", "method": "cli-terminal" }),
        ),
        with(
            &embedder,
            "/confirmation/assurance",
            json!({ "level": "terminal", "method": "library" }),
        ),
        with(
            &embedder,
            "/confirmation/assurance/namespace",
            json!("corp"),
        ),
        with(
            &embedder,
            "/confirmation/assurance/authTime",
            json!("2026-11-01T09:30:00.000Z"),
        ),
    ];
    let event = super::validator("event.v3");
    let erased = example("event.v3", "erasure");
    assert!(event.is_valid(&erased), "{erased}");
    for (pointer, value) in [
        ("/provenance/erasure/erasers", json!([])),
        (
            "/provenance/erasure/erasers",
            json!(["human:a", "human:b", "human:c"]),
        ),
        ("/provenance/erasure/erasers", json!(["ada"])),
        ("/provenance/erasure/count", json!(0)),
        (
            "/provenance/erasure/request",
            json!("p-4c2f9e1a7b03d58e6f10"),
        ),
        ("/provenance/erasure/plan", json!("sha256:abc")),
        (
            "/provenance/erasure/ids",
            json!(["mem-000000000000000000000001"]),
        ),
    ] {
        cases.push(with(&erased, pointer, value));
    }
    for field in ["erasers", "count", "request", "plan"] {
        cases.push(without(&erased, &format!("/provenance/erasure/{field}")));
    }
    let (envelopes, events): (Vec<Value>, Vec<Value>) = cases
        .into_iter()
        .partition(|case| case.get("provenance").is_none());
    assert_refuses(&validator, "provenance-envelope.v3", &envelopes);
    assert_refuses(&event, "event.v3", &events);
    // The notice is an event's: a stored memory record never holds it.
    let record = super::validator("memory-record.v2");
    let base = example("memory-record.v2", "");
    assert!(record.is_valid(&base));
    let erasure = erased["provenance"]["erasure"].clone();
    assert!(!record.is_valid(&with(&base, "/provenance/erasure", erasure)));
}

#[test]
fn the_shapes_nesting_the_envelope_take_version_3_with_it() {
    // Event version 3.
    let event = validator("event.v3");
    let base = example("event.v3", "");
    assert_refuses(
        &event,
        "event.v3",
        &[
            with(&base, "/version", json!(2)),
            with(&base, "/provenance", example("provenance-envelope.v2", "")),
            with(&base, "/provenance/tenant", json!("x")),
        ],
    );
    let event_v2 = validator("event.v2");
    for (name, line) in examples("event.v3") {
        assert!(!event_v2.is_valid(&line), "{name}");
    }
    for (name, line) in examples("event.v2") {
        assert!(!event.is_valid(&line), "{name}");
    }
    // Memory record version 2, on new versions only.
    let memory = validator("memory-record.v2");
    let record = example("memory-record.v2", "");
    let mut cases = vec![
        with(&record, "/version", json!(1)),
        with(&record, "/provenance/authority", Value::Null),
        with(&record, "/provenance/version", json!(2)),
        without(&record, "/provenance/delegationChain"),
    ];
    for field in ["promotedTo", "candidate", "settledAt"] {
        cases.push(with(&record, &format!("/{field}"), json!("x")));
    }
    assert_refuses(&memory, "memory-record.v2", &cases);
    assert!(!validator("memory-record.v1").is_valid(&record));
    assert!(!memory.is_valid(&example("memory-record.v1", "")));
}

// ── Proposal record, version 3 (sections 2.4 and 7.3) ──────────────────────────────────────────

#[test]
fn proposal_versions_keep_their_own_schemas() {
    let v3 = validator("proposal.v3");
    let v2 = validator("proposal.v2");
    for (name, record) in examples("proposal.v2") {
        assert!(!v3.is_valid(&record), "{name}");
    }
    for (name, record) in examples("proposal.v1") {
        assert!(!v3.is_valid(&record), "{name}");
    }
    for (name, record) in examples("proposal.v3") {
        assert!(!v2.is_valid(&record), "{name}");
    }
}

#[test]
fn a_version_3_decision_records_how_its_person_was_proven() {
    let validator = validator("proposal.v3");
    let applied = example("proposal.v3", "applied");
    let relayed = example("proposal.v3", "relayed");
    let policy = example("proposal.v3", "policy");
    let verified = relayed["decision"]["assurance"].clone();
    let terminal = json!({ "level": "terminal", "method": "cli-terminal" });
    assert_refuses(
        &validator,
        "proposal.v3 decisions",
        &[
            // A terminal decision records the CLI's check, and only that.
            without(&applied, "/decision/assurance"),
            with(&applied, "/decision/assurance", verified),
            // A decision over MCP is a person's, on the person page, with the login's acr.
            with(&relayed, "/decision/assurance", terminal.clone()),
            without(&relayed, "/decision/assurance"),
            without(&relayed, "/decision/assurance/acr"),
            with(&relayed, "/decision/by/kind", json!("agent")),
            with(&relayed, "/decision/channel", json!("relay")),
            with(&relayed, "/policy/rule", json!("auto:deprecate-declared")),
            // A policy decision proves no person.
            with(&policy, "/decision/assurance", terminal),
            with(&policy, "/decision/channel", json!("mcp-elicitation")),
            // The envelope is version 3.
            with(
                &applied,
                "/provenance",
                example("proposal.v2", "applied")["provenance"].clone(),
            ),
        ],
    );
}

// ── Cursor version 1, locator version 2 (section 9.3) ──────────────────────────────────────────

#[test]
fn sealed_positions_are_version_1_cursors_and_version_2_locators() {
    let cursor = validator("cursor.v1");
    assert_accepts(&cursor, "55", &json!(format!("v1.{}", "A".repeat(55))));
    assert_accepts(&cursor, "256", &json!(format!("v1.{}a", "a_-".repeat(85))));
    assert_refuses(
        &cursor,
        "cursor.v1",
        &[
            json!("v0:main:12"),
            json!(format!("v1.{}", "A".repeat(54))),
            json!(format!("v1.{}", "A".repeat(257))),
            json!(format!("v1.{}", "+".repeat(60))),
            json!(format!("v1.{}=", "A".repeat(54))),
            json!(format!("v2.{}", "A".repeat(60))),
            json!(format!("v1:{}", "A".repeat(60))),
        ],
    );
    assert!(!validator("cursor.v0").is_valid(&example("cursor.v1", "")));
    assert!(!cursor.is_valid(&example("cursor.v0", "")));

    let locator = validator("locator.v2");
    let base = example("locator.v2", "");
    assert_refuses(
        &locator,
        "locator.v2",
        &[
            with(&base, "/indexVersion", json!("main@1842/1")),
            with(&base, "/indexVersion", json!("main@r1.abc/1")),
            with(
                &base,
                "/indexVersion",
                json!(format!("main@r2.{}/1", "A".repeat(60))),
            ),
            with(
                &base,
                "/indexVersion",
                json!(format!("main@r1.{}", "A".repeat(60))),
            ),
            with(&base, "/version", json!(1)),
        ],
    );
    assert!(!validator("locator.v1").is_valid(&base));
    assert!(!locator.is_valid(&example("locator.v1", "")));
}

// ── Task record, version 1 (section 12.2) ──────────────────────────────────────────────────────

#[test]
fn a_task_record_holds_no_token_input_or_content() {
    let validator = validator("task-record.v1");
    let working = example("task-record.v1", "");
    let done = example("task-record.v1", "completed");
    let failed = example("task-record.v1", "failed");
    assert_each_key_required(&validator, "task-record.v1", &working);
    let trust = json!({ "dev.umbel/trust": "content" });
    let cancelled = edited(&failed, |v| {
        v["status"] = json!("cancelled");
        v["error"] = Value::Null;
    });
    assert_accepts(&validator, "cancelled", &cancelled);
    assert_accepts(
        &validator,
        "another trust",
        &with(
            &done,
            "/result/_meta",
            json!({ "dev.umbel/trust": "derived" }),
        ),
    );
    assert_refuses(
        &validator,
        "task-record.v1",
        &[
            with(&working, "/status", json!("input_required")),
            with(&working, "/id", json!("A".repeat(26))),
            with(&working, "/id", json!("a".repeat(25))),
            with(&working, "/owner/clientId", Value::Null),
            with(&working, "/owner/effectivePrincipal", json!("ada")),
            with(&working, "/input", json!({})),
            with(&working, "/credentials", json!({})),
            with(&working, "/token", json!("x")),
            with(&working, "/ttlMs", json!(0)),
            with(&working, "/lease/pid", json!(1)),
            // A status message is a phase name, never content.
            with(
                &working,
                "/statusMessage",
                json!("Indexing handbook/deploy"),
            ),
            with(&working, "/statusMessage", json!("a".repeat(65))),
            // Each status holds what it means.
            with(&working, "/result", done["result"].clone()),
            with(&working, "/lease", Value::Null),
            with(&done, "/lease", working["lease"].clone()),
            with(&done, "/result", Value::Null),
            with(&done, "/error", failed["error"].clone()),
            with(&done, "/result/input", json!({})),
            with(&done, "/result/_meta", trust.clone()),
            with(&done, "/result/structuredContent/metadata", trust),
            with(&failed, "/result", done["result"].clone()),
            with(&failed, "/error", Value::Null),
            with(&failed, "/error/code", json!(-32000)),
            with(&failed, "/error/message", json!("boom")),
            with(&cancelled, "/result", done["result"].clone()),
        ],
    );
}

// ── Usage event, version 1 (section 12.1) ──────────────────────────────────────────────────────

#[test]
fn a_usage_event_is_content_free() {
    let validator = validator("usage-event.v1");
    let base = example("usage-event.v1", "");
    let task = example("usage-event.v1", "task");
    assert_each_key_required(&validator, "usage-event.v1", &base);
    let listed = edited(&base, |v| {
        v["method"] = json!("tools/list");
        v["tool"] = Value::Null;
        v["command"] = Value::Null;
        v["space"] = Value::Null;
    });
    assert_accepts(&validator, "tools/list", &listed);
    assert_accepts(
        &validator,
        "a call that created a task",
        &with(&base, "/task", task["task"].clone()),
    );
    assert_refuses(
        &validator,
        "usage-event.v1",
        &[
            with(&base, "/transport", json!("stdio")),
            with(&base, "/method", json!("initialize")),
            with(&base, "/outcome", json!("Error!")),
            with(&base, "/outcome", json!("200")),
            with(&base, "/id", json!("u-1")),
            with(&base, "/task", json!("t-1")),
            with(&base, "/input", json!({})),
            with(&base, "/query", json!("deploy")),
            with(&base, "/bytesIn", json!(-1)),
            with(&base, "/principal", json!("ada")),
            with(&base, "/method", json!("tools/list")),
            with(&task, "/tool", json!("knowledge-refresh")),
        ],
    );
}

// ── Person decision, version 1 (section 7.2) ───────────────────────────────────────────────────

#[test]
fn a_person_decision_holds_ids_and_a_preview_hash_never_text() {
    let validator = validator("person-decision.v1");
    let pending = example("person-decision.v1", "");
    let approved = example("person-decision.v1", "approved");
    assert_each_key_required(&validator, "person-decision.v1", &pending);
    let props = |n: usize| -> Value {
        Value::Object(
            (0..n)
                .map(|i| (format!("k{i}"), json!("x")))
                .collect::<serde_json::Map<_, _>>(),
        )
    };
    assert_accepts(
        &validator,
        "16 properties",
        &with(&pending, "/properties", props(16)),
    );
    assert_accepts(
        &validator,
        "a list of 100",
        &with(
            &pending,
            "/properties/ids",
            Value::Array(vec![json!("x"); 100]),
        ),
    );
    // Text a decision shows (journal.show, step 6): line ends and tabs, at most 2000 characters.
    assert_accepts(
        &validator,
        "a shown reason",
        &with(
            &pending,
            "/properties/reason",
            json!("line\nbreak\tand tab"),
        ),
    );
    assert_accepts(
        &validator,
        "a shown reason of 2000 characters",
        &with(&pending, "/properties/reason", json!("x".repeat(2000))),
    );
    assert_accepts(
        &validator,
        "declined",
        &with(&approved, "/status", json!("declined")),
    );
    assert_refuses(
        &validator,
        "person-decision.v1",
        &[
            with(&pending, "/level", json!("verified")),
            with(&pending, "/previewHash", approved["previewHash"].clone()),
            with(&pending, "/status", json!("expired")),
            with(&pending, "/properties/q", json!({ "a": 1 })),
            with(
                &pending,
                "/properties/ids",
                Value::Array(vec![json!("x"); 101]),
            ),
            with(&pending, "/properties/ids", json!([1])),
            with(&pending, "/properties/q", json!("bell \u{7}")),
            with(&pending, "/properties/q", json!("x".repeat(2001))),
            with(&pending, "/properties/ids", json!(["line\nbreak"])),
            with(&pending, "/properties", props(17)),
            with(&pending, "/for/clientId", Value::Null),
            with(&pending, "/for/subject", json!("~abc")),
            with(&pending, "/for/namespace", json!("Corp")),
            with(&pending, "/inputDigest", json!("abc")),
            with(&pending, "/preview", json!("text")),
            with(&pending, "/id", json!("x")),
            // A decided decision is verified, with its login's time, acr and preview hash.
            with(&approved, "/previewHash", Value::Null),
            with(&approved, "/level", json!("terminal")),
            with(&approved, "/acr", Value::Null),
            with(&approved, "/decidedAt", Value::Null),
            with(&approved, "/authTime", json!("yesterday")),
        ],
    );
}

// ── Protected-resource metadata (section 3.3) ──────────────────────────────────────────────────

#[test]
fn the_metadata_publishes_nothing_else() {
    let validator = validator("protected-resource.v1");
    let base = example("protected-resource.v1", "");
    assert_accepts(
        &validator,
        "no scopes",
        &without(&base, "/scopes_supported"),
    );
    assert_refuses(
        &validator,
        "protected-resource.v1",
        &[
            with(&base, "/resource", json!("http://umbel.example.com/mcp")),
            with(
                &base,
                "/resource",
                json!("https://umbel.example.com/mcp?x=1"),
            ),
            with(&base, "/resource", json!("https://umbel.example.com")),
            with(&base, "/resource", json!("https://u@umbel.example.com/mcp")),
            with(&base, "/authorization_servers", json!([])),
            with(
                &base,
                "/authorization_servers",
                json!(["http://as.example.com"]),
            ),
            with(
                &base,
                "/authorization_servers",
                json!(["https://a.example.com", "https://a.example.com"]),
            ),
            with(&base, "/scopes_supported", json!([])),
            with(&base, "/scopes_supported", json!(["openid"])),
            with(
                &base,
                "/bearer_methods_supported",
                json!(["header", "body"]),
            ),
            with(&base, "/jwks_uri", json!("https://x/jwks")),
            with(
                &base,
                "/tls_client_certificate_bound_access_tokens",
                json!("false"),
            ),
            without(&base, "/tls_client_certificate_bound_access_tokens"),
        ],
    );
}
