//! `mail-replyset-preview`, the confirmation preview of `mail-replyset-send`
//! (D175, #2410; plugin.spec.md section 6, "Two ceilings"): what it shows,
//! that it is labelled and stable, and where it stops fitting Loam's
//! confirmation ceiling of 64 KiB and 200 JSON values, measured as
//! `mounted-approvals.ts` measures it.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::collections::VecDeque;

use afd::{ActorKind, CommandContext, CommandInterface, canonical_json};
use loam_mail::cli::{Local, Runner};
use loam_mail::replysets::{
    HEAD_VALUES, REPLY_VALUES, SHELL_MAX_BYTES, SHELL_REPLIES, SHELL_VALUES_MAX,
};
use serde_json::{Value, json};
use support::imap::{USER, World};
use support::smtp::SmtpFault;
use support::synced::{Fixture, assert_labelled, mail};

const PREVIEW: &str = "mail-replyset-preview";

const CONTENT_WORDS: &[&str] = &[
    "ada@example.com",
    "bea@example.org",
    "spoof@evil.example",
    "Ada Lovelace",
    "Bea Smith",
    "About ada0",
    "About bea0",
    "Shared closing",
    "Thursday works",
];

fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Sent Messages", &["\\Sent"]);
    world.add(
        "INBOX",
        mail(
            "Ada Lovelace <ada@example.com>",
            "ada0",
            "To: person@example.com\r\nReply-To: spoof@evil.example\r\n",
        ),
        &[],
    );
    world.add(
        "INBOX",
        mail(
            "Bea Smith <bea@example.org>",
            "bea0",
            "To: person@example.com\r\n",
        ),
        &[],
    );
}

/// `count` inbound messages from distinct senders, each findable by `Question {i}`.
fn cohort(count: u32) -> impl FnOnce(&mut World) {
    move |world: &mut World| {
        world.mailbox("INBOX", &[]);
        world.mailbox("Sent Messages", &["\\Sent"]);
        for i in 1..=count {
            world.add(
                "INBOX",
                format!(
                    "From: Sender {i} <sender{i}@example.org>\r\n\
                     To: person@example.com\r\n\
                     Message-ID: <cohort-{i}@example.org>\r\n\
                     Subject: Cohort item {i}\r\n\
                     Content-Type: text/plain\r\n\r\n\
                     Question {i}\r\n"
                )
                .into_bytes(),
                &[],
            );
        }
    }
}

fn find_message(fixture: &Fixture, word: &str) -> i64 {
    let found = fixture.person("mail-search", json!({ "query": word }));
    found["data"]["hits"][0]["message"].as_i64().unwrap()
}

fn submit_next(fixture: &Fixture, set_id: i64, text: &str) -> Value {
    let unit = fixture.person("mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(unit["success"], true, "{unit}");
    let submitted = fixture.person(
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": unit["data"]["reply"],
            "unit": unit["data"]["unit"],
            "claim": unit["data"]["claim"],
            "text": text,
        }),
    );
    assert_eq!(submitted["success"], true, "{submitted}");
    submitted
}

/// A reply set of `count` replies from [`cohort`], every reply written.
fn written_set(fixture: &Fixture, count: u32) -> (i64, i64) {
    let messages: Vec<i64> = (1..=count)
        .map(|i| find_message(fixture, &format!("Question {i}")))
        .collect();
    let created = fixture.person(
        "mail-replyset-create",
        json!({
            "messages": messages,
            "sharedText": "Thanks, confirmed.",
            "questions": [{ "question": "Shared?", "messages": messages, "answer": "Yes." }],
        }),
    );
    assert_eq!(created["success"], true, "{created}");
    let id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let mut revision = 0;
    for i in 1..=count {
        let text = if i % 2 == 0 {
            "Thanks, confirmed.".to_string()
        } else {
            format!("Thanks, confirmed for item {i}.")
        };
        revision = submit_next(fixture, id, &text)["data"]["revision"]
            .as_i64()
            .unwrap();
    }
    (id, revision)
}

/// Loam's `valuesIn`: every JSON value, containers counted.
fn values_in(value: &Value) -> usize {
    match value {
        Value::Array(items) => 1 + items.iter().map(values_in).sum::<usize>(),
        Value::Object(fields) => 1 + fields.values().map(values_in).sum::<usize>(),
        _ => 1,
    }
}

/// Loam's byte measure: the canonical JSON of the preview's data, as UTF-8.
fn bytes_of(value: &Value) -> usize {
    canonical_json(value).unwrap().len()
}

/// Whether Loam's shell shows `data` whole and so asks for the send.
fn shell_shows(data: &Value) -> bool {
    bytes_of(data) <= SHELL_MAX_BYTES && values_in(data) <= SHELL_VALUES_MAX
}

fn approved_send(fixture: &Fixture, input: Value) -> Value {
    let held = fixture.person("mail-replyset-send", input.clone());
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
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

fn run_async<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(f)
}

/// A held person's command run at the terminal and approved there.
fn approved_local(fixture: &Fixture, name: &str, input: Value) -> Value {
    run_async(async {
        let local = Local(&fixture.registry);
        let held = local.run(name, input.clone(), true, None).await;
        let token = held
            .error
            .as_ref()
            .and_then(|e| e.details.as_ref())
            .and_then(|d| d.get("approvalToken"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| panic!("{name} was not held: {held:?}"));
        serde_json::to_value(local.run(name, input, true, Some(token)).await).unwrap()
    })
}

/// An agent token named `name`, by its id.
fn agent_token(fixture: &Fixture, name: &str) -> String {
    let made = approved_local(
        fixture,
        "mail-token-create",
        json!({ "name": name, "role": "agent" }),
    );
    assert_eq!(made["success"], true, "{made}");
    made["data"]["token"].as_str().unwrap().to_string()
}

/// The next unit of `set_id`, written as the agent whose token is `token`.
fn agent_submit_next(fixture: &Fixture, token: &str, set_id: i64, text: &str) -> Value {
    let unit = fixture.agent(token, "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(unit["success"], true, "{unit}");
    let submitted = fixture.agent(
        token,
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": unit["data"]["reply"],
            "unit": unit["data"]["unit"],
            "claim": unit["data"]["claim"],
            "text": text,
        }),
    );
    assert_eq!(submitted["success"], true, "{submitted}");
    submitted
}

/// The values of a preview of `unsent` replies to send and `sent` already sent.
const fn values_for(unsent: usize, sent: usize) -> usize {
    HEAD_VALUES + unsent * REPLY_VALUES + sent
}

#[test]
fn preview_shows_every_recipient_subject_text_and_difference_labelled_and_stable() {
    let fixture = Fixture::new(world);
    let ada = find_message(&fixture, "ada0");
    let bea = find_message(&fixture, "bea0");
    let created = fixture.person(
        "mail-replyset-create",
        json!({
            "messages": [ada, bea],
            "sharedText": "Shared closing.",
            "questions": [{ "question": "Thursday?", "messages": [ada], "answer": "Thursday works." }],
        }),
    );
    assert_eq!(created["success"], true, "{created}");
    let id = created["data"]["replyset"]["id"].as_i64().unwrap();
    submit_next(&fixture, id, "Dear Ada, Thursday works.");
    let revision = submit_next(&fixture, id, "Shared closing.")["data"]["revision"]
        .as_i64()
        .unwrap();

    let shown = fixture.person(PREVIEW, json!({ "replyset": id, "revision": revision }));
    assert_eq!(shown["success"], true, "{shown}");
    // Exactly what a person confirms, and nothing of the set's audit: no
    // questions, inputs, units, generations, counters, times or outbound ids.
    assert_eq!(
        shown["data"],
        json!({
            "replyset": {
                "id": id,
                "revision": revision,
                "state": "open",
                "from": USER,
                "content": {
                    "trust": "content",
                    "sharedText": "Shared closing.",
                    "alreadySent": [],
                },
                "replies": [
                    {
                        "differs": true,
                        "replyToDiffers": true,
                        "author": "human",
                        "authorName": null,
                        "content": {
                            "trust": "content",
                            "to": "ada@example.com",
                            "toName": "Ada Lovelace",
                            "subject": "Re: About ada0",
                            "text": "Dear Ada, Thursday works.",
                        },
                    },
                    {
                        "differs": false,
                        "replyToDiffers": false,
                        "author": "human",
                        "authorName": null,
                        "content": {
                            "trust": "content",
                            "to": "bea@example.org",
                            "toName": "Bea Smith",
                            "subject": "Re: About bea0",
                            "text": "Shared closing.",
                        },
                    },
                ],
            }
        })
    );
    assert_labelled(&shown, CONTENT_WORDS);
    assert_eq!(
        values_in(&shown["data"]),
        HEAD_VALUES + 2 * REPLY_VALUES,
        "the head and each reply cost what the module says"
    );

    // Every recipient, subject and text is the full show's, in its order.
    let full = fixture.person("mail-replyset-show", json!({ "replyset": id }));
    let from_full: Vec<(Value, Value, Value)> = full["data"]["replyset"]["replies"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            let c = &r["content"];
            (
                c["recipient"]["address"].clone(),
                c["subject"].clone(),
                c["text"].clone(),
            )
        })
        .collect();
    let from_preview: Vec<(Value, Value, Value)> = shown["data"]["replyset"]["replies"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            let c = &r["content"];
            (c["to"].clone(), c["subject"].clone(), c["text"].clone())
        })
        .collect();
    assert_eq!(from_preview, from_full);
    assert!(bytes_of(&shown["data"]) < bytes_of(&full["data"]));

    // Stable for an unchanged set: two reads are equal in canonical JSON.
    let again = fixture.person(PREVIEW, json!({ "replyset": id }));
    assert_eq!(
        canonical_json(&shown["data"]).unwrap(),
        canonical_json(&again["data"]).unwrap()
    );

    // A change raises the revision the send checks, and a preview read at the
    // old revision fails rather than show another set.
    let edited = fixture.person(
        "mail-replyset-update",
        json!({ "replyset": id, "revision": revision, "sharedText": "Shared closing, edited." }),
    );
    assert_eq!(edited["success"], true, "{edited}");
    let stale = fixture.person(PREVIEW, json!({ "replyset": id, "revision": revision }));
    assert_eq!(stale["error"]["code"], "PREVIEW_CHANGED", "{stale}");
    let changed = fixture.person(PREVIEW, json!({ "replyset": id }));
    assert_ne!(
        canonical_json(&changed["data"]).unwrap(),
        canonical_json(&shown["data"]).unwrap()
    );
    assert_eq!(changed["data"]["replyset"]["replies"][1]["differs"], true);

    let missing = fixture.person(PREVIEW, json!({ "replyset": 999 }));
    assert_eq!(missing["error"]["code"], "REPLYSET_NOT_FOUND", "{missing}");

    // A pure read with the show's budget, exposed over MCP like it, so an
    // agent can read what the person will be asked.
    let definition = fixture
        .registry
        .list()
        .into_iter()
        .find(|c| c.name == PREVIEW)
        .unwrap();
    assert!(!definition.mutation);
    assert_ne!(definition.destructive, Some(true));
    let budget = definition.output_budget.unwrap();
    assert_eq!(budget.default_bytes, budget.max_bytes);
    let read = fixture.stdio(PREVIEW, json!({ "replyset": id }));
    assert_eq!(read["success"], true, "{read}");
}

#[test]
fn preview_fits_loams_ceiling_up_to_seventeen_unsent_replies() {
    assert_eq!(SHELL_REPLIES, 17);
    assert_eq!(HEAD_VALUES + 17 * REPLY_VALUES, 198);
    assert_eq!(HEAD_VALUES + 18 * REPLY_VALUES, 209);
    assert_eq!(SHELL_VALUES_MAX, 200);

    let fixture = Fixture::new(cohort(18));
    for count in [10, 17] {
        let fresh = Fixture::new(cohort(count));
        let (id, revision) = written_set(&fresh, count);
        let shown = fresh.person(PREVIEW, json!({ "replyset": id, "revision": revision }));
        assert_eq!(shown["success"], true, "{shown}");
        let data = &shown["data"];
        assert_eq!(values_in(data), HEAD_VALUES + count as usize * REPLY_VALUES);
        assert!(
            shell_shows(data),
            "{count} replies: {} bytes, {} values",
            bytes_of(data),
            values_in(data)
        );
        // The full show of the same set is past the ceiling: why #2410 was filed.
        let full = fresh.person("mail-replyset-show", json!({ "replyset": id }));
        assert!(
            !shell_shows(&full["data"]),
            "{count} replies' full show fits"
        );
    }

    // 18 unsent replies are past 200 values, however short their text: Loam
    // fails closed on the send, which stays sendable at the terminal.
    let (id, revision) = written_set(&fixture, 18);
    let shown = fixture.person(PREVIEW, json!({ "replyset": id, "revision": revision }));
    assert_eq!(shown["success"], true, "{shown}");
    assert_eq!(values_in(&shown["data"]), 209);
    assert!(bytes_of(&shown["data"]) <= SHELL_MAX_BYTES);
    assert!(!shell_shows(&shown["data"]));

    // A sent reply costs one value more, its recipient in `alreadySent`: 17
    // replies to send fit with 2 sent (200 values), not with 3 (201).
    for (total, sent, values, shows) in [(19u32, 2usize, 200usize, true), (20, 3, 201, false)] {
        let partial_fixture = Fixture::new(cohort(total));
        let (id, revision) = written_set(&partial_fixture, total);
        {
            let mut smtp = partial_fixture.smtp.world();
            let mut faults: VecDeque<Option<SmtpFault>> = (0..sent).map(|_| None).collect();
            faults.push_back(Some(SmtpFault::RefuseAfterData(550)));
            smtp.faults = faults;
        }
        let partial = approved_send(
            &partial_fixture,
            json!({ "replyset": id, "revision": revision }),
        );
        assert_eq!(partial["error"]["details"]["state"], "partial", "{partial}");
        assert_eq!(partial["error"]["details"]["sent"], sent, "{partial}");
        let partial_revision = partial["error"]["details"]["revision"].as_i64().unwrap();
        let shown = partial_fixture.person(
            PREVIEW,
            json!({ "replyset": id, "revision": partial_revision }),
        );
        assert_eq!(shown["success"], true, "{shown}");
        let data = &shown["data"]["replyset"];
        assert_eq!(data["state"], "partial");
        let expected_sent: Vec<String> = (1..=sent)
            .map(|i| format!("sender{i}@example.org"))
            .collect();
        assert_eq!(data["content"]["alreadySent"], json!(expected_sent));
        let replies = data["replies"].as_array().unwrap();
        assert_eq!(replies.len(), 17);
        // The reply the provider refused is sent again, so it is listed first.
        assert_eq!(
            replies[0]["content"]["to"],
            format!("sender{}@example.org", sent + 1)
        );
        assert_eq!(values_in(&shown["data"]), values);
        assert_eq!(values_for(17, sent), values);
        assert_eq!(shell_shows(&shown["data"]), shows);
    }
}

#[test]
fn preview_names_each_writer_by_token_id_even_when_a_revoked_name_is_reused() {
    let fixture = Fixture::new(cohort(2));
    let messages: Vec<i64> = (1..=2)
        .map(|i| find_message(&fixture, &format!("Question {i}")))
        .collect();
    let created = fixture.person("mail-replyset-create", json!({ "messages": messages }));
    let id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let first = agent_token(&fixture, "Composer");
    agent_submit_next(&fixture, &first, id, "Written by the first.");
    let revoked = approved_local(&fixture, "mail-token-revoke", json!({ "token": first }));
    assert_eq!(revoked["success"], true, "{revoked}");
    let second = agent_token(&fixture, "Composer");
    assert_ne!(first, second);
    agent_submit_next(&fixture, &second, id, "Written by the second.");

    let shown = fixture.person(PREVIEW, json!({ "replyset": id }));
    assert_eq!(shown["success"], true, "{shown}");
    let replies = shown["data"]["replyset"]["replies"].as_array().unwrap();
    let writers: Vec<(Value, Value)> = replies
        .iter()
        .map(|r| (r["author"].clone(), r["authorName"].clone()))
        .collect();
    assert_eq!(
        writers,
        vec![
            (json!(first), json!("Composer")),
            (json!(second), json!("Composer")),
        ]
    );
}

#[test]
fn preview_refuses_every_set_the_send_refuses_before_its_hold() {
    // Not written yet: the send refuses it, so Loam asks nothing.
    let fixture = Fixture::new(cohort(2));
    let messages: Vec<i64> = (1..=2)
        .map(|i| find_message(&fixture, &format!("Question {i}")))
        .collect();
    let created = fixture.person("mail-replyset-create", json!({ "messages": messages }));
    let id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let first = submit_next(&fixture, id, "One.");
    let rev = first["data"]["revision"].as_i64().unwrap();
    let incomplete = fixture.person(PREVIEW, json!({ "replyset": id, "revision": rev }));
    assert_eq!(
        incomplete["error"]["code"], "REPLYSET_INCOMPLETE",
        "{incomplete}"
    );
    let send = fixture.person(
        "mail-replyset-send",
        json!({ "replyset": id, "revision": rev }),
    );
    assert_eq!(send["error"]["code"], "REPLYSET_INCOMPLETE", "{send}");
    // The full show still reads it whole.
    let full = fixture.person("mail-replyset-show", json!({ "replyset": id }));
    assert_eq!(full["success"], true, "{full}");

    // The first reply's outcome unknown: the send never sends the set again,
    // and the preview lists nothing of it as if it would.
    let revision = submit_next(&fixture, id, "Two.")["data"]["revision"]
        .as_i64()
        .unwrap();
    fixture.smtp.world().fault = Some(SmtpFault::DropAfterHandover);
    let unknown = approved_send(&fixture, json!({ "replyset": id, "revision": revision }));
    assert_eq!(
        unknown["error"]["code"], "SEND_OUTCOME_UNKNOWN",
        "{unknown}"
    );
    let now = fixture.person("mail-replyset-show", json!({ "replyset": id }));
    let now_revision = now["data"]["replyset"]["revision"].as_i64().unwrap();
    for input in [
        json!({ "replyset": id }),
        json!({ "replyset": id, "revision": now_revision }),
    ] {
        let refused = fixture.person(PREVIEW, input.clone());
        assert_eq!(
            refused["error"]["code"], "SEND_OUTCOME_UNKNOWN",
            "{refused}"
        );
        let send = fixture.person(
            "mail-replyset-send",
            json!({ "replyset": id, "revision": now_revision }),
        );
        assert_eq!(send["error"]["code"], "SEND_OUTCOME_UNKNOWN", "{send}");
    }

    // Sent whole: nothing is left to send.
    let done_fixture = Fixture::new(cohort(1));
    let (done, done_revision) = written_set(&done_fixture, 1);
    let sent = approved_send(
        &done_fixture,
        json!({ "replyset": done, "revision": done_revision }),
    );
    assert_eq!(sent["success"], true, "{sent}");
    let after = done_fixture.person(PREVIEW, json!({ "replyset": done }));
    assert_eq!(after["error"]["code"], "INVALID_INPUT", "{after}");
    let done_now = done_fixture.person("mail-replyset-show", json!({ "replyset": done }));
    let again = done_fixture.person(
        "mail-replyset-send",
        json!({ "replyset": done, "revision": done_now["data"]["replyset"]["revision"] }),
    );
    assert_eq!(again["error"]["code"], "INVALID_INPUT", "{again}");
}

#[test]
fn preview_is_past_the_bytes_ceiling_when_the_text_is_and_fails_nothing_at_the_engine() {
    // Two replies of 32,768 characters each are past 64 KiB however few the
    // values: Loam fails closed, and the engine still reads the preview whole.
    let fixture = Fixture::new(cohort(2));
    let messages: Vec<i64> = (1..=2)
        .map(|i| find_message(&fixture, &format!("Question {i}")))
        .collect();
    let created = fixture.person("mail-replyset-create", json!({ "messages": messages }));
    let id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let long = "x".repeat(32_768);
    submit_next(&fixture, id, &long);
    submit_next(&fixture, id, &long);
    let shown = fixture.person(PREVIEW, json!({ "replyset": id }));
    assert_eq!(shown["success"], true, "{shown}");
    assert!(values_in(&shown["data"]) <= SHELL_VALUES_MAX);
    assert!(bytes_of(&shown["data"]) > SHELL_MAX_BYTES);
}
