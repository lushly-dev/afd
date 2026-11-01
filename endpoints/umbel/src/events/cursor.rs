//! The cursor, version 0: `v0:<space>:<seq>`.
//!
//! A cursor is opaque to consumers. `seq` is the event's, and `v0:<space>:0` is the cursor before
//! the first event (`schemas/cursor.v0.json`).

use super::error::invalid_cursor;
use crate::workspace::SpaceId;
use afd::CommandError;
use std::fmt;

/// A position in one space's event stream.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Cursor {
    space: SpaceId,
    seq: u64,
}

impl Cursor {
    /// The cursor after event `seq` of `space`.
    pub fn new(space: SpaceId, seq: u64) -> Self {
        Self { space, seq }
    }

    /// The cursor before the first event of `space`.
    pub fn zero(space: SpaceId) -> Self {
        Self::new(space, 0)
    }

    /// Parse a cursor string.
    ///
    /// # Errors
    /// A message naming the rule when `text` is not `v0:<space>:<seq>` with `seq` `0` or a
    /// number without a leading zero.
    pub fn parse(text: &str) -> Result<Self, String> {
        let malformed = || {
            format!(
                "`{}` is not a cursor of the form v0:<space>:<seq>",
                shown(text)
            )
        };
        let rest = text.strip_prefix("v0:").ok_or_else(malformed)?;
        let (space, seq) = rest.rsplit_once(':').ok_or_else(malformed)?;
        let space = SpaceId::parse(space).map_err(|_| malformed())?;
        let digits = !seq.is_empty()
            && seq.bytes().all(|byte| byte.is_ascii_digit())
            && (seq == "0" || !seq.starts_with('0'));
        let seq = digits
            .then(|| seq.parse::<u64>().ok())
            .flatten()
            .ok_or_else(malformed)?;
        Ok(Self { space, seq })
    }

    /// Parse `text` as a cursor of `space` that is not past `head`, the `seq` of the stream's last
    /// event: what `event-list` and `event-ack` accept.
    ///
    /// # Errors
    /// `INVALID_CURSOR`, naming which rule the cursor breaks.
    pub(crate) fn within(text: &str, space: &SpaceId, head: u64) -> Result<Self, CommandError> {
        let cursor = Self::parse(text).map_err(invalid_cursor)?;
        if cursor.space() != space {
            return Err(invalid_cursor(format!(
                "Cursor {cursor} belongs to space {}, not {space}",
                cursor.space()
            )));
        }
        if cursor.seq() > head {
            return Err(invalid_cursor(format!(
                "Cursor {cursor} is past the head of space {space}, v0:{space}:{head}"
            )));
        }
        Ok(cursor)
    }

    /// The space.
    pub fn space(&self) -> &SpaceId {
        &self.space
    }

    /// The `seq` of the last event before the position: 0 before the first.
    pub fn seq(&self) -> u64 {
        self.seq
    }
}

impl fmt::Display for Cursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "v0:{}:{}", self.space, self.seq)
    }
}

fn shown(text: &str) -> String {
    text.chars().take(64).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_zero_is_the_start() {
        let cursor = Cursor::parse("v0:main:42").unwrap();
        assert_eq!((cursor.space().as_str(), cursor.seq()), ("main", 42));
        assert_eq!(cursor.to_string(), "v0:main:42");
        let zero = Cursor::zero(SpaceId::parse("notes-2").unwrap());
        assert_eq!(zero.to_string(), "v0:notes-2:0");
        assert_eq!(Cursor::parse("v0:notes-2:0").unwrap(), zero);
    }

    #[test]
    fn refuses_everything_the_schema_pattern_refuses() {
        for text in [
            "",
            "v0:main",
            "v0:main:",
            "v0:main:01",
            "v0:main:+1",
            "v0:main:-1",
            "v0:main:1.5",
            "v0::1",
            "v0:Main:1",
            "v1:main:3",
            "main:3",
            "v0:main:1:2",
            "v0:main:99999999999999999999999",
            " v0:main:1",
        ] {
            assert!(Cursor::parse(text).is_err(), "{text:?}");
        }
    }
}
