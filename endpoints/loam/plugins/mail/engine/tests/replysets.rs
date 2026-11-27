//! Reply sets (step E3; the specification's 10.3, section 11, M18 and M29;
//! plugin.spec.md sections 6, 7 and 9), on the scripted IMAP and SMTP servers.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::collections::VecDeque;
use std::sync::Arc;

use afd::{Actor, ActorKind, CommandContext, CommandInterface, canonical_json};
use loam_mail::cli::{Caller, EXIT_FAILED, EXIT_OK, run};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::secrets::InMemory;
use loam_mail::store::{ReplySetSendRefusal, Store};
use serde_json::{Value, json};
use support::imap::{USER, World};
use support::smtp::SmtpFault;
use support::synced::{Fixture, assert_labelled, mail};

const ADA: &str = "Ada Lovelace <ada@example.com>";
const BEA: &str = "Bea Smith <bea@example.org>";
const CAM: &str = "Cam Jones <cam@example.net>";

/// Content words that belong only to messages, questions, answers, or reply
/// texts: none may appear outside a `"trust": "content"` part in any result
/// or error.
const CONTENT_WORDS: &[&str] = &[
    "ada@example.com",
    "bea@example.org",
    "cam@example.net",
    "spoof@evil.example",
    "Ada Lovelace",
    "Bea Smith",
    "Cam Jones",
    "Thursday works",
    "invoice attached",
    "Shared closing",
    "HIDDEN_PROMPT_INJECTION",
    "About ada0",
    "About bea0",
    "About cam0",
];

fn html_mail(from: &str, id: &str, visible: &str, hidden: &str, extra_headers: &str) -> Vec<u8> {
    format!(
        "From: {from}\r\nMessage-ID: <{id}@example.org>\r\nSubject: About {id}\r\n{extra_headers}\
         Content-Type: text/html; charset=utf-8\r\n\r\n\
         <html><body><p>{visible}</p><span style=\"display:none\">{hidden}</span></body></html>\r\n"
    )
    .into_bytes()
}

fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Sent Messages", &["\\Sent"]);
    world.mailbox("Junk", &["\\Junk"]);
    world.mailbox("Trash", &["\\Trash"]);
    world.add(
        "INBOX",
        html_mail(
            ADA,
            "ada0",
            "Can we meet on Thursday?",
            "HIDDEN_PROMPT_INJECTION",
            "To: person@example.com\r\nReply-To: spoof@evil.example\r\n",
        ),
        &[],
    );
    world.add(
        "INBOX",
        mail(BEA, "bea0", "To: person@example.com\r\n"),
        &[],
    );
    world.add(
        "INBOX",
        mail(CAM, "cam0", "To: person@example.com\r\n"),
        &[],
    );
    world.add(
        "Sent Messages",
        mail(USER, "own0", "To: ada@example.com\r\n"),
        &["\\Seen"],
    );
    world.add(
        "Junk",
        mail(
            "Spammer <spam@evil.example>",
            "junk0",
            "To: person@example.com\r\n",
        ),
        &[],
    );
    world.add(
        "Trash",
        mail(
            "Trashed <trashed@example.com>",
            "trash0",
            "To: person@example.com\r\n",
        ),
        &[],
    );
}

fn find_message(fixture: &Fixture, word: &str) -> i64 {
    let found = fixture.person("mail-search", json!({ "query": word }));
    found["data"]["hits"][0]["message"].as_i64().unwrap()
}

fn approved_send(fixture: &Fixture, input: Value) -> Value {
    let held = fixture.person("mail-replyset-send", input.clone());
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
    assert_labelled(&held, CONTENT_WORDS);
    let token = held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let context = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Human)
        .with_approval(token);
    fixture.execute("mail-replyset-send", input, context)
}

/// Pulls the next open unit for `set_id` and submits `text` against its handed
/// `unit` and `claim` via `mail-replyset-submit` as `person`.
fn person_submit_next(fixture: &Fixture, set_id: i64, text: &str) -> Value {
    let unit_res = fixture.person("mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(unit_res["success"], true, "{unit_res}");
    assert_eq!(unit_res["data"]["done"], false, "{unit_res}");
    let reply = unit_res["data"]["reply"].as_i64().unwrap();
    let unit = unit_res["data"]["unit"].as_str().unwrap().to_string();
    let claim = unit_res["data"]["claim"].as_str().unwrap().to_string();
    fixture.person(
        "mail-replyset-submit",
        json!({ "replyset": set_id, "reply": reply, "unit": unit, "claim": claim, "text": text }),
    )
}

/// Pulls the next open unit for `set_id` and submits `text` against its handed
/// `unit` and `claim` via `mail-replyset-submit` as agent `token_id`.
fn agent_submit_next(fixture: &Fixture, token_id: &str, set_id: i64, text: &str) -> Value {
    let unit_res = fixture.agent(
        token_id,
        "mail-replyset-next",
        json!({ "replyset": set_id }),
    );
    assert_eq!(unit_res["success"], true, "{unit_res}");
    assert_eq!(unit_res["data"]["done"], false, "{unit_res}");
    let reply = unit_res["data"]["reply"].as_i64().unwrap();
    let unit = unit_res["data"]["unit"].as_str().unwrap().to_string();
    let claim = unit_res["data"]["claim"].as_str().unwrap().to_string();
    fixture.agent(
        token_id,
        "mail-replyset-submit",
        json!({ "replyset": set_id, "reply": reply, "unit": unit, "claim": claim, "text": text }),
    )
}

#[test]
fn end_to_end_cohort_replyset_isolation_preview_and_send() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada0");
    let bea_msg = find_message(&fixture, "bea0");
    let cam_msg = find_message(&fixture, "cam0");

    // Create a reply set with sharedText and two questions (one shared by Ada
    // and Cam, one individual to Bea).
    let created = fixture.agent(
        "tok_a",
        "mail-replyset-create",
        json!({
            "messages": [ada_msg, bea_msg, cam_msg],
            "sharedText": "Shared closing: Thursday works.",
            "questions": [
                {
                    "question": "Does Thursday work?",
                    "messages": [ada_msg, cam_msg],
                },
                {
                    "question": "Where is the invoice?",
                    "messages": [bea_msg],
                    "answer": "The invoice is ready.",
                },
            ],
        }),
    );
    assert_eq!(created["success"], true, "{created}");
    assert_labelled(&created, CONTENT_WORDS);
    let set = &created["data"]["replyset"];
    let set_id = set["id"].as_i64().unwrap();
    assert_eq!(set["revision"], 1);
    assert_eq!(set["state"], "open");
    assert_eq!(set["totalReplies"], 3);
    assert_eq!(set["readyReplies"], 0);
    let questions = set["content"]["questions"].as_array().unwrap();
    assert_eq!(questions.len(), 2);
    assert_eq!(questions[0]["individual"], false);
    assert_eq!(questions[1]["individual"], true);
    let q1_id = questions[0]["id"].as_i64().unwrap();

    // Stored recipients come from From (NOT Reply-To!) and replyToDiffers is flagged.
    let replies = set["replies"].as_array().unwrap();
    assert_eq!(
        replies[0]["content"]["recipient"]["address"],
        "ada@example.com"
    );
    assert_eq!(replies[0]["replyToDiffers"], true);
    assert_eq!(
        replies[1]["content"]["recipient"]["address"],
        "bea@example.org"
    );
    assert_eq!(replies[1]["replyToDiffers"], false);
    assert_eq!(
        replies[2]["content"]["recipient"]["address"],
        "cam@example.net"
    );
    let ada_reply = replies[0]["reply"].as_i64().unwrap();
    let bea_reply = replies[1]["reply"].as_i64().unwrap();
    let cam_reply = replies[2]["reply"].as_i64().unwrap();

    // Person records answer to question 1 via mail-replyset-update.
    let answered = fixture.person(
        "mail-replyset-update",
        json!({
            "replyset": set_id,
            "revision": 1,
            "answers": [{ "question": q1_id, "answer": "Thursday works at 2pm." }],
        }),
    );
    assert_eq!(answered["success"], true, "{answered}");
    assert_labelled(&answered, CONTENT_WORDS);
    assert_eq!(answered["data"]["replyset"]["revision"], 2);
    // Question 1 bumped revision and bumped generation on Ada & Cam (not Bea).
    assert_eq!(
        answered["data"]["replyset"]["content"]["questions"][0]["revision"],
        2
    );
    assert_eq!(answered["data"]["replyset"]["replies"][0]["generation"], 2);
    assert_eq!(answered["data"]["replyset"]["replies"][1]["generation"], 1);
    assert_eq!(answered["data"]["replyset"]["replies"][2]["generation"], 2);

    // Pull unit 1 (Ada): holds ONLY Ada's visible text (no hidden HTML!) and
    // ONLY question 1's answer; ZERO leak of Bea or Cam!
    let unit1 = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(unit1["success"], true, "{unit1}");
    assert_labelled(&unit1, CONTENT_WORDS);
    assert_eq!(unit1["data"]["done"], false);
    assert_eq!(unit1["data"]["reply"], ada_reply);
    assert_eq!(unit1["data"]["unit"], format!("rsu_{set_id}_{ada_reply}_2"));
    assert_eq!(
        unit1["data"]["content"]["recipient"]["address"],
        "ada@example.com"
    );
    let ada_text = unit1["data"]["content"]["message"]["text"]
        .as_str()
        .unwrap();
    assert!(ada_text.contains("Can we meet on Thursday?"), "{ada_text}");
    assert!(!ada_text.contains("HIDDEN_PROMPT_INJECTION"), "{ada_text}");
    let u1_str = unit1.to_string();
    assert!(
        !u1_str.contains("bea@example.org"),
        "Bea leaked into Ada unit: {u1_str}"
    );
    assert!(
        !u1_str.contains("cam@example.net"),
        "Cam leaked into Ada unit: {u1_str}"
    );
    assert!(
        !u1_str.contains("invoice"),
        "Bea's question leaked into Ada unit: {u1_str}"
    );
    assert_eq!(
        unit1["data"]["content"]["answers"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        unit1["data"]["content"]["answers"][0]["answer"],
        "Thursday works at 2pm."
    );

    // Submit Ada's reply matching sharedText via mail-replyset-submit.
    let sub1 = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": ada_reply,
            "unit": unit1["data"]["unit"],
            "claim": unit1["data"]["claim"],
            "text": "Shared closing: Thursday works.",
        }),
    );
    assert_eq!(sub1["success"], true, "{sub1}");
    assert_labelled(&sub1, CONTENT_WORDS);
    assert_eq!(sub1["data"]["revision"], 3);
    assert_eq!(sub1["data"]["reply"]["source"], "submitted");
    assert_eq!(
        sub1["data"]["reply"]["unit"],
        format!("rsu_{set_id}_{ada_reply}_2")
    );
    assert!(sub1["data"].to_string().find("Shared closing").is_none());

    // Pull unit 2 (Bea): holds ONLY Bea's message and question 2 (individual: true).
    let unit2 = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(unit2["success"], true, "{unit2}");
    assert_eq!(unit2["data"]["reply"], bea_reply);
    let u2_str = unit2.to_string();
    assert!(
        !u2_str.contains("ada@example.com"),
        "Ada leaked into Bea unit: {u2_str}"
    );
    assert!(
        !u2_str.contains("Thursday works"),
        "Ada's answer leaked into Bea unit: {u2_str}"
    );
    assert_eq!(unit2["data"]["content"]["answers"][0]["individual"], true);
    assert_eq!(
        unit2["data"]["content"]["answers"][0]["answer"],
        "The invoice is ready."
    );

    // Submit Bea's reply with custom text -> differs = true in mail-replyset-show.
    let sub2 = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": bea_reply,
            "unit": unit2["data"]["unit"],
            "claim": unit2["data"]["claim"],
            "text": "Hi Bea, invoice attached.",
        }),
    );
    assert_eq!(sub2["success"], true, "{sub2}");

    // Pull unit 3 (Cam) and submit matching shared text.
    let unit3 = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(unit3["data"]["reply"], cam_reply);
    let sub3 = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": cam_reply,
            "unit": unit3["data"]["unit"],
            "claim": unit3["data"]["claim"],
            "text": "Shared closing: Thursday works.",
        }),
    );
    assert_eq!(sub3["success"], true, "{sub3}");

    // Calling next again reports done: true.
    let done = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(done["success"], true, "{done}");
    assert_eq!(done["data"]["done"], true);

    // Person edits Cam's reply via mail-replyset-update -> source becomes "edited", differs = true.
    let rev_before_edit = sub3["data"]["revision"].as_i64().unwrap();
    let edited = fixture.person(
        "mail-replyset-update",
        json!({
            "replyset": set_id,
            "revision": rev_before_edit,
            "reply": cam_reply,
            "text": "Hi Cam, Thursday works for me too!",
        }),
    );
    assert_eq!(edited["success"], true, "{edited}");
    let final_rev = edited["data"]["replyset"]["revision"].as_i64().unwrap();
    assert_eq!(final_rev, rev_before_edit + 1);
    assert_eq!(edited["data"]["replyset"]["differsCount"], 2);
    assert_eq!(edited["data"]["replyset"]["replies"][0]["differs"], false);
    assert_eq!(edited["data"]["replyset"]["replies"][1]["differs"], true);
    assert_eq!(edited["data"]["replyset"]["replies"][2]["differs"], true);
    assert_eq!(edited["data"]["replyset"]["replies"][2]["source"], "edited");
    assert_eq!(edited["data"]["replyset"]["replies"][2]["submissions"], 1);
    assert_eq!(edited["data"]["replyset"]["replies"][2]["edits"], 1);

    // Deterministic canonical JSON across two reads of mail-replyset-show.
    let show1 = fixture.agent("tok_a", "mail-replyset-show", json!({ "replyset": set_id }));
    let show2 = fixture.agent(
        "tok_a",
        "mail-replyset-show",
        json!({ "replyset": set_id, "revision": final_rev }),
    );
    assert_eq!(show1["success"], true, "{show1}");
    assert_eq!(show2["success"], true, "{show2}");
    assert_labelled(&show1, CONTENT_WORDS);
    assert_eq!(
        canonical_json(&show1["data"]).unwrap(),
        canonical_json(&show2["data"]).unwrap()
    );

    // Saying no at the terminal shows shared text once, every recipient, marks
    // matches vs DIFFERS, warns on differing Reply-To, and sends nothing.
    let arg = json!({ "replyset": set_id }).to_string();
    let (status, _out, err, _) = fixture.terminal(&["mail-replyset-send", &arg], false);
    assert_eq!(status, EXIT_FAILED);
    assert!(
        err.contains("Shared text, as written in the reply set:"),
        "{err}"
    );
    assert!(err.contains("ada@example.com"), "{err}");
    assert!(err.contains("bea@example.org"), "{err}");
    assert!(err.contains("cam@example.net"), "{err}");
    assert!(err.contains("Reply-To header that differs"), "{err}");
    assert!(err.contains("[matches shared text]"), "{err}");
    assert!(err.contains("[DIFFERS from shared text]"), "{err}");
    assert!(err.contains("Send reply set"), "{err}");
    assert!(fixture.smtp.received().is_empty());

    // Saying yes at the terminal sends all 3 replies over SMTP with threading
    // headers and appends copies to Sent Messages.
    let (status, out, err, _) = fixture.terminal(&["mail-replyset-send", &arg], true);
    assert_eq!(status, EXIT_OK, "out={out}\nerr={err}");
    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed["success"], true, "{parsed}");
    assert_labelled(&parsed, CONTENT_WORDS);
    assert_eq!(parsed["data"]["state"], "sent");
    assert_eq!(parsed["data"]["sent"], 3);
    assert_eq!(parsed["data"]["total"], 3);
    assert_eq!(parsed["data"]["sentCopies"], 3);

    let received = fixture.smtp.received();
    assert_eq!(received.len(), 3);
    // Recipients are strictly the derived From addresses (never spoof@evil.example!).
    assert_eq!(received[0].to, vec!["ada@example.com"]);
    assert_eq!(received[1].to, vec!["bea@example.org"]);
    assert_eq!(received[2].to, vec!["cam@example.net"]);
    let wire0 = String::from_utf8(received[0].data.clone()).unwrap();
    assert!(wire0.contains("In-Reply-To: <ada0@example.org>"), "{wire0}");
    assert!(!wire0.contains("spoof@evil.example"), "{wire0}");

    // Sent Messages received all 3 copies with `\Seen` (plus initial own0 = 4).
    let sent_box = fixture.server.world().find("Sent Messages").clone();
    assert_eq!(sent_box.messages.len(), 4);
    for msg in sent_box.messages.values() {
        assert!(msg.flags.contains(&"\\Seen".to_string()));
    }

    // Cannot send or edit a sent reply set again.
    let rev_sent = parsed["data"]["revision"].as_i64().unwrap();
    let again = fixture.person(
        "mail-replyset-send",
        json!({ "replyset": set_id, "revision": rev_sent }),
    );
    assert_eq!(again["error"]["code"], "INVALID_INPUT", "{again}");
    let edit_sent = fixture.person(
        "mail-replyset-update",
        json!({ "replyset": set_id, "revision": rev_sent, "sharedText": "nope" }),
    );
    assert_eq!(edit_sent["error"]["code"], "INVALID_INPUT", "{edit_sent}");
}

#[test]
fn recipient_cannot_be_set_by_caller_and_invalid_sources_are_refused() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada0");
    let own_msg = find_message(&fixture, "own0");
    let junk_msg = find_message(&fixture, "junk0");
    let trash_msg = find_message(&fixture, "trash0");

    // Passing forged recipient fields in create/next/update cannot override the
    // derived recipient.
    let created = fixture.agent(
        "tok_a",
        "mail-replyset-create",
        json!({
            "messages": [ada_msg],
            "recipient": "attacker@evil.example",
            "recipients": ["attacker@evil.example"],
            "to": ["attacker@evil.example"],
            "cc": ["attacker@evil.example"],
            "bcc": ["attacker@evil.example"],
        }),
    );
    assert_eq!(created["success"], true, "{created}");
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let reply_id = created["data"]["replyset"]["replies"][0]["reply"]
        .as_i64()
        .unwrap();
    assert_eq!(
        created["data"]["replyset"]["replies"][0]["content"]["recipient"]["address"],
        "ada@example.com"
    );

    let pulled = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(pulled["success"], true, "{pulled}");
    let sub = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": reply_id,
            "unit": pulled["data"]["unit"],
            "claim": pulled["data"]["claim"],
            "text": "Hello Ada.",
            "recipient": "attacker@evil.example",
            "to": ["attacker@evil.example"],
            "subject": "Forged Subject",
            "account": 999,
        }),
    );
    assert_eq!(sub["success"], true, "{sub}");

    let shown = fixture.person("mail-replyset-show", json!({ "replyset": set_id }));
    assert_eq!(
        shown["data"]["replyset"]["replies"][0]["content"]["recipient"]["address"],
        "ada@example.com"
    );

    // Rebuilding derived tables preserves the reply set and stored recipients.
    let rebuilt = fixture.person("mail-rebuild", json!({}));
    assert_eq!(rebuilt["success"], true, "{rebuilt}");
    let after_rebuild = fixture.person("mail-replyset-show", json!({ "replyset": set_id }));
    assert_eq!(after_rebuild["success"], true, "{after_rebuild}");
    assert_eq!(
        after_rebuild["data"]["replyset"]["replies"][0]["content"]["recipient"]["address"],
        "ada@example.com"
    );

    // Refuses own message, junk message, trash message, duplicate message, and >50 messages.
    let own_err = fixture.agent(
        "tok_a",
        "mail-replyset-create",
        json!({ "messages": [own_msg] }),
    );
    assert_eq!(own_err["error"]["code"], "INVALID_INPUT", "{own_err}");

    let junk_err = fixture.agent(
        "tok_a",
        "mail-replyset-create",
        json!({ "messages": [junk_msg] }),
    );
    assert_eq!(junk_err["error"]["code"], "INVALID_INPUT", "{junk_err}");

    let trash_err = fixture.agent(
        "tok_a",
        "mail-replyset-create",
        json!({ "messages": [trash_msg] }),
    );
    assert_eq!(trash_err["error"]["code"], "INVALID_INPUT", "{trash_err}");

    let dup_err = fixture.agent(
        "tok_a",
        "mail-replyset-create",
        json!({ "messages": [ada_msg, ada_msg] }),
    );
    assert_eq!(dup_err["error"]["code"], "INVALID_INPUT", "{dup_err}");

    let too_many: Vec<i64> = (1..=51).collect();
    let cap_err = fixture.agent(
        "tok_a",
        "mail-replyset-create",
        json!({ "messages": too_many }),
    );
    assert_eq!(cap_err["error"]["code"], "INVALID_INPUT", "{cap_err}");
}

#[test]
fn send_guards_m18_incomplete_stale_revision_and_concurrency() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada0");
    let bea_msg = find_message(&fixture, "bea0");

    let created = fixture.agent(
        "tok_a",
        "mail-replyset-create",
        json!({ "messages": [ada_msg, bea_msg] }),
    );
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let bea_reply = created["data"]["replyset"]["replies"][1]["reply"]
        .as_i64()
        .unwrap();

    // 1. Incomplete set over MCP fails with REPLYSET_INCOMPLETE BEFORE any approval hold
    //    (F3 releases mail-replyset-send over MCP under amended M18).
    let over_mcp = fixture.agent(
        "tok_a",
        "mail-replyset-send",
        json!({ "replyset": set_id, "revision": 1 }),
    );
    assert_eq!(
        over_mcp["error"]["code"], "REPLYSET_INCOMPLETE",
        "{over_mcp}"
    );

    // 2. Incomplete set fails with REPLYSET_INCOMPLETE BEFORE any approval hold!
    let incomplete = fixture.person(
        "mail-replyset-send",
        json!({ "replyset": set_id, "revision": 1 }),
    );
    assert_eq!(
        incomplete["error"]["code"], "REPLYSET_INCOMPLETE",
        "{incomplete}"
    );
    assert!(
        incomplete["error"]["details"]
            .get("approvalToken")
            .is_none(),
        "must not issue approval token for incomplete set: {incomplete}"
    );

    // Complete both replies by pulling each unit before submitting.
    let sub_ada = agent_submit_next(&fixture, "tok_a", set_id, "Hi Ada.");
    assert_eq!(sub_ada["success"], true, "{sub_ada}");
    let done = agent_submit_next(&fixture, "tok_a", set_id, "Hi Bea.");
    assert_eq!(done["success"], true, "{done}");
    let rev = done["data"]["revision"].as_i64().unwrap();
    assert_eq!(rev, 3);

    // 3. Stale revision on mail-replyset-show -> PREVIEW_CHANGED.
    let stale_show = fixture.agent(
        "tok_a",
        "mail-replyset-show",
        json!({ "replyset": set_id, "revision": rev - 1 }),
    );
    assert_eq!(
        stale_show["error"]["code"], "PREVIEW_CHANGED",
        "{stale_show}"
    );

    // 4. Stale revision on mail-replyset-send -> PREVIEW_CHANGED BEFORE any hold!
    let stale_send = fixture.person(
        "mail-replyset-send",
        json!({ "replyset": set_id, "revision": rev - 1 }),
    );
    assert_eq!(
        stale_send["error"]["code"], "PREVIEW_CHANGED",
        "{stale_send}"
    );
    assert!(
        stale_send["error"]["details"]
            .get("approvalToken")
            .is_none(),
        "must not issue approval token for stale revision: {stale_send}"
    );

    // 5. Stale revision on mail-replyset-update -> REPLYSET_CHANGED.
    let stale_upd = fixture.agent(
        "tok_a",
        "mail-replyset-update",
        json!({ "replyset": set_id, "revision": rev - 1, "sharedText": "x" }),
    );
    assert_eq!(
        stale_upd["error"]["code"], "REPLYSET_CHANGED",
        "{stale_upd}"
    );

    // 6. Script at CLI gets PERSON_REQUIRED.
    let arg = json!({ "replyset": set_id, "revision": rev }).to_string();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let status = run(
        &["mail-replyset-send".to_string(), arg],
        &fixture.registry,
        Caller::Script,
        &InMemory::default(),
        &mut out,
        &mut err,
    )
    .unwrap();
    assert_eq!(status, EXIT_FAILED);
    let script_out = String::from_utf8(out).unwrap();
    assert!(script_out.contains("PERSON_REQUIRED"), "{script_out}");

    // 7. Modifying the set AFTER an approval token was issued fails inside the
    // handler transaction with PREVIEW_CHANGED and sends nothing!
    let held = fixture.person(
        "mail-replyset-send",
        json!({ "replyset": set_id, "revision": rev }),
    );
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
    let token = held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let raced = fixture.agent(
        "tok_a",
        "mail-replyset-update",
        json!({
            "replyset": set_id,
            "revision": rev,
            "reply": bea_reply,
            "text": "Tampered after preview!",
        }),
    );
    assert_eq!(raced["success"], true, "{raced}");
    let context = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Human)
        .with_approval(token);
    let blocked = fixture.execute(
        "mail-replyset-send",
        json!({ "replyset": set_id, "revision": rev }),
        context,
    );
    assert_eq!(blocked["error"]["code"], "PREVIEW_CHANGED", "{blocked}");
    assert!(fixture.smtp.received().is_empty());

    // 8. Direct store check of `begin_replyset_send`'s own in-transaction
    // revision guard (protects against tight races after pre_approval_check).
    let in_tx = fixture
        .engine
        .with_store(|store| store.begin_replyset_send(set_id, rev))
        .unwrap();
    assert_eq!(
        in_tx,
        Err(ReplySetSendRefusal::Changed { revision: rev + 1 })
    );
}

#[test]
fn partial_batch_failure_resumes_only_unsent_and_unknown_never_retries() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada0");
    let bea_msg = find_message(&fixture, "bea0");
    let cam_msg = find_message(&fixture, "cam0");

    let created = fixture.person(
        "mail-replyset-create",
        json!({
            "messages": [ada_msg, bea_msg, cam_msg],
            "sharedText": "One.",
        }),
    );
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let _ = person_submit_next(&fixture, set_id, "One.");
    let _ = person_submit_next(&fixture, set_id, "Two.");
    let ready = person_submit_next(&fixture, set_id, "Three.");
    let rev = ready["data"]["revision"].as_i64().unwrap();

    // 1. Clean pre-handover failure on first reply keeps set `open` AND raises
    // revision because the reply's visible state (`failed`) and outbound id changed.
    fixture.smtp.world().fault = Some(SmtpFault::RefuseAuth);
    let first_fail = approved_send(&fixture, json!({ "replyset": set_id, "revision": rev }));
    assert_eq!(
        first_fail["error"]["code"], "SIGN_IN_REQUIRED",
        "{first_fail}"
    );
    assert_eq!(first_fail["error"]["details"]["state"], "open");
    let rev_after_auth = first_fail["error"]["details"]["revision"].as_i64().unwrap();
    assert_eq!(rev_after_auth, rev + 1);
    assert!(fixture.smtp.received().is_empty());
    // Stale revision must fail mail-replyset-show with PREVIEW_CHANGED.
    let stale_after_fail = fixture.person(
        "mail-replyset-show",
        json!({ "replyset": set_id, "revision": rev }),
    );
    assert_eq!(
        stale_after_fail["error"]["code"], "PREVIEW_CHANGED",
        "{stale_after_fail}"
    );

    // 2. Permanent 550 refusal on reply 1 also keeps `open` and bumps revision.
    fixture.smtp.world().fault = Some(SmtpFault::RefuseAfterData(550));
    let refused = approved_send(
        &fixture,
        json!({ "replyset": set_id, "revision": rev_after_auth }),
    );
    assert_eq!(refused["error"]["code"], "PROVIDER_REFUSED", "{refused}");
    assert_eq!(refused["error"]["retryable"], false);
    let rev_after_550 = refused["error"]["details"]["revision"].as_i64().unwrap();
    assert_eq!(rev_after_550, rev_after_auth + 1);
    assert_eq!(
        fixture.person("mail-replyset-show", json!({ "replyset": set_id }))["data"]["replyset"]["state"],
        "open"
    );

    // 3. Real mid-batch partial failure via scripted SMTP: accept reply 1 (Ada),
    // refuse reply 2 (Bea) with 550 before handover -> SendReplySet itself
    // transitions the set to `partial` at a bumped revision!
    {
        let mut smtp_w = fixture.smtp.world();
        smtp_w.fault = None;
        smtp_w.faults = VecDeque::from([None, Some(SmtpFault::RefuseAfterData(550))]);
    }
    let mid_fail = approved_send(
        &fixture,
        json!({ "replyset": set_id, "revision": rev_after_550 }),
    );
    assert_eq!(mid_fail["error"]["code"], "PROVIDER_REFUSED", "{mid_fail}");
    assert_eq!(mid_fail["error"]["details"]["state"], "partial");
    assert_eq!(mid_fail["error"]["details"]["sent"], 1);
    assert_eq!(mid_fail["error"]["details"]["remaining"], 2);
    let partial_rev = mid_fail["error"]["details"]["revision"].as_i64().unwrap();
    assert_eq!(partial_rev, rev_after_550 + 1);
    assert_eq!(
        fixture
            .smtp
            .received()
            .into_iter()
            .map(|m| m.to)
            .collect::<Vec<_>>(),
        vec![vec!["ada@example.com"]]
    );

    let partial_show = fixture.person("mail-replyset-show", json!({ "replyset": set_id }));
    assert_eq!(partial_show["data"]["replyset"]["state"], "partial");
    assert_eq!(
        partial_show["data"]["replyset"]["replies"][0]["state"],
        "sent"
    );
    assert_eq!(
        partial_show["data"]["replyset"]["replies"][1]["state"],
        "failed"
    );
    assert_eq!(
        partial_show["data"]["replyset"]["replies"][2]["state"],
        "open"
    );

    // Old revision is refused with PREVIEW_CHANGED.
    let stale_partial = fixture.person(
        "mail-replyset-send",
        json!({ "replyset": set_id, "revision": rev_after_550 }),
    );
    assert_eq!(
        stale_partial["error"]["code"], "PREVIEW_CHANGED",
        "{stale_partial}"
    );

    // Terminal preview of a `partial` set MUST still list EVERY recipient
    // (including already-sent Ada marked clearly) and every difference marker!
    let partial_arg = json!({ "replyset": set_id }).to_string();
    let (declined, _cli_out, cli_err_text, _) =
        fixture.terminal(&["mail-replyset-send", &partial_arg], false);
    assert_eq!(declined, EXIT_FAILED);
    assert!(
        cli_err_text.contains("[already sent; will not be sent again]")
            && cli_err_text.contains("ada@example.com")
            && cli_err_text.contains("[matches shared text]"),
        "partial preview must show already-sent recipient and difference marker: {cli_err_text}"
    );
    assert!(
        cli_err_text.contains("bea@example.org")
            && cli_err_text.contains("cam@example.net")
            && cli_err_text.contains("[DIFFERS from shared text]"),
        "partial preview must show remaining recipients and difference markers: {cli_err_text}"
    );

    // Sending at partial_rev sends ONLY Bea and Cam (2 messages, never resending Ada!).
    let resumed = approved_send(
        &fixture,
        json!({ "replyset": set_id, "revision": partial_rev }),
    );
    assert_eq!(resumed["success"], true, "{resumed}");
    assert_eq!(resumed["data"]["state"], "sent");
    assert_eq!(resumed["data"]["sent"], 2);
    assert_eq!(resumed["data"]["total"], 3);
    let sent_rcpts: Vec<Vec<String>> = fixture.smtp.received().into_iter().map(|m| m.to).collect();
    assert_eq!(
        sent_rcpts,
        vec![
            vec!["ada@example.com"],
            vec!["bea@example.org"],
            vec!["cam@example.net"]
        ]
    );

    // 4. Post-handover DropAfterData -> SEND_OUTCOME_UNKNOWN, reported in
    // mail-status, and never retried!
    let created2 = fixture.person("mail-replyset-create", json!({ "messages": [ada_msg] }));
    let set2 = created2["data"]["replyset"]["id"].as_i64().unwrap();
    let sub2 = person_submit_next(&fixture, set2, "Hi Ada again.");
    let rev2 = sub2["data"]["revision"].as_i64().unwrap();

    fixture.smtp.world().fault = Some(SmtpFault::DropAfterHandover);
    let unknown = approved_send(&fixture, json!({ "replyset": set2, "revision": rev2 }));
    assert_eq!(
        unknown["error"]["code"], "SEND_OUTCOME_UNKNOWN",
        "{unknown}"
    );
    assert_eq!(unknown["error"]["retryable"], false);
    let rev2_after = unknown["error"]["details"]["revision"].as_i64().unwrap();

    // Reported in mail-status under outbound.unknownSends with kind = "replyset".
    let status = fixture.person("mail-status", json!({}));
    assert_eq!(status["data"]["outbound"]["unknown"], 1, "{status}");
    assert_eq!(
        status["data"]["outbound"]["unknownSends"][0]["kind"],
        "replyset"
    );

    // Never retried, even with the updated revision.
    fixture.smtp.world().fault = None;
    let retry_unknown = fixture.person(
        "mail-replyset-send",
        json!({ "replyset": set2, "revision": rev2_after }),
    );
    assert_eq!(
        retry_unknown["error"]["code"], "SEND_OUTCOME_UNKNOWN",
        "{retry_unknown}"
    );
}

#[test]
fn preview_too_large_is_atomic_and_unheld_body_returns_not_held() {
    let fixture = Fixture::new(|w| {
        w.mailbox("INBOX", &[]);
        w.mailbox("Sent Messages", &["\\Sent"]);
        for i in 0..35 {
            w.add(
                "INBOX",
                mail(
                    &format!("Person{i} <p{i}@example.com>"),
                    &format!("m{i}"),
                    "To: person@example.com\r\n",
                ),
                &[],
            );
        }
    });

    // Build a 35-reply set and fill replies with worst-case escaped text (`"` -> 6 bytes
    // in MCP reply) until hitting PREVIEW_TOO_LARGE; verify the failing call leaves the
    // reply set's revision and text untouched!
    let mut ids = Vec::new();
    for i in 0..35 {
        ids.push(find_message(&fixture, &format!("m{i}")));
    }
    let created = fixture.agent("tok_a", "mail-replyset-create", json!({ "messages": ids }));
    assert_eq!(created["success"], true, "{created}");
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let reply_ids: Vec<i64> = created["data"]["replyset"]["replies"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["reply"].as_i64().unwrap())
        .collect();

    // Each worst-case 30,000-quote string is ~180 KiB in MCP reply_size, so ~20 replies
    // will hit the 3.5 MiB MCP preview cap (MAX_PREVIEW_MCP_BYTES).
    let worst_text = "\"".repeat(30_000);
    let mut hit_too_large = false;
    let mut last_good_rev = 1i64;
    for _ in &reply_ids {
        let res = agent_submit_next(&fixture, "tok_a", set_id, &worst_text);
        if res["success"] == true {
            last_good_rev = res["data"]["revision"].as_i64().unwrap();
        } else {
            assert_eq!(res["error"]["code"], "PREVIEW_TOO_LARGE", "{res}");
            assert_eq!(res["error"]["retryable"], false);
            hit_too_large = true;
            break;
        }
    }
    assert!(
        hit_too_large,
        "expected PREVIEW_TOO_LARGE before 35 worst-case replies"
    );
    // Verify the set is still at last_good_rev and mail-replyset-show still succeeds whole!
    let shown = fixture.agent("tok_a", "mail-replyset-show", json!({ "replyset": set_id }));
    assert_eq!(shown["success"], true, "{shown}");
    assert_eq!(shown["data"]["replyset"]["revision"], last_good_rev);

    // Near-limit headroom check: build a 21-reply set right up to the exact
    // accepted preview boundary, trigger a partial send failure (which adds
    // `partial`, `sent`, `failed`, outbound IDs, and bumped revision), and
    // verify `mail-replyset-show` STILL succeeds whole!
    let near_ids: Vec<i64> = ids.iter().take(21).copied().collect();
    let near = fixture.person("mail-replyset-create", json!({ "messages": near_ids }));
    let near_id = near["data"]["replyset"]["id"].as_i64().unwrap();
    let near_replies: Vec<i64> = near["data"]["replyset"]["replies"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["reply"].as_i64().unwrap())
        .collect();
    // Fill 19 replies with large quoted text (~180 KiB MCP each -> ~3.42 MiB)
    // and push the remaining replies right up to the exact PREVIEW_TOO_LARGE boundary.
    for idx in 0..19 {
        let sub = person_submit_next(&fixture, near_id, &"\"".repeat(30_000));
        assert_eq!(sub["success"], true, "reply {idx}: {sub}");
    }
    let sub19 = person_submit_next(&fixture, near_id, "Reply 20.");
    assert_eq!(sub19["success"], true, "{sub19}");
    let sub20 = person_submit_next(&fixture, near_id, "Reply 21.");
    assert_eq!(sub20["success"], true, "{sub20}");
    let mut near_rev = sub20["data"]["revision"].as_i64().unwrap();
    // Binary-search sharedText and replies 19 & 20 right up to the exact accepted limit!
    let mut hit_boundary = false;
    for fill_kind in ["shared", "r19", "r20"] {
        let mut lo = 1usize;
        let mut hi = 32_768usize;
        while lo < hi {
            let mid = lo + (hi - lo).div_ceil(2);
            let payload = match fill_kind {
                "shared" => json!({
                    "replyset": near_id,
                    "revision": near_rev,
                    "sharedText": "\"".repeat(mid),
                }),
                "r19" => json!({
                    "replyset": near_id,
                    "revision": near_rev,
                    "reply": near_replies[19],
                    "text": "\"".repeat(mid),
                }),
                _ => json!({
                    "replyset": near_id,
                    "revision": near_rev,
                    "reply": near_replies[20],
                    "text": "\"".repeat(mid),
                }),
            };
            let res = fixture.person("mail-replyset-update", payload);
            if res["success"] == true {
                near_rev = res["data"]["replyset"]["revision"].as_i64().unwrap();
                lo = mid;
            } else {
                assert_eq!(res["error"]["code"], "PREVIEW_TOO_LARGE", "{res}");
                hit_boundary = true;
                hi = mid - 1;
            }
        }
    }
    assert!(
        hit_boundary,
        "near-limit set should actually reach the PREVIEW_TOO_LARGE boundary"
    );
    // Now trigger a real partial send failure (reply 1 sent, reply 2 550-refused).
    {
        let mut smtp_w = fixture.smtp.world();
        smtp_w.fault = None;
        smtp_w.faults = VecDeque::from([None, Some(SmtpFault::RefuseAfterData(550))]);
    }
    let partial_near = approved_send(
        &fixture,
        json!({ "replyset": near_id, "revision": near_rev }),
    );
    assert_eq!(
        partial_near["error"]["code"], "PROVIDER_REFUSED",
        "{partial_near}"
    );
    assert_eq!(partial_near["error"]["details"]["state"], "partial");
    let near_show = fixture.person("mail-replyset-show", json!({ "replyset": near_id }));
    assert_eq!(
        near_show["success"], true,
        "partial send must never push an accepted set over PREVIEW_TOO_LARGE: {near_show}"
    );
    assert_eq!(near_show["data"]["replyset"]["state"], "partial");

    // Verify NOT_HELD when a message's body is not held yet.
    let header_only_fixture = Fixture::new(|w| {
        w.mailbox("INBOX", &[]);
        w.add(
            "INBOX",
            mail(ADA, "unheld0", "To: person@example.com\r\n"),
            &[],
        );
        // Withhold UID 1's body on sync so only headers are held.
        w.mailboxes[0].never_return_body.insert(1);
    });
    let unheld_id = find_message(&header_only_fixture, "unheld0");
    let set_unheld = header_only_fixture.agent(
        "tok_a",
        "mail-replyset-create",
        json!({ "messages": [unheld_id] }),
    );
    assert_eq!(set_unheld["success"], true, "{set_unheld}");
    let unheld_set_id = set_unheld["data"]["replyset"]["id"].as_i64().unwrap();
    let next_unheld = header_only_fixture.agent(
        "tok_a",
        "mail-replyset-next",
        json!({ "replyset": unheld_set_id }),
    );
    assert_eq!(next_unheld["error"]["code"], "NOT_HELD", "{next_unheld}");
    assert_eq!(next_unheld["error"]["retryable"], true);
}

#[test]
fn interrupted_sending_recovers_to_unknown_on_reopen_and_account_remove_cleans_up() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada0");
    let created = fixture.person("mail-replyset-create", json!({ "messages": [ada_msg] }));
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let r0 = created["data"]["replyset"]["replies"][0]["reply"]
        .as_i64()
        .unwrap();
    let sub = person_submit_next(&fixture, set_id, "Hi Ada.");
    let rev = sub["data"]["revision"].as_i64().unwrap();

    // Put the reply set and reply into `sending` as if a process crashed mid-SMTP.
    fixture
        .engine
        .with_store(|store| {
            let _ = store.begin_replyset_send(set_id, rev)?;
            store.begin_replyset_reply_send(
                set_id,
                r0,
                fixture.account.id,
                rev,
                "crash-mid-send@example.com",
                &loam_mail::store::Proposer {
                    kind: "human".to_string(),
                    id: None,
                },
                500,
            )?;
            Ok(())
        })
        .unwrap();

    // While sending, mail-account-remove is refused with WORK_RUNNING.
    let held_rm = fixture.person(
        "mail-account-remove",
        json!({ "account": fixture.account.id.0 }),
    );
    let token = held_rm["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let ctx = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Human)
        .with_approval(token);
    let blocked_rm = fixture.execute(
        "mail-account-remove",
        json!({ "account": fixture.account.id.0 }),
        ctx,
    );
    assert_eq!(blocked_rm["error"]["code"], "WORK_RUNNING", "{blocked_rm}");

    // Drop the engine and reopen the store -> interrupted sending becomes `unknown`.
    let data_dir = fixture.directory.path().join("data");
    let account_id = fixture.account.id.0;
    drop(fixture.registry);
    drop(fixture.engine);
    let engine2 = Arc::new(Engine::new(Some(Home::at(data_dir))));
    let reg2 = loam_mail::registry(&engine2).unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let show_after = runtime.block_on(
        reg2.execute(
            "mail-replyset-show",
            json!({ "replyset": set_id }),
            Some(
                CommandContext::new()
                    .with_interface(CommandInterface::Cli)
                    .with_actor(ActorKind::Human),
            ),
        ),
    );
    let show_val = serde_json::to_value(&show_after).unwrap();
    assert_eq!(
        show_val["data"]["replyset"]["state"], "unknown",
        "{show_val}"
    );
    assert_eq!(
        show_val["data"]["replyset"]["replies"][0]["state"],
        "unknown"
    );

    // Now mail-account-remove succeeds and cleans up the reply set.
    let held_rm2 = runtime.block_on(
        reg2.execute(
            "mail-account-remove",
            json!({ "account": account_id }),
            Some(
                CommandContext::new()
                    .with_interface(CommandInterface::Cli)
                    .with_actor(ActorKind::Human),
            ),
        ),
    );
    let rm2_val = serde_json::to_value(&held_rm2).unwrap();
    assert!(
        rm2_val["error"]["details"]["summary"]
            .as_str()
            .unwrap()
            .contains("1 reply set"),
        "{rm2_val}"
    );
    let tok2 = rm2_val["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let removed = runtime.block_on(
        reg2.execute(
            "mail-account-remove",
            json!({ "account": account_id }),
            Some(
                CommandContext::new()
                    .with_interface(CommandInterface::Cli)
                    .with_actor(ActorKind::Human)
                    .with_approval(tok2),
            ),
        ),
    );
    assert!(removed.success, "{removed:?}");

    let gone = runtime.block_on(
        reg2.execute(
            "mail-replyset-show",
            json!({ "replyset": set_id }),
            Some(
                CommandContext::new()
                    .with_interface(CommandInterface::Cli)
                    .with_actor(ActorKind::Human),
            ),
        ),
    );
    assert!(!gone.success);
    assert_eq!(gone.error.unwrap().code, "REPLYSET_NOT_FOUND");
}

#[test]
fn journal_redacts_replyset_result_content_and_approval_tokens() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada0");
    let created = fixture.agent(
        "tok_a",
        "mail-replyset-create",
        json!({
            "messages": [ada_msg],
            "sharedText": "Shared closing: Thursday works.",
        }),
    );
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let r0 = created["data"]["replyset"]["replies"][0]["reply"]
        .as_i64()
        .unwrap();

    // Pull unit (read: NOT journaled!) and submit (claim MUST be redacted from journal!).
    let pulled = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(pulled["success"], true, "{pulled}");
    let claim = pulled["data"]["claim"].as_str().unwrap().to_string();
    let sub = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": r0,
            "unit": pulled["data"]["unit"],
            "claim": claim,
            "text": "Shared closing: Thursday works.",
        }),
    );
    assert_eq!(sub["success"], true, "{sub}");
    let rev = sub["data"]["revision"].as_i64().unwrap();

    // Hold mail-replyset-send -> approvalToken must be stripped from journal.
    let held = fixture.person(
        "mail-replyset-send",
        json!({ "replyset": set_id, "revision": rev }),
    );
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED");
    let held_token = held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();

    let journal_path = fixture.directory.path().join("data").join("journal.jsonl");
    let contents = std::fs::read_to_string(&journal_path).unwrap();
    assert!(!contents.contains(&held_token), "{contents}");
    assert!(
        !contents.contains(&claim),
        "claim leaked into journal: {contents}"
    );
    // Verify no journaled result kept `content` (especially Ada's read message body!).
    assert!(
        !contents.contains("Can we meet on Thursday?"),
        "read message body leaked into journal: {contents}"
    );
    for line in contents.lines() {
        let entry: Value = serde_json::from_str(line).unwrap();
        assert!(
            entry
                .pointer("/result/error/details/approvalToken")
                .is_none(),
            "approvalToken leaked in journal entry: {entry}"
        );
        let cmd = entry["command"].as_str().unwrap_or_default();
        assert_ne!(
            cmd, "mail-replyset-next",
            "mail-replyset-next is a read and must not be journaled: {entry}"
        );
        if cmd == "mail-replyset-submit" {
            assert!(
                entry.pointer("/input/claim").is_none(),
                "claim leaked in submit input: {entry}"
            );
        }
        if matches!(cmd, "mail-replyset-create" | "mail-replyset-update") {
            assert!(
                entry.pointer("/result/data/content").is_none(),
                "content leaked in {cmd}: {entry}"
            );
            assert!(
                entry.pointer("/result/data/replyset/content").is_none(),
                "replyset content leaked in {cmd}: {entry}"
            );
            if let Some(replies) = entry
                .pointer("/result/data/replyset/replies")
                .and_then(Value::as_array)
            {
                for r in replies {
                    assert!(
                        r.get("content").is_none(),
                        "reply content leaked in {cmd}: {entry}"
                    );
                }
            }
        }
    }
}

#[test]
fn store_upgrades_from_migration_18_to_19() {
    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("data"));
    {
        let store = Store::open(&home).unwrap();
        assert!(store.schema_version().unwrap() >= 19);
    }
    // Wind back to schema version 18 and reopen to verify forward migration 19.
    {
        let conn = rusqlite::Connection::open(home.database()).unwrap();
        conn.execute_batch(
            "DROP TABLE instance_proof_key;
             DROP TABLE replyset_claim_key;
             ALTER TABLE draft DROP COLUMN recipient_bases;
             DROP TABLE proposed_story_member;
             DROP TABLE proposed_story;
             DROP TABLE account_policy;
             ALTER TABLE operation DROP COLUMN proposal_generation;
             DROP TABLE replyset_event;
             DROP TABLE replyset_question_reply;
             DROP TABLE replyset_question;
             DROP TABLE replyset_reply;
             DROP TABLE replyset;
             PRAGMA user_version = 18;",
        )
        .unwrap();
    }
    let store = Store::open(&home).unwrap();
    assert!(store.schema_version().unwrap() >= 19);
}

#[test]
fn sent_copy_failure_still_succeeds_with_warning_and_drop_guard_marks_stalled_send_unknown() {
    // 1. IMAP APPEND refused -> send succeeds with SENT_COPY_FAILED warning.
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada0");
    let created = fixture.person("mail-replyset-create", json!({ "messages": [ada_msg] }));
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let sub = person_submit_next(&fixture, set_id, "Hi Ada.");
    let rev = sub["data"]["revision"].as_i64().unwrap();

    fixture.server.world().refuse_append = true;
    let sent = approved_send(&fixture, json!({ "replyset": set_id, "revision": rev }));
    assert_eq!(sent["success"], true, "{sent}");
    assert_eq!(sent["data"]["sentCopies"], 0);
    assert_eq!(sent["warnings"][0]["code"], "SENT_COPY_FAILED", "{sent}");

    // 2. Dropping an in-flight stalled SMTP send marks outbound, reply, and replyset `unknown`.
    let created2 = fixture.person("mail-replyset-create", json!({ "messages": [ada_msg] }));
    let set2 = created2["data"]["replyset"]["id"].as_i64().unwrap();
    let sub2 = person_submit_next(&fixture, set2, "Hi Ada stalled.");
    let rev2 = sub2["data"]["revision"].as_i64().unwrap();

    let held = fixture.person(
        "mail-replyset-send",
        json!({ "replyset": set2, "revision": rev2 }),
    );
    let token = held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    fixture.smtp.world().fault = Some(SmtpFault::StallAfterData);
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let timed_out = rt.block_on(async {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human)
            .with_approval(token);
        tokio::time::timeout(
            std::time::Duration::from_millis(250),
            fixture.registry.execute(
                "mail-replyset-send",
                json!({ "replyset": set2, "revision": rev2 }),
                Some(context),
            ),
        )
        .await
    });
    assert!(
        timed_out.is_err(),
        "expected stalled SMTP send to time out and drop"
    );

    // Drop guard immediately settled the set and reply to `unknown`.
    let after = fixture.person("mail-replyset-show", json!({ "replyset": set2 }));
    assert_eq!(after["data"]["replyset"]["state"], "unknown", "{after}");
    assert_eq!(after["data"]["replyset"]["replies"][0]["state"], "unknown");
    let status = fixture.person("mail-status", json!({}));
    assert_eq!(status["data"]["outbound"]["unknown"], 1, "{status}");
}

#[tokio::test]
async fn mcp_exposure_hides_send_and_lists_local_and_read_commands() {
    use axum::body::Body;
    use http_body_util::BodyExt;
    use loam_mail::cli::{Local, Runner};
    use loam_mail::serve::router;
    use tower::ServiceExt;

    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("mail"));
    let engine = Arc::new(Engine::new(Some(home)));
    let registry = loam_mail::registry(&engine).unwrap();
    engine.open_store().unwrap();

    // Create an agent token.
    let local = Local(&registry);
    let held = local
        .run("mail-token-create", json!({ "name": "agent" }), true, None)
        .await;
    let tok = held.error.unwrap().details.unwrap()["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let made = local
        .run(
            "mail-token-create",
            json!({ "name": "agent" }),
            true,
            Some(tok),
        )
        .await;
    let secret = made.data.unwrap()["secret"].as_str().unwrap().to_string();
    let app = router(&registry, Arc::clone(&engine), 4322, "lmail_cli_test").unwrap();

    let post_mcp = |method: &str, params: Value| {
        let app = app.clone();
        let secret = secret.clone();
        let method = method.to_string();
        async move {
            let mut params = params;
            params["_meta"] = json!({
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
            });
            let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
            let mut builder = axum::http::Request::post("/mcp")
                .header("host", "127.0.0.1:4322")
                .header("content-type", "application/json")
                .header("accept", "application/json, text/event-stream")
                .header("mcp-protocol-version", "2026-07-28")
                .header("mcp-method", &method)
                .header("authorization", format!("Bearer {secret}"));
            if let Some(name) = body["params"]["name"].as_str() {
                builder = builder.header("mcp-name", name);
            }
            let req = builder.body(Body::from(body.to_string())).unwrap();
            let resp = app.oneshot(req).await.unwrap();
            assert_eq!(resp.status().as_u16(), 200);
            let bytes = resp.into_body().collect().await.unwrap().to_bytes();
            let text = String::from_utf8_lossy(&bytes).to_string();
            serde_json::from_str::<Value>(&text).unwrap_or_else(|_| {
                text.lines()
                    .find_map(|line| line.strip_prefix("data: "))
                    .and_then(|data| serde_json::from_str(data).ok())
                    .unwrap_or(Value::String(text))
            })
        }
    };

    // 1. afd-help lists create, update, next, submit, show, and released mail-replyset-send (F3).
    let help = post_mcp(
        "tools/call",
        json!({ "name": "afd-call", "arguments": { "command": "afd-help", "input": { "format": "full" } } }),
    )
    .await;
    let help_str = help.to_string();
    assert!(help_str.contains("mail-replyset-create"), "{help_str}");
    assert!(help_str.contains("mail-replyset-update"), "{help_str}");
    assert!(help_str.contains("mail-replyset-next"), "{help_str}");
    assert!(help_str.contains("mail-replyset-submit"), "{help_str}");
    assert!(help_str.contains("mail-replyset-show"), "{help_str}");
    assert!(help_str.contains("mail-replyset-send"), "{help_str}");

    // 2. Calling mail-replyset-send over HTTP MCP for a nonexistent set fails
    //    with REPLYSET_NOT_FOUND before any hold (never sends or issues a token).
    let call_send = post_mcp(
        "tools/call",
        json!({
            "name": "afd-call",
            "arguments": {
                "command": "mail-replyset-send",
                "input": { "replyset": 1, "revision": 1 }
            }
        }),
    )
    .await;
    assert_eq!(
        call_send["result"]["structuredContent"]["error"]["code"], "REPLYSET_NOT_FOUND",
        "{call_send}"
    );
}

#[test]
fn mixed_case_local_part_and_unicode_subjects_are_preserved_without_panic() {
    let fixture = Fixture::new(|w| {
        w.mailbox("INBOX", &[]);
        w.mailbox("Sent Messages", &["\\Sent"]);
        // Mixed-case local part + 4-byte emoji subject (byte index 3 is inside 🎉).
        w.add(
            "INBOX",
            "From: Sales Team <Sales.Dept@Example.COM>\r\n\
             Message-ID: <mix0@example.com>\r\n\
             Subject: =?utf-8?B?8J+OiSBQYXJ0eSB0b25pZ2h0?=\r\n\
             To: person@example.com\r\n\r\n\
             Can we confirm?\r\n"
                .as_bytes()
                .to_vec(),
            &[],
        );
        // Two 2-byte Cyrillic chars (byte index 3 is inside the second char).
        w.add(
            "INBOX",
            "From: Ivan <Ivan.Petrov@Example.ORG>\r\n\
             Message-ID: <cyr0@example.org>\r\n\
             Subject: =?utf-8?B?0J/RgNC40LLQtdGCINC80LjRgA==?=\r\n\
             To: person@example.com\r\n\r\n\
             Hello from Ivan.\r\n"
                .as_bytes()
                .to_vec(),
            &[],
        );
        // 1 ASCII byte + 3-byte em-dash (byte index 3 is inside —).
        w.add(
            "INBOX",
            "From: Dana <Dana@Example.NET>\r\n\
             Message-ID: <dash0@example.net>\r\n\
             Subject: =?utf-8?B?YeKAlGI=?=\r\n\
             To: person@example.com\r\n\r\n\
             Dash subject.\r\n"
                .as_bytes()
                .to_vec(),
            &[],
        );
    });
    let mix_msg = find_message(&fixture, "confirm");
    let cyr_msg = find_message(&fixture, "Ivan");
    let dash_msg = find_message(&fixture, "Dash subject");

    let created = fixture.person(
        "mail-replyset-create",
        json!({ "messages": [mix_msg, cyr_msg, dash_msg] }),
    );
    assert_eq!(created["success"], true, "{created}");
    let replies = created["data"]["replyset"]["replies"].as_array().unwrap();
    assert_eq!(
        replies[0]["content"]["recipient"]["address"],
        "Sales.Dept@example.com"
    );
    assert_eq!(replies[0]["content"]["subject"], "Re: 🎉 Party tonight");
    assert_eq!(
        replies[1]["content"]["recipient"]["address"],
        "Ivan.Petrov@example.org"
    );
    assert_eq!(replies[1]["content"]["subject"], "Re: Привет мир");
    assert_eq!(
        replies[2]["content"]["recipient"]["address"],
        "Dana@example.net"
    );
    assert_eq!(replies[2]["content"]["subject"], "Re: a—b");

    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let _ = person_submit_next(&fixture, set_id, "Confirmed!");
    let _ = person_submit_next(&fixture, set_id, "Privet!");
    let ready = person_submit_next(&fixture, set_id, "Noted!");
    let rev = ready["data"]["revision"].as_i64().unwrap();

    let sent = approved_send(&fixture, json!({ "replyset": set_id, "revision": rev }));
    assert_eq!(sent["success"], true, "{sent}");
    let received = fixture.smtp.received();
    assert_eq!(received.len(), 3);
    assert_eq!(received[0].to, vec!["Sales.Dept@example.com"]);
    let raw0 = String::from_utf8_lossy(&received[0].data);
    assert!(
        raw0.contains("To: Sales.Dept@example.com\r\n"),
        "wire To header must preserve local-part case: {raw0}"
    );
    assert_eq!(received[1].to, vec!["Ivan.Petrov@example.org"]);
    assert_eq!(received[2].to, vec!["Dana@example.net"]);
}

#[test]
fn unit_handout_binds_generation_answers_and_budget_truncated_digest() {
    let long_body = format!("Opening sentence. {}", "details ".repeat(600));
    let fixture = Fixture::new(move |w| {
        w.mailbox("INBOX", &[]);
        w.mailbox("Sent Messages", &["\\Sent"]);
        w.add(
            "INBOX",
            format!(
                "From: {ADA}\r\nMessage-ID: <long0@example.org>\r\nSubject: Long note\r\n\
                 To: person@example.com\r\n\r\n{long_body}\r\n"
            )
            .into_bytes(),
            &[],
        );
        w.add(
            "INBOX",
            mail(BEA, "bea0", "To: person@example.com\r\n"),
            &[],
        );
    });
    let ada_msg = find_message(&fixture, "Opening sentence");
    let bea_msg = find_message(&fixture, "bea0");

    let created = fixture.agent(
        "tok_a",
        "mail-replyset-create",
        json!({
            "messages": [ada_msg, bea_msg],
            "questions": [{
                "question": "What time?",
                "messages": [ada_msg],
                "answer": "2pm",
            }],
        }),
    );
    assert_eq!(created["success"], true, "{created}");
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let ada_reply = created["data"]["replyset"]["replies"][0]["reply"]
        .as_i64()
        .unwrap();
    let q_id = created["data"]["replyset"]["content"]["questions"][0]["id"]
        .as_i64()
        .unwrap();

    // 1. Submitting with a guessed claim fails with UNIT_NOT_OPEN.
    let guessed = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": ada_reply,
            "unit": format!("rsu_{set_id}_{ada_reply}_1"),
            "claim": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "text": "Guessed claim.",
        }),
    );
    assert_eq!(guessed["error"]["code"], "UNIT_NOT_OPEN", "{guessed}");

    // 2. Pulling with a budget smaller than the canonical unit returns OUTPUT_BUDGET_EXCEEDED,
    //    while pulling at the default budget succeeds and returns unit + claim + digest.
    let tight_ctx = CommandContext::new()
        .with_interface(CommandInterface::Mcp)
        .with_actor(Actor::new(ActorKind::Agent).with_id("tok_a"))
        .with_output_budget_ask(900);
    let too_tight = fixture.execute(
        "mail-replyset-next",
        json!({ "replyset": set_id }),
        tight_ctx,
    );
    assert_eq!(
        too_tight["error"]["code"], "OUTPUT_BUDGET_EXCEEDED",
        "{too_tight}"
    );

    let pulled = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(pulled["success"], true, "{pulled}");
    let handed_unit = pulled["data"]["unit"].as_str().unwrap().to_string();
    let handed_claim = pulled["data"]["claim"].as_str().unwrap().to_string();
    let handed_digest = pulled["data"]["inputs"]["sourceTextDigest"]
        .as_str()
        .unwrap()
        .to_string();

    // 3. Updating a linked answer invalidates the open unit -> stale submit fails!
    let ans_upd = fixture.person(
        "mail-replyset-update",
        json!({
            "replyset": set_id,
            "revision": 1,
            "answers": [{ "question": q_id, "answer": "3pm instead" }],
        }),
    );
    assert_eq!(ans_upd["success"], true, "{ans_upd}");
    let rev_after_ans = ans_upd["data"]["replyset"]["revision"].as_i64().unwrap();
    let stale_after_ans = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": ada_reply,
            "unit": handed_unit,
            "claim": handed_claim,
            "text": "See you at 2pm.",
        }),
    );
    assert_eq!(
        stale_after_ans["error"]["code"], "UNIT_NOT_OPEN",
        "{stale_after_ans}"
    );

    // 4. Pull again -> new unit + claim succeed and store exact digest,
    //    updated answer revision 2, and instructionsVersion.
    let pulled2 = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(pulled2["success"], true, "{pulled2}");
    let unit2 = pulled2["data"]["unit"].as_str().unwrap().to_string();
    let claim2 = pulled2["data"]["claim"].as_str().unwrap().to_string();
    let digest2 = pulled2["data"]["inputs"]["sourceTextDigest"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(digest2, handed_digest);
    assert_ne!(unit2, handed_unit);
    assert_ne!(claim2, handed_claim);

    // Passing stale `unit` with new `claim` (or stale `claim` with new `unit`) fails with UNIT_NOT_OPEN.
    let wrong_unit = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": ada_reply,
            "unit": handed_unit,
            "claim": claim2,
            "text": "Wrong unit.",
        }),
    );
    assert_eq!(wrong_unit["error"]["code"], "UNIT_NOT_OPEN", "{wrong_unit}");

    let submitted = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": ada_reply,
            "unit": unit2,
            "claim": claim2,
            "text": "See you at 3pm.",
        }),
    );
    assert_eq!(submitted["success"], true, "{submitted}");
    let shown_after_ada = fixture.person("mail-replyset-show", json!({ "replyset": set_id }));
    assert_eq!(
        shown_after_ada["data"]["replyset"]["replies"][0]["inputs"]["sourceTextDigest"],
        digest2
    );
    assert_eq!(
        shown_after_ada["data"]["replyset"]["replies"][0]["inputs"]["answers"],
        json!([{ "question": q_id, "revision": 2 }])
    );
    assert_eq!(
        shown_after_ada["data"]["replyset"]["replies"][0]["inputs"]["instructionsVersion"],
        loam_mail::replysets::INSTRUCTIONS_VERSION
    );

    // 5. Pull Bea's unit, then have the person edit Bea via mail-replyset-update ->
    // late agent submit must fail with UNIT_NOT_OPEN and NOT overwrite person's edit!
    let bea_unit = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(bea_unit["success"], true, "{bea_unit}");
    let bea_reply = bea_unit["data"]["reply"].as_i64().unwrap();
    let bea_unit_id = bea_unit["data"]["unit"].as_str().unwrap().to_string();
    let bea_claim = bea_unit["data"]["claim"].as_str().unwrap().to_string();
    let rev_now = submitted["data"]["revision"].as_i64().unwrap();
    assert_eq!(rev_now, rev_after_ans + 1);
    let person_edit = fixture.person(
        "mail-replyset-update",
        json!({
            "replyset": set_id,
            "revision": rev_now,
            "reply": bea_reply,
            "text": "Person wrote this directly.",
        }),
    );
    assert_eq!(person_edit["success"], true, "{person_edit}");
    let late_submit = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": bea_reply,
            "unit": bea_unit_id,
            "claim": bea_claim,
            "text": "Late agent overwrite!",
        }),
    );
    assert_eq!(
        late_submit["error"]["code"], "UNIT_NOT_OPEN",
        "{late_submit}"
    );
    let shown = fixture.person("mail-replyset-show", json!({ "replyset": set_id }));
    assert_eq!(
        shown["data"]["replyset"]["replies"][1]["content"]["text"],
        "Person wrote this directly."
    );
}

#[test]
fn reopen_recovers_partial_and_sent_sets_when_child_outcomes_are_known() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada0");
    let bea_msg = find_message(&fixture, "bea0");

    // Set A: reply 0 sent, reply 1 unsent, parent left `sending` (crash between
    // replies / during Sent-copy APPEND) -> reopen MUST recover to `partial`!
    let set_a = fixture.person(
        "mail-replyset-create",
        json!({ "messages": [ada_msg, bea_msg] }),
    );
    let id_a = set_a["data"]["replyset"]["id"].as_i64().unwrap();
    let r_a0 = set_a["data"]["replyset"]["replies"][0]["reply"]
        .as_i64()
        .unwrap();
    let _ = person_submit_next(&fixture, id_a, "Hi Ada.");
    let ready_a = person_submit_next(&fixture, id_a, "Hi Bea.");
    let rev_a = ready_a["data"]["revision"].as_i64().unwrap();

    // Set B: single reply already `sent`, parent left `sending` (crash right
    // after last SMTP acceptance) -> reopen MUST recover to `sent`!
    let set_b = fixture.person("mail-replyset-create", json!({ "messages": [ada_msg] }));
    let id_b = set_b["data"]["replyset"]["id"].as_i64().unwrap();
    let r_b0 = set_b["data"]["replyset"]["replies"][0]["reply"]
        .as_i64()
        .unwrap();
    let ready_b = person_submit_next(&fixture, id_b, "Only Ada.");
    let rev_b = ready_b["data"]["revision"].as_i64().unwrap();

    fixture
        .engine
        .with_store(|store| {
            let p = loam_mail::store::Proposer {
                kind: "human".to_string(),
                id: None,
            };
            let _ = store.begin_replyset_send(id_a, rev_a)?;
            let oid_a = store.begin_replyset_reply_send(
                id_a,
                r_a0,
                fixture.account.id,
                rev_a,
                "a0@example.com",
                &p,
                100,
            )?;
            store.finish_replyset_reply_sent(oid_a, r_a0, 101)?;

            let _ = store.begin_replyset_send(id_b, rev_b)?;
            let oid_b = store.begin_replyset_reply_send(
                id_b,
                r_b0,
                fixture.account.id,
                rev_b,
                "b0@example.com",
                &p,
                102,
            )?;
            store.finish_replyset_reply_sent(oid_b, r_b0, 103)?;
            Ok(())
        })
        .unwrap();

    // Reopen store in a fresh Engine.
    let data_dir = fixture.directory.path().join("data");
    drop(fixture.registry);
    drop(fixture.engine);
    let engine2 = Arc::new(Engine::new(Some(Home::at(data_dir))));
    let reg2 = loam_mail::registry(&engine2).unwrap();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let show = |id: i64| {
        let res = rt.block_on(
            reg2.execute(
                "mail-replyset-show",
                json!({ "replyset": id }),
                Some(
                    CommandContext::new()
                        .with_interface(CommandInterface::Cli)
                        .with_actor(ActorKind::Human),
                ),
            ),
        );
        serde_json::to_value(&res).unwrap()
    };

    let after_a = show(id_a);
    assert_eq!(
        after_a["data"]["replyset"]["state"], "partial",
        "reopen between replies must recover to partial, not unknown: {after_a}"
    );
    assert_eq!(after_a["data"]["replyset"]["replies"][0]["state"], "sent");
    assert_eq!(after_a["data"]["replyset"]["replies"][1]["state"], "open");

    let after_b = show(id_b);
    assert_eq!(
        after_b["data"]["replyset"]["state"], "sent",
        "reopen after last acceptance must recover to sent, not unknown: {after_b}"
    );
    assert_eq!(after_b["data"]["replyset"]["replies"][0]["state"], "sent");
}

#[test]
fn revoking_author_token_does_not_change_preview_under_same_revision() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada0");

    // Register a real token in the store so its name is resolved on write.
    let token_row = loam_mail::store::TokenRow {
        id: "tok_ephemeral".to_string(),
        name: "Ephemeral Copilot".to_string(),
        hash: [7u8; 32],
        created_at: 1,
        role: loam_mail::store::TokenRole::Agent,
    };
    fixture
        .engine
        .with_store(|store| store.add_token(&token_row))
        .unwrap();

    let created = fixture.agent(
        "tok_ephemeral",
        "mail-replyset-create",
        json!({
            "messages": [ada_msg],
            "questions": [{
                "question": "Q?",
                "messages": [ada_msg],
                "answer": "A.",
            }],
        }),
    );
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let sub = agent_submit_next(&fixture, "tok_ephemeral", set_id, "Hi Ada.");
    assert_eq!(sub["success"], true, "{sub}");
    let rev = sub["data"]["revision"].as_i64().unwrap();

    let before = fixture.person(
        "mail-replyset-show",
        json!({ "replyset": set_id, "revision": rev }),
    );
    assert_eq!(
        before["data"]["replyset"]["creator"]["name"],
        "Ephemeral Copilot"
    );
    assert_eq!(
        before["data"]["replyset"]["replies"][0]["author"]["name"],
        "Ephemeral Copilot"
    );
    assert_eq!(
        before["data"]["replyset"]["content"]["questions"][0]["answeredBy"]["name"],
        "Ephemeral Copilot"
    );

    // Revoke/remove the token from the store.
    fixture
        .engine
        .with_store(|store| store.remove_token("tok_ephemeral"))
        .unwrap();

    let after = fixture.person(
        "mail-replyset-show",
        json!({ "replyset": set_id, "revision": rev }),
    );
    assert_eq!(
        canonical_json(&before["data"]).unwrap(),
        canonical_json(&after["data"]).unwrap(),
        "revoking an author token must not alter mail-replyset-show under the same revision"
    );
}
