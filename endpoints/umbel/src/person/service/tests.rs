use super::*;

#[test]
fn ids_are_26_base32_characters_and_secrets_43_base64url() {
    let id = random_id().unwrap_or_default();
    assert!(is_id(&id), "{id}");
    assert!(!is_id("ABCDEFGHIJKLMNOPQRSTUVWXYZ"));
    assert!(!is_id("return"));
    assert_eq!(random_secret().unwrap_or_default().len(), 43);
}

#[test]
fn the_ledger_admits_an_approved_decision_for_its_call_once() {
    use crate::person::{ActorRef, DecisionFor, DecisionLedger};
    use crate::shared::person::{NewDecision, NewLogin, PersonStore, SqlitePerson, Verified};
    let dir = tempfile::tempdir().unwrap_or_else(|_| panic!("a temporary directory"));
    let store = Arc::new(SqlitePerson::new(&dir.path().join("person.sqlite3"), 1_000));
    let nonces = Arc::new(crate::shared::nonces::SqliteNonces::new(
        &dir.path().join("nonces.sqlite3"),
        1_000,
    ));
    let who = DecisionFor {
        actor: ActorRef {
            kind: afd::ActorKind::Agent,
            id: Some("corp/client".into()),
            on_behalf_of: Some("corp/ada".into()),
        },
        client_id: Some("client".into()),
        issuer: Some("as".into()),
        namespace: "corp".into(),
        subject: "ada".into(),
    };
    let now = crate::shared::nonces::now_ms();
    let id = random_id().unwrap_or_default();
    let digest = "d".repeat(43);
    fn ok<T>(result: Result<T, SharedError>) -> T {
        result.unwrap_or_else(|_| panic!("the store"))
    }
    ok(store.create(
        &NewDecision {
            id: id.clone(),
            for_: who.clone(),
            command: "gate-approve".into(),
            input_digest: digest.clone(),
            properties: Map::new(),
            spaces: Vec::new(),
            chain: Vec::new(),
            trace_id: None,
            created_ms: now,
            expires_ms: now + 600_000,
            binding: None,
        },
        now,
    ));
    let ledger = Ledger {
        store: store.clone(),
        nonces,
        clock: Arc::new(afd::SYSTEM_CLOCK),
    };
    let mark = |id: &str| PersonMark {
        id: id.to_owned(),
        command: "gate-approve".into(),
        input_digest: digest.clone(),
        surface: Surface::Mcp,
        level: "verified".into(),
        method: "person-page".into(),
        namespace: "corp".into(),
        auth_time: String::new(),
        acr: String::new(),
        at: String::new(),
        excluded: Vec::new(),
    };
    // Pending: not admitted.
    assert!(
        ledger
            .admit(&mark(&id), &who, "gate-approve", &digest)
            .is_err()
    );
    ok(store.start_login(
        &NewLogin {
            id: "l".repeat(26),
            decision: id.clone(),
            verifier: "v".into(),
            nonce: "n".into(),
            browser_hash: "ab".repeat(32),
            created_ms: now,
            expires_ms: now + 600_000,
        },
        now,
    ));
    ok(store.take_login(&"l".repeat(26), &"ab".repeat(32), now));
    ok(store.finish_login(
        &"l".repeat(26),
        Some(&Verified {
            auth_time_ms: now,
            acr: "phr".into(),
            preview_hash: format!("sha256:{}", "0".repeat(64)),
            preview_ok: true,
        }),
    ));
    ok(store.render(
        &crate::shared::person::Render {
            decision: id.clone(),
            login: "l".repeat(26),
            page: 1,
            pages: 1,
            hash: format!("sha256:{}", "0".repeat(64)),
            items: Vec::new(),
            ttl_ms: 600_000,
        },
        now,
    ));
    ok(store.decide(
        &id,
        &"l".repeat(26),
        &"ab".repeat(32),
        &crate::shared::person::Choice {
            page: 1,
            action: crate::shared::person::Action::Approve,
            checked: Vec::new(),
            hash: format!("sha256:{}", "0".repeat(64)),
            max_age_ms: i64::MAX,
        },
        now,
    ));
    // Another person, command or input: not admitted, and nothing spent.
    let mut bo = who.clone();
    bo.subject = "bo".into();
    assert!(
        ledger
            .admit(&mark(&id), &bo, "gate-approve", &digest)
            .is_err()
    );
    assert!(
        ledger
            .admit(&mark(&id), &who, "gate-reject", &digest)
            .is_err()
    );
    assert!(
        ledger
            .admit(&mark(&id), &who, "gate-approve", &"e".repeat(43))
            .is_err()
    );
    // The right call: once.
    assert!(
        ledger
            .admit(&mark(&id), &who, "gate-approve", &digest)
            .is_ok()
    );
    assert!(
        ledger
            .admit(&mark(&id), &who, "gate-approve", &digest)
            .is_err()
    );
}

#[test]
fn a_shown_input_is_text_of_at_most_2000_characters_with_line_ends() {
    assert!(showable(&json!("It is wrong.\nSee the runbook.\tThanks.")));
    assert!(showable(&json!("x".repeat(2000))));
    assert!(!showable(&json!("x".repeat(2001))));
    assert!(!showable(&json!("a\u{1b}[31mred")));
    assert!(!showable(&json!(["a"])));
}

#[test]
fn a_decision_keeps_ids_only() {
    assert!(keepable(&json!("p-1")));
    assert!(keepable(&json!(3)));
    assert!(keepable(&json!(["a", "b"])));
    assert!(!keepable(&json!({ "text": "x" })));
    assert!(!keepable(&json!("x".repeat(513))));
    assert!(!keepable(&json!("line\nbreak")));
    assert!(!keepable(&json!([1, 2])));
}

#[test]
fn the_shown_preview_drops_controls() {
    assert_eq!(clean("a\u{1b}[31mb\u{202e}c\nd\u{2028}e"), "a[31mbc\nde");
}

#[test]
fn a_preview_answers_one_page_by_section_2s_rules() {
    // Exactly `{ preview }`: one page of one, with no items.
    let one = preview_page_of(&json!({ "preview": "Mulch the beds" }), 1).unwrap();
    assert_eq!((one.page, one.pages, one.items.len()), (1, 1, 0));
    assert!(one.ok);
    assert!(preview_page_of(&json!({ "preview": "Mulch the beds" }), 2).is_none());
    let paged = json!({ "preview": "Review · page 2 of 3", "page": 2, "pages": 3, "items": [
        { "id": "prp-1", "text": "AFFIRM · Mulch beds before the first frost." },
        { "id": "prp-2", "text": "RETIRE · Water at noon." },
    ] });
    let two = preview_page_of(&paged, 2).unwrap();
    assert_eq!(two.items[1].0, "prp-2");
    assert_eq!(two.hash.len(), "sha256:".len() + 64);
    // Another page than asked, or any rule broken: not shown.
    assert!(preview_page_of(&paged, 1).is_none());
    for bad in [
        json!({ "preview": "x", "page": 1 }),
        json!({ "preview": "x", "page": 0, "pages": 1 }),
        json!({ "preview": "x", "page": 2, "pages": 1 }),
        json!({ "preview": "x", "page": 1, "pages": 201 }),
        json!({ "preview": "x", "extra": 1 }),
        json!({ "preview": 3 }),
        json!({ "preview": "x", "items": [{ "id": "a b", "text": "t" }] }),
        json!({ "preview": "x", "items": [{ "id": "", "text": "t" }] }),
        json!({ "preview": "x", "items": [{ "id": "a", "text": "t", "more": 1 }] }),
        json!({ "preview": "x", "items": [{ "id": "a", "text": "t" }, { "id": "a", "text": "u" }] }),
        json!({ "preview": "x", "items": [{ "id": "x".repeat(65), "text": "t" }] }),
        json!({ "preview": "x", "items": (0..101).map(|i| json!({ "id": format!("i{i}"), "text": "t" })).collect::<Vec<_>>() }),
    ] {
        assert!(preview_page_of(&bad, 1).is_none(), "{bad}");
    }
    // The page is cut nowhere: 6000 characters fit, one more does not.
    let full = json!({ "preview": "h", "items": [{ "id": "a", "text": "x".repeat(5999) }] });
    assert!(preview_page_of(&full, 1).is_some());
    let over = json!({ "preview": "hh", "items": [{ "id": "a", "text": "x".repeat(5999) }] });
    assert!(preview_page_of(&over, 1).is_none());
    assert!(preview_page_of(&json!({ "preview": "y".repeat(6001) }), 1).is_none());
}
