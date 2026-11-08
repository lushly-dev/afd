//! Stored cursors: one file per space, principal and consumer, written by atomic rename.
//!
//! `state/spaces/<space>/cursors/<cursor-key>.json`, where `<cursor-key>` is the lowercase hex
//! SHA-256 of `<actor kind>:<actor id>:<consumer>`, so no caller-chosen string becomes a path
//! (`schemas/cursor-file.v0.json`). For a caller whose positions are sealed (phase 5 section 9.3)
//! the person the actor acts for is part of the key too (`<kind>:<id>`, a NUL byte, the person,
//! `:<consumer>`): every person using one OAuth client is that client acting for them, and each
//! keeps a cursor of their own. No lock: the last writer wins, and a reader sees the old file or
//! the new one, never a mix.

use super::cursor::Cursor;
use super::error::EventsError;
use crate::versions::CURSOR_VERSION;
use crate::workspace::{Layout, SpaceId};
use afd::Actor;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};

/// A cursor consumer name: `^[a-z0-9][a-z0-9._-]{0,63}$`.
pub(crate) fn valid_consumer(consumer: &str) -> bool {
    let mut chars = consumer.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && consumer.len() <= 64
        && chars
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

/// The name of an actor kind on the wire (`agent`).
fn kind_name(actor: &Actor) -> String {
    serde_json::to_value(actor.kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// The file stem for a principal and a consumer.
pub(crate) fn cursor_key(actor: &Actor, id: &str, consumer: &str) -> String {
    key_of(&kind_name(actor), id, consumer)
}

/// The file stem for a principal acting for `person`, when that is part of the key.
fn key_for(actor: &Actor, id: &str, person: Option<&str>, consumer: &str) -> String {
    match person {
        Some(person) => key_of(&kind_name(actor), &format!("{id}\u{0}{person}"), consumer),
        None => cursor_key(actor, id, consumer),
    }
}

/// The file stem for the principal `<kind>:<id>` and a consumer.
fn key_of(kind: &str, id: &str, consumer: &str) -> String {
    let digest = Sha256::digest(format!("{kind}:{id}:{consumer}").as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Serialize, Deserialize)]
struct FileActor {
    kind: String,
    id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorFile {
    version: u32,
    actor: FileActor,
    consumer: String,
    cursor: String,
    updated_at: String,
}

/// The cursor `actor` (whose id is `id`) acknowledged for `consumer` in `space`, if any.
#[cfg(test)]
pub(crate) fn read(
    layout: &Layout,
    space: &SpaceId,
    actor: &Actor,
    id: &str,
    consumer: &str,
) -> Result<Option<Cursor>, EventsError> {
    read_key(layout, space, &cursor_key(actor, id, consumer))
}

/// The cursor `actor` acknowledged for `consumer` in `space`, consulting the legacy principals
/// it stands for (phase 5 section 4.6, `[principal.equivalents]`): its own file when there is
/// one (keyed with `person` when the caller's positions are sealed), else the first legacy
/// principal's in `legacy`'s order. Writing stays its own, so its first acknowledgement takes
/// over from the legacy cursor, which is never changed.
pub(crate) fn read_as(
    layout: &Layout,
    space: &SpaceId,
    (actor, id, person): (&Actor, &str, Option<&str>),
    consumer: &str,
    legacy: &[String],
) -> Result<Option<Cursor>, EventsError> {
    if let Some(cursor) = read_key(layout, space, &key_for(actor, id, person, consumer))? {
        return Ok(Some(cursor));
    }
    for principal in legacy {
        let Some((kind, legacy_id)) = principal.split_once(':') else {
            continue;
        };
        if let Some(cursor) = read_key(layout, space, &key_of(kind, legacy_id, consumer))? {
            return Ok(Some(cursor));
        }
    }
    Ok(None)
}

fn read_key(layout: &Layout, space: &SpaceId, key: &str) -> Result<Option<Cursor>, EventsError> {
    let path = layout.cursor_file(space, key);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(EventsError::io(&path, error)),
    };
    let file: CursorFile = serde_json::from_str(&text)
        .map_err(|error| EventsError::damaged(&path, format!("not a cursor file: {error}")))?;
    if file.version != CURSOR_VERSION {
        return Err(EventsError::Damaged(format!(
            "{} is cursor file version {}; this umbel reads version {CURSOR_VERSION}. Upgrade umbel to read it.",
            path.display(),
            file.version
        )));
    }
    let cursor =
        Cursor::parse(&file.cursor).map_err(|message| EventsError::damaged(&path, message))?;
    if cursor.space() != space {
        return Err(EventsError::damaged(
            &path,
            format!("it holds a cursor of space {}", cursor.space()),
        ));
    }
    Ok(Some(cursor))
}

/// Store `cursor` for `actor` and `consumer`: a temporary file in the same directory, then a
/// rename over the target.
pub(crate) fn write(
    layout: &Layout,
    (actor, id, person): (&Actor, &str, Option<&str>),
    consumer: &str,
    cursor: &Cursor,
    updated_at: &str,
) -> Result<(), EventsError> {
    let space = cursor.space();
    let dir = layout.cursors_dir(space);
    let key = key_for(actor, id, person, consumer);
    let target = layout.cursor_file(space, &key);
    let file = CursorFile {
        version: CURSOR_VERSION,
        actor: FileActor {
            kind: kind_name(actor),
            id: id.to_owned(),
        },
        consumer: consumer.to_owned(),
        cursor: cursor.to_string(),
        updated_at: updated_at.to_owned(),
    };
    let mut text = serde_json::to_string_pretty(&file).unwrap_or_default();
    text.push('\n');
    fs::create_dir_all(&dir).map_err(|error| EventsError::io(&dir, error))?;
    let temporary = dir.join(format!(
        ".{key}.{}.{}.tmp",
        std::process::id(),
        crate::host::new_trace_id()
    ));
    let written = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .and_then(|mut handle| {
            handle
                .write_all(text.as_bytes())
                .and_then(|()| handle.sync_all())
        })
        .and_then(|()| fs::rename(&temporary, &target));
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        return Err(EventsError::io(&target, error));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use afd::ActorKind;

    #[test]
    fn consumers_follow_the_documented_shape() {
        for ok in ["default", "a", "0", "session-1", "a.b_c-d", &"a".repeat(64)] {
            assert!(valid_consumer(ok), "{ok}");
        }
        for bad in [
            "",
            "A",
            "-a",
            ".a",
            "a b",
            "a/b",
            "../x",
            &"a".repeat(65),
            "é",
        ] {
            assert!(!valid_consumer(bad), "{bad}");
        }
    }

    #[test]
    fn the_key_is_a_hash_of_kind_id_and_consumer() {
        let agent = Actor::new(ActorKind::Agent).with_id("local");
        let human = Actor::new(ActorKind::Human).with_id("local");
        let key = cursor_key(&agent, "local", "default");
        assert_eq!(key.len(), 64);
        assert!(
            key.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        );
        assert_ne!(key, cursor_key(&human, "local", "default"));
        assert_ne!(key, cursor_key(&agent, "local", "other"));
        assert_ne!(key, cursor_key(&agent, "other", "default"));
        let expected = Sha256::digest(b"agent:local:default");
        assert_eq!(
            key,
            expected
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );
    }

    #[test]
    fn a_cursor_round_trips_and_the_last_write_wins() {
        let dir = tempfile::tempdir().unwrap();
        let layout = Layout::new(dir.path());
        let main = SpaceId::parse("main").unwrap();
        let actor = Actor::new(ActorKind::Agent).with_id("local");
        assert_eq!(
            read(&layout, &main, &actor, "local", "default").unwrap(),
            None
        );
        write(
            &layout,
            (&actor, "local", None),
            "default",
            &Cursor::new(main.clone(), 3),
            "t1",
        )
        .unwrap();
        write(
            &layout,
            (&actor, "local", None),
            "default",
            &Cursor::new(main.clone(), 1),
            "t2",
        )
        .unwrap();
        let stored = read(&layout, &main, &actor, "local", "default")
            .unwrap()
            .unwrap();
        assert_eq!(stored.seq(), 1);
        let leftovers = fs::read_dir(layout.cursors_dir(&main)).unwrap().count();
        assert_eq!(leftovers, 1, "no temporary file stays behind");
    }

    #[test]
    fn a_damaged_cursor_file_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let layout = Layout::new(dir.path());
        let main = SpaceId::parse("main").unwrap();
        let actor = Actor::new(ActorKind::Agent).with_id("local");
        let path = layout.cursor_file(&main, &cursor_key(&actor, "local", "default"));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{}").unwrap();
        assert!(read(&layout, &main, &actor, "local", "default").is_err());
    }
}
