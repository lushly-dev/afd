//! The person's policy (the specification's 9.4): what an agent or a script
//! may change in the mailbox with nobody present. It is data, one row, and
//! only the person changes it. Not derived: it survives a rebuild.

use rusqlite::params;

use super::{Store, StoreError, note_change};

/// The most an agent may be allowed to change in one call. A change within
/// the policy runs inside the call, which a mount gives 60 seconds (3.2).
pub const MOST_PER_CALL: u32 = 1_000;

/// The most an agent may be allowed to trash in a day.
pub const MOST_PER_DAY: u32 = 10_000;

/// The largest change the command line makes for the person without asking.
pub const MOST_ASK_ABOVE: u32 = 1_000_000;

/// What the person allows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    /// How many messages an agent or a script may archive, label or mark in
    /// one call.
    pub change_per_call: u32,
    /// How many it may trash in one call.
    pub trash_per_call: u32,
    /// How many each caller may trash in any 24 hours.
    pub trash_per_day: u32,
    /// Above this many messages, the command line shows the person the count
    /// and asks before a change of theirs.
    pub ask_above: u32,
}

impl Policy {
    /// The policy the person agreed to (2026-11-11): 500 a call to archive,
    /// label and mark; 50 a call and 200 a day to trash; the person asked
    /// above 200.
    pub const DEFAULT: Self = Self {
        change_per_call: 500,
        trash_per_call: 50,
        trash_per_day: 200,
        ask_above: 200,
    };

    /// Why the policy cannot be kept, in the engine's words, or `None`.
    ///
    /// Each rule here bounds one field from above, or keeps a call's trash
    /// within a day's: `mail-policy-set` relies on that to refuse, without
    /// asking, input that no policy could take (its `LENIENT`, and the test
    /// beside it). A rule of another shape must change both.
    #[must_use]
    pub fn fault(&self) -> Option<&'static str> {
        if self.change_per_call > MOST_PER_CALL || self.trash_per_call > MOST_PER_CALL {
            return Some("a limit a call is at most 1000 messages, what a call can finish");
        }
        if self.trash_per_day > MOST_PER_DAY {
            return Some("the limit a day is at most 10000 messages");
        }
        if self.trash_per_call > self.trash_per_day {
            return Some("the trash limit a call is more than the limit a day");
        }
        if self.ask_above > MOST_ASK_ABOVE {
            return Some("the person is asked above at most 1000000 messages");
        }
        None
    }
}

/// The policy as the store keeps it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PolicyRow {
    /// What it allows.
    pub policy: Policy,
    /// When the person last changed it; `None` while it is the default.
    pub set_at: Option<i64>,
}

fn whole(value: i64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

impl Store {
    /// The person's policy.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn policy(&self) -> Result<PolicyRow, StoreError> {
        Ok(self.connection.query_row(
            "SELECT change_per_call, trash_per_call, trash_per_day, ask_above, set_at
             FROM policy WHERE id = 1",
            [],
            |row| {
                Ok(PolicyRow {
                    policy: Policy {
                        change_per_call: whole(row.get(0)?),
                        trash_per_call: whole(row.get(1)?),
                        trash_per_day: whole(row.get(2)?),
                        ask_above: whole(row.get(3)?),
                    },
                    set_at: row.get(4)?,
                })
            },
        )?)
    }

    /// Sets the person's policy to `policy`, which [`Policy::fault`] has
    /// found nothing wrong with, and returns what it was.
    ///
    /// # Errors
    /// When the database refuses, the policy's checks among them.
    pub fn set_policy(&mut self, policy: &Policy, now: i64) -> Result<PolicyRow, StoreError> {
        let transaction = self.connection.transaction()?;
        let before = transaction.query_row(
            "SELECT change_per_call, trash_per_call, trash_per_day, ask_above, set_at
             FROM policy WHERE id = 1",
            [],
            |row| {
                Ok(PolicyRow {
                    policy: Policy {
                        change_per_call: whole(row.get(0)?),
                        trash_per_call: whole(row.get(1)?),
                        trash_per_day: whole(row.get(2)?),
                        ask_above: whole(row.get(3)?),
                    },
                    set_at: row.get(4)?,
                })
            },
        )?;
        transaction.execute(
            "UPDATE policy SET change_per_call = ?1, trash_per_call = ?2, trash_per_day = ?3,
                               ask_above = ?4, set_at = ?5
             WHERE id = 1",
            params![
                policy.change_per_call,
                policy.trash_per_call,
                policy.trash_per_day,
                policy.ask_above,
                now
            ],
        )?;
        note_change(&transaction, now, "policy", 1)?;
        transaction.commit()?;
        Ok(before)
    }
}
