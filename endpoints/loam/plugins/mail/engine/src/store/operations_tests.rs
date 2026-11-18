//! Operations in the store (the specification's 9.1 to 9.4): migration 14,
//! which makes `operation` again so that it can hold proposals, keeps every
//! row, id and reference.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use rusqlite::types::Value;

use super::*;

fn table(store: &Store, sql: &str) -> Vec<Vec<Value>> {
    let mut statement = store.connection.prepare(sql).unwrap();
    let width = statement.column_count();
    statement
        .query_map([], |row| {
            (0..width).map(|index| row.get::<_, Value>(index)).collect()
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn migration_14_keeps_operations_their_items_and_their_next_id() {
    let directory = tempfile::tempdir().unwrap();
    let home = Home::at(directory.path().join("data"));
    {
        // Version 13 wrote these: a move, its undo, and an operation since
        // removed, whose id must not be given again.
        let store = Store::open_with(&home, &schema::MIGRATIONS[..13]).unwrap();
        store
            .connection
            .execute_batch(
                "INSERT INTO account (id, provider, address, created_at)
                     VALUES (1, 'icloud', 'person@example.com', 0);
                 INSERT INTO mailbox (id, account_id, provider_key, name, role, header_only)
                     VALUES (1, 1, 'INBOX', 'INBOX', 'inbox', 0),
                            (2, 1, 'Archive', 'Archive', 'archive', 0);
                 INSERT INTO message (id, header_hash, reported_size, first_seen_at)
                     VALUES (1, zeroblob(32), 10, 100);
                 INSERT INTO operation (id, command, action, kind, asked, creator_kind,
                                        state, created_at, ended_at, messages)
                     VALUES (1, 'mail-archive', 'move', 'change', '{}', 'human', 'done', 10,
                             11, 1),
                            (5, 'mail-trash', 'move', 'trash', '{}', 'agent', 'stopped', 30,
                             31, 1);
                 INSERT INTO operation (id, command, action, kind, asked, undo_of, creator_kind,
                                        state, created_at, messages)
                     VALUES (2, 'mail-operation-undo', 'move', 'change', '{}', 1, 'human',
                             'running', 20, 1);
                 DELETE FROM operation WHERE id = 5;
                 INSERT INTO operation_item (operation_id, mailbox_id, validity, provider_id,
                                             message_id, to_mailbox_id, to_validity,
                                             to_provider_id, flags_before, step)
                     VALUES (1, 1, '7', '3', 1, 2, '8', '4', '[]', 'done'),
                            (2, 2, '8', '4', 1, 1, NULL, NULL, NULL, 'copying');",
            )
            .unwrap();
    }
    let mut store = Store::open(&home).unwrap();
    assert_eq!(
        table(
            &store,
            "SELECT id, state, undo_of, started_at, charged, proposer_kind FROM operation
             ORDER BY id"
        ),
        [
            vec![
                Value::Integer(1),
                Value::Text("done".into()),
                Value::Null,
                Value::Integer(10),
                Value::Integer(1),
                Value::Null,
            ],
            // Running when the store was opened: its process is gone.
            vec![
                Value::Integer(2),
                Value::Text("stopped".into()),
                Value::Integer(1),
                Value::Integer(20),
                Value::Integer(1),
                Value::Null,
            ],
        ]
    );
    assert_eq!(
        table(
            &store,
            "SELECT operation_id, mailbox_id, validity, provider_id, message_id, to_mailbox_id,
                    to_validity, to_provider_id, flags_before, step
             FROM operation_item ORDER BY operation_id"
        ),
        [
            vec![
                Value::Integer(1),
                Value::Integer(1),
                Value::Text("7".into()),
                Value::Text("3".into()),
                Value::Integer(1),
                Value::Integer(2),
                Value::Text("8".into()),
                Value::Text("4".into()),
                Value::Text("[]".into()),
                Value::Text("done".into()),
            ],
            vec![
                Value::Integer(2),
                Value::Integer(2),
                Value::Text("8".into()),
                Value::Text("4".into()),
                Value::Integer(1),
                Value::Integer(1),
                Value::Null,
                Value::Null,
                Value::Null,
                Value::Text("copying".into()),
            ],
        ]
    );
    // The undo is still known as the move's.
    assert_eq!(store.operation(1).unwrap().unwrap().undone_by, Some(2));
    // Every reference names the table made again, and is kept.
    for (sql, refused) in [
        (
            "INSERT INTO operation_item (operation_id, mailbox_id, validity, provider_id, step)
             VALUES (9, 1, '7', '9', 'waiting')",
            "an item of no operation",
        ),
        (
            "INSERT INTO operation (command, action, kind, asked, undo_of, creator_kind, state,
                                    created_at, messages)
             VALUES ('mail-operation-undo', 'move', 'change', '{}', 9, 'human', 'done', 0, 0)",
            "an undo of no operation",
        ),
        (
            "INSERT INTO operation (command, action, kind, asked, creator_kind, state,
                                    created_at, messages)
             VALUES ('mail-trash', 'move', 'trash', '{}', 'agent', 'proposed', 0, 0)",
            "a proposal with no proposer",
        ),
    ] {
        assert!(store.connection.execute(sql, []).is_err(), "{refused}");
    }
    let schema: String = store
        .connection
        .query_row(
            "SELECT group_concat(sql, ' ') FROM sqlite_schema WHERE name LIKE 'operation%'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!schema.contains("operation_next"), "{schema}");
    assert!(!schema.contains("operation_item_kept"), "{schema}");
    // The next operation does not take the removed one's id.
    let made = store
        .create_operation(
            &NewOperation {
                command: "mail-archive".to_string(),
                action: Action::Move,
                kind: Kind::Change,
                asked: "{}".to_string(),
                undo_of: None,
                selection: None,
                query: None,
                creator: Proposer {
                    kind: "agent".to_string(),
                    id: Some("a".to_string()),
                },
                messages: 0,
                items: Vec::new(),
                proposed: true,
            },
            100,
        )
        .unwrap();
    assert_eq!(made.id, 6);
    assert_eq!(made.state, OperationState::Proposed);
    assert_eq!(made.started_at, None);
    assert!(!made.charged);
    assert_eq!(
        made.proposal.as_ref().map(|proposal| proposal.expires_at),
        Some(100 + PROPOSAL_LIFETIME)
    );
}

#[test]
fn a_proposal_past_its_time_goes_and_a_resume_proposed_stops_again() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = Store::open(&Home::at(directory.path().join("data"))).unwrap();
    let agent = Proposer {
        kind: "agent".to_string(),
        id: Some("a".to_string()),
    };
    let operation = |proposed| NewOperation {
        command: "mail-archive".to_string(),
        action: Action::Move,
        kind: Kind::Trash,
        asked: "{}".to_string(),
        undo_of: None,
        selection: None,
        query: None,
        creator: agent.clone(),
        messages: 3,
        items: Vec::new(),
        proposed,
    };
    let change = store.create_operation(&operation(true), 0).unwrap();
    let ran = store.create_operation(&operation(false), 0).unwrap();
    store
        .set_operation_state(ran.id, OperationState::Stopped, None, 1)
        .unwrap();
    assert!(store.propose_resume(ran.id, &agent, 10).unwrap());
    assert_eq!(store.proposals_waiting(&agent).unwrap(), 2);
    // A proposal counts against no caller's day of trash.
    assert_eq!(store.trashed_since(&agent, -1).unwrap(), 3);
    assert_eq!(store.expire_proposals(PROPOSAL_LIFETIME - 1).unwrap(), 0);
    assert_eq!(store.expire_proposals(PROPOSAL_LIFETIME + 10).unwrap(), 2);
    let state = |id| store.operation(id).unwrap().unwrap().state;
    assert_eq!(state(change.id), OperationState::Expired);
    assert_eq!(state(ran.id), OperationState::Stopped);
    assert_eq!(store.proposals_waiting(&agent).unwrap(), 0);
    assert!(
        !store
            .approve_proposal(change.id, PROPOSAL_LIFETIME + 20)
            .unwrap()
    );
}
