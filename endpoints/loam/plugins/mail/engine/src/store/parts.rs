//! A message held in parts (the specification's M20): its structure, which
//! is what the provider said and not derived, and its parts in the log.
//! What its body says is derived from the two ([`crate::parts`]): its text
//! from the message written from its structure with its text parts in
//! place, and each file held read on its own.

use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::{OptionalExtension, params};

use super::derived::unreadable;
use super::{Kept, MessageId, PartSeen, Place, Store, StoreError, derived, size_of};
use crate::derive::{self, BodyFields};
use crate::parts::{self, Structure};

impl Store {
    /// The structure of a message held in parts, or `None` when the store
    /// has none.
    ///
    /// # Errors
    /// When the database refuses, or [`StoreError::NotFound`] when the
    /// structure kept cannot be read back, so that nothing is derived from
    /// it.
    pub fn structure(&self, message: MessageId) -> Result<Option<Structure>, StoreError> {
        let text: Option<String> = self
            .connection
            .query_row(
                "SELECT body FROM structure WHERE message_id = ?1",
                [message.0],
                |row| row.get(0),
            )
            .optional()?;
        text.map(|text| Structure::from_json(&text).ok_or(StoreError::NotFound("structure")))
            .transpose()
    }

    /// The places held of a message of one kind: `text` or `attachment`.
    fn held_places(&self, message: MessageId, kind: &str) -> Result<Vec<String>, StoreError> {
        let mut statement = self
            .connection
            .prepare_cached("SELECT part FROM held WHERE message_id = ?1 AND kind = ?2")?;
        let places = statement
            .query_map(params![message.0, kind], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(places)
    }

    /// The bytes of a part held, or `None` when its file is damaged or
    /// missing: the read notes it for sync to fetch again, and the message
    /// is read as though the part were not held until then.
    fn readable_part(
        &self,
        message: MessageId,
        place: &str,
    ) -> Result<Option<Vec<u8>>, StoreError> {
        match self.read_part(message, place) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if unreadable(&error) => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// The text parts held of a message held in parts, by place, as the
    /// provider returned them.
    fn held_texts(&self, message: MessageId) -> Result<BTreeMap<String, Vec<u8>>, StoreError> {
        let mut texts = BTreeMap::new();
        for place in self.held_places(message, "text")? {
            if let Some(bytes) = self.readable_part(message, &place)? {
                texts.insert(place, bytes);
            }
        }
        Ok(texts)
    }

    /// What a message held in parts says, with `extra` bytes as though they
    /// were held: its text from its text parts, then each file held read on
    /// its own, one at a time.
    fn parts_body(
        &self,
        message: MessageId,
        structure: &Structure,
        extra: &[(Place<'_>, &[u8])],
    ) -> Result<BodyFields, StoreError> {
        let mut texts = self.held_texts(message)?;
        for (place, bytes) in extra {
            if let Place::Text(place) = place {
                texts.insert((*place).to_string(), bytes.to_vec());
            }
        }
        let mut fields = parts::body_fields(structure, &texts);
        let mut files: Vec<String> = self.held_places(message, "attachment")?;
        for (place, _) in extra {
            if let Place::Attachment(place) = place {
                files.push((*place).to_string());
            }
        }
        files.sort();
        files.dedup();
        for place in files {
            let bytes = match extra
                .iter()
                .find(|(at, _)| *at == Place::Attachment(&place))
            {
                Some((_, bytes)) => Some(bytes.to_vec()),
                None => self.readable_part(message, &place)?,
            };
            if let Some(decoded) = bytes.and_then(|bytes| parts::decoded(structure, &place, &bytes))
            {
                parts::with_file(&mut fields, &place, &decoded);
            }
        }
        Ok(fields)
    }

    /// The bytes a message's text is read from: the whole message when it
    /// is held whole, the message written from its structure and its text
    /// parts when it is held in parts, and `None` when neither.
    ///
    /// # Errors
    /// When the log or the database refuses.
    pub fn body_bytes(&self, message: MessageId) -> Result<Option<Vec<u8>>, StoreError> {
        match self.read_part(message, "whole") {
            Ok(whole) => return Ok(Some(whole)),
            Err(StoreError::NotFound(_)) => {}
            Err(error) => return Err(error),
        }
        let Some(structure) = self.structure(message)? else {
            return Ok(None);
        };
        Ok(Some(parts::assemble(
            &structure,
            &self.held_texts(message)?,
        )))
    }

    /// The decoded content of the part at `place`, when its bytes are held:
    /// read from the whole message, from the part itself, or from a message
    /// carried in a part that is held.
    ///
    /// # Errors
    /// When the log or the database refuses.
    pub fn part_content(
        &self,
        message: MessageId,
        place: &str,
    ) -> Result<Option<Vec<u8>>, StoreError> {
        match self.read_part(message, "whole") {
            Ok(whole) => return Ok(derive::part_content(&whole, place)),
            Err(StoreError::NotFound(_)) => {}
            Err(error) => return Err(error),
        }
        let Some(structure) = self.structure(message)? else {
            return Ok(None);
        };
        let held: Vec<String> = self
            .held_places(message, "text")?
            .into_iter()
            .chain(self.held_places(message, "attachment")?)
            .collect();
        if held.iter().any(|at| at == place) {
            let raw = self.read_part(message, place)?;
            return Ok(parts::decoded(&structure, place, &raw));
        }
        // A part of a message carried in a part that is held: that message
        // is read on its own, its parts numbered from its root.
        for at in &held {
            if let Some(inside) = place.strip_prefix(&format!("{at}.")) {
                let raw = self.read_part(message, at)?;
                return Ok(parts::decoded(&structure, at, &raw)
                    .and_then(|carried| derive::part_content(&carried, inside)));
            }
        }
        Ok(None)
    }

    /// Whether the bytes of the part at `place` are held: the message is
    /// held whole, or the part, or a message carried that holds it, is held.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn part_held(&self, message: MessageId, place: &str) -> Result<bool, StoreError> {
        let mut statement = self
            .connection
            .prepare_cached("SELECT part FROM held WHERE message_id = ?1 AND kind != 'header'")?;
        let held: Vec<String> = statement
            .query_map([message.0], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(held
            .iter()
            .any(|at| at == "whole" || at == place || place.starts_with(&format!("{at}."))))
    }

    /// What a message's body says: read from the whole message, or from its
    /// structure and its parts held, or `None` when it has neither.
    ///
    /// # Errors
    /// When the log or the database refuses.
    pub(super) fn body_of(&self, message: MessageId) -> Result<Option<BodyFields>, StoreError> {
        match self.read_part(message, "whole") {
            Ok(whole) => return Ok(Some(derive::body_fields(&whole))),
            Err(StoreError::NotFound(_)) => {}
            Err(error) => return Err(error),
        }
        let structure = match self.structure(message) {
            Ok(Some(structure)) => structure,
            Ok(None) => return Ok(None),
            Err(StoreError::NotFound(_)) => {
                return Ok(Some(BodyFields {
                    unparsed: Some("the message's structure could not be read"),
                    ..BodyFields::default()
                }));
            }
            Err(error) => return Err(error),
        };
        Ok(Some(self.parts_body(message, &structure, &[])?))
    }

    /// The text of a message's body, for its search document: read from the
    /// whole message, or from its text parts held, without its files.
    pub(super) fn body_text(&self, message: MessageId) -> Result<String, StoreError> {
        match self.read_part(message, "whole") {
            Ok(whole) => return Ok(derive::body_fields(&whole).text),
            Err(StoreError::NotFound(_)) => {}
            Err(error) => return Err(error),
        }
        match self.structure(message) {
            Ok(Some(structure)) => {
                Ok(parts::body_fields(&structure, &self.held_texts(message)?).text)
            }
            Ok(None) | Err(StoreError::NotFound(_)) => Ok(String::new()),
            Err(error) => Err(error),
        }
    }

    /// The body each message in `parts` will have once `parts` are held,
    /// for the messages held in parts that gain a part: read before the
    /// transaction that records them opens.
    pub(super) fn bodies_gaining(
        &self,
        parts: &[PartSeen<'_>],
    ) -> Result<HashMap<i64, BodyFields>, StoreError> {
        let mut bodies = HashMap::new();
        let messages: HashSet<MessageId> = parts
            .iter()
            .filter(|part| part.place != Place::Whole)
            .map(|part| part.message)
            .collect();
        for message in messages {
            let whole: bool = self.connection.query_row(
                "SELECT EXISTS (SELECT 1 FROM held WHERE message_id = ?1 AND part = 'whole')",
                [message.0],
                |row| row.get(0),
            )?;
            if whole {
                continue;
            }
            let Some(structure) = self.structure(message)? else {
                continue;
            };
            let extra: Vec<(Place<'_>, &[u8])> = parts
                .iter()
                .filter(|part| part.message == message)
                .map(|part| (part.place, part.bytes))
                .collect();
            bodies.insert(message.0, self.parts_body(message, &structure, &extra)?);
        }
        Ok(bodies)
    }

    /// Records a message over the size fetched whole as held in parts, all
    /// or none: its structure and the parts that hold its text, with what
    /// its body says derived in the same transaction. A message already held
    /// whole is left as it is, and a structure already held is kept.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when the message does not exist,
    /// [`StoreError::BadPlace`] when a place is not digits and dots, and
    /// [`StoreError::Conflict`] when other bytes are held for a part.
    pub fn record_in_parts(
        &mut self,
        message: MessageId,
        structure: &Structure,
        texts: &[(&str, &[u8])],
        now: i64,
    ) -> Result<(), StoreError> {
        let seen: Vec<PartSeen<'_>> = texts
            .iter()
            .map(|(place, bytes)| PartSeen {
                message,
                place: Place::Text(place),
                bytes,
            })
            .collect();
        if seen.iter().any(|part| !part.place.is_valid()) {
            return Err(StoreError::BadPlace);
        }
        let kept = self.structure(message)?;
        let structure = kept.as_ref().unwrap_or(structure);
        let extra: Vec<(Place<'_>, &[u8])> =
            seen.iter().map(|part| (part.place, part.bytes)).collect();
        let body = self.parts_body(message, structure, &extra)?;
        let bytes: Vec<&[u8]> = texts.iter().map(|(_, bytes)| *bytes).collect();
        let blobs = self.log.put_all(&bytes)?;
        self.log.make_durable(&blobs)?;
        self.ensure_index()?;
        let transaction = self.connection.transaction()?;
        let exists: Option<i64> = transaction
            .one("SELECT id FROM message WHERE id = ?1", [message.0], |row| {
                row.get(0)
            })
            .optional()?;
        if exists.is_none() {
            return Err(StoreError::NotFound("message"));
        }
        let whole: Option<i64> = transaction
            .one(
                "SELECT 1 FROM held WHERE message_id = ?1 AND part = 'whole'",
                [message.0],
                |row| row.get(0),
            )
            .optional()?;
        if whole.is_some() {
            return Ok(());
        }
        let mut touched = derived::Touched::new(derived::rebuild_cursor(&transaction)?);
        transaction.run(
            "INSERT INTO structure (message_id, body, fetched_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (message_id) DO NOTHING",
            params![message.0, structure.to_json(), now],
        )?;
        for (part, blob) in seen.iter().zip(&blobs) {
            let (place, kind) = part.place.columns();
            let had: Option<Vec<u8>> = transaction
                .one(
                    "SELECT blob FROM held WHERE message_id = ?1 AND part = ?2",
                    params![message.0, place],
                    |row| row.get(0),
                )
                .optional()?;
            match had {
                Some(other) if other != blob.as_bytes() => return Err(StoreError::Conflict),
                Some(_) => {}
                None => {
                    transaction.run(
                        "INSERT INTO held (message_id, part, kind, blob, size)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![
                            message.0,
                            place,
                            kind,
                            blob.as_bytes().as_slice(),
                            size_of(part.bytes)
                        ],
                    )?;
                }
            }
        }
        transaction.run(
            "DELETE FROM body_missing WHERE message_id = ?1",
            [message.0],
        )?;
        if !touched.awaits_rebuild(message.0) {
            derived::derive_body(&transaction, message.0, body, &mut touched)?;
        }
        derived::settle(&transaction, &touched, now)?;
        transaction.commit()?;
        self.index_documents(&touched.documents)?;
        Ok(())
    }
}
