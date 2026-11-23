//! The person's policy (the specification's 9.4 and plugin.spec.md section 10,
//! M36): what an agent or a script may change in the mailbox with nobody
//! present. It is data — one default row plus optional per-account overrides —
//! and only the person changes it. Not derived: it survives a rebuild.

use rusqlite::{OptionalExtension, params};

use super::{AccountId, Store, StoreError, note_change};

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

/// Optional per-account overrides over the default policy (M36).
/// Any `None` field falls back to the default `policy` row.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AccountPolicyOverrides {
    /// Per-account `changePerCall` override.
    pub change_per_call: Option<u32>,
    /// Per-account `trashPerCall` override.
    pub trash_per_call: Option<u32>,
    /// Per-account `trashPerDay` override.
    pub trash_per_day: Option<u32>,
    /// Per-account `askAbove` override.
    pub ask_above: Option<u32>,
}

impl AccountPolicyOverrides {
    /// Resolves these overrides against `base` without clamping `trash_per_call`
    /// to `trash_per_day`, used when validating and previewing `mail-policy-set`
    /// so validation, approval, persistence, and response all see the same policy.
    #[must_use]
    pub fn resolve_unclamped(self, base: Policy) -> Policy {
        Policy {
            change_per_call: self.change_per_call.unwrap_or(base.change_per_call),
            trash_per_call: self.trash_per_call.unwrap_or(base.trash_per_call),
            trash_per_day: self.trash_per_day.unwrap_or(base.trash_per_day),
            ask_above: self.ask_above.unwrap_or(base.ask_above),
        }
    }

    /// Resolves these overrides against `base`, clamping `trash_per_call` to
    /// `trash_per_day` if `base` was later lowered below a stored override.
    #[must_use]
    pub fn resolve(self, base: Policy) -> Policy {
        let mut policy = self.resolve_unclamped(base);
        policy.trash_per_call = policy.trash_per_call.min(policy.trash_per_day);
        policy
    }
}

/// One account's stored policy override row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountPolicyRow {
    /// The account this override belongs to.
    pub account: AccountId,
    /// The fields explicitly set for this account.
    pub overrides: AccountPolicyOverrides,
    /// When the override was last set.
    pub set_at: i64,
}

fn whole(value: i64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

fn opt_whole(value: Option<i64>) -> Option<u32> {
    value.map(whole)
}

fn account_policy_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AccountPolicyRow> {
    Ok(AccountPolicyRow {
        account: AccountId(row.get(0)?),
        overrides: AccountPolicyOverrides {
            change_per_call: opt_whole(row.get(1)?),
            trash_per_call: opt_whole(row.get(2)?),
            trash_per_day: opt_whole(row.get(3)?),
            ask_above: opt_whole(row.get(4)?),
        },
        set_at: row.get(5)?,
    })
}

impl Store {
    /// The person's default policy.
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

    /// One account's policy override row, if any.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn account_policy(
        &self,
        account: AccountId,
    ) -> Result<Option<AccountPolicyRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT account_id, change_per_call, trash_per_call, trash_per_day, ask_above, set_at
                 FROM account_policy WHERE account_id = ?1",
                [account.0],
                account_policy_row,
            )
            .optional()?)
    }

    /// Every account's policy override row, ordered by account id.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn account_policies(&self) -> Result<Vec<AccountPolicyRow>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT account_id, change_per_call, trash_per_call, trash_per_day, ask_above, set_at
             FROM account_policy ORDER BY account_id",
        )?;
        let rows = statement.query_map([], account_policy_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// The effective policy for `account` (or the default policy when `None`),
    /// together with whether `trash_per_day` was explicitly overridden for that
    /// account.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn effective_policy(
        &self,
        account: Option<AccountId>,
    ) -> Result<(Policy, bool), StoreError> {
        let base = self.policy()?.policy;
        let Some(account) = account else {
            return Ok((base, false));
        };
        let Some(row) = self.account_policy(account)? else {
            return Ok((base, false));
        };
        Ok((
            row.overrides.resolve(base),
            row.overrides.trash_per_day.is_some(),
        ))
    }

    /// Distinct accounts touched by selection `id`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn selection_accounts(&self, id: i64) -> Result<Vec<AccountId>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT DISTINCT mailbox.account_id
             FROM selection_item
             JOIN mailbox ON mailbox.id = selection_item.mailbox_id
             WHERE selection_item.selection_id = ?1
             ORDER BY mailbox.account_id",
        )?;
        let rows = statement.query_map([id], |row| Ok(AccountId(row.get(0)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Distinct accounts currently showing any of `messages` outside junk and
    /// trash.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn shown_message_accounts(&self, messages: &[i64]) -> Result<Vec<AccountId>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT DISTINCT mailbox.account_id
             FROM observation
             JOIN mailbox ON mailbox.id = observation.mailbox_id
             WHERE observation.message_id = ?1
               AND observation.ended_at IS NULL
               AND mailbox.gone_at IS NULL
               AND observation.validity = mailbox.validity
               AND mailbox.role NOT IN ('junk', 'trash')",
        )?;
        let mut accounts = std::collections::BTreeSet::new();
        for &message in messages {
            let rows = statement.query_map([message], |row| row.get::<_, i64>(0))?;
            for row in rows {
                accounts.insert(row?);
            }
        }
        Ok(accounts.into_iter().map(AccountId).collect())
    }

    /// Distinct accounts touched by any item of operation `id` (whether waiting
    /// or done, covering both resume and undo).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn operation_all_accounts(&self, id: i64) -> Result<Vec<AccountId>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT DISTINCT mailbox.account_id
             FROM operation_item
             JOIN mailbox ON mailbox.id = operation_item.mailbox_id
             WHERE operation_item.operation_id = ?1
             ORDER BY mailbox.account_id",
        )?;
        let rows = statement.query_map([id], |row| Ok(AccountId(row.get(0)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// How many messages `creator` set out to move to the trash in `account`
    /// since `since`, in operations it made (plugin.spec.md section 10, M36).
    /// Multi-account operations (e.g. pre-migration) count only items belonging
    /// to `account`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn trashed_since_in_account(
        &self,
        creator: &super::Proposer,
        account: AccountId,
        since: i64,
    ) -> Result<u64, StoreError> {
        Ok(super::count(self.connection.query_row(
            "SELECT coalesce(sum(
                 CASE
                     WHEN (
                         SELECT count(DISTINCT m2.account_id)
                         FROM operation_item oi2
                         JOIN mailbox m2 ON m2.id = oi2.mailbox_id
                         WHERE oi2.operation_id = operation.id
                     ) <= 1 THEN operation.messages
                     ELSE (
                         SELECT count(DISTINCT coalesce(CAST(oi3.message_id AS TEXT), oi3.mailbox_id || ':' || oi3.validity || ':' || oi3.provider_id))
                         FROM operation_item oi3
                         JOIN mailbox m3 ON m3.id = oi3.mailbox_id
                         WHERE oi3.operation_id = operation.id
                           AND m3.account_id = ?4
                     )
                 END
             ), 0)
             FROM operation
             WHERE operation.kind = 'trash'
               AND operation.creator_kind = ?1
               AND operation.creator_id IS ?2
               AND operation.created_at > ?3
               AND operation.charged = 1
               AND EXISTS (
                   SELECT 1 FROM operation_item
                   JOIN mailbox ON mailbox.id = operation_item.mailbox_id
                   WHERE operation_item.operation_id = operation.id
                     AND mailbox.account_id = ?4
               )",
            params![creator.kind, creator.id, since, account.0],
            |row| row.get(0),
        )?))
    }

    /// The distinct accounts of operation `id`'s remaining open items
    /// (`waiting`, `copying`, `copied`, `flagged`), ordered by account id.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn operation_open_accounts(&self, id: i64) -> Result<Vec<AccountId>, StoreError> {
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT DISTINCT mailbox.account_id
             FROM operation_item
             JOIN mailbox ON mailbox.id = operation_item.mailbox_id
             WHERE operation_item.operation_id = ?1
               AND operation_item.step IN {}
             ORDER BY mailbox.account_id",
            super::operations::OPEN_STEPS
        ))?;
        let rows = statement.query_map([id], |row| Ok(AccountId(row.get(0)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Sets the person's default policy to `policy`, which [`Policy::fault`] has
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

    /// Sets `account`'s policy override row and returns its previous effective
    /// policy.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when `account` does not exist, or when SQLite
    /// refuses.
    pub fn set_account_policy(
        &mut self,
        account: AccountId,
        overrides: AccountPolicyOverrides,
        now: i64,
    ) -> Result<Policy, StoreError> {
        let transaction = self.connection.transaction()?;
        let exists = transaction
            .query_row("SELECT 1 FROM account WHERE id = ?1", [account.0], |_| {
                Ok(())
            })
            .optional()?
            .is_some();
        if !exists {
            return Err(StoreError::NotFound("account"));
        }
        let base = transaction.query_row(
            "SELECT change_per_call, trash_per_call, trash_per_day, ask_above
             FROM policy WHERE id = 1",
            [],
            |row| {
                Ok(Policy {
                    change_per_call: whole(row.get(0)?),
                    trash_per_call: whole(row.get(1)?),
                    trash_per_day: whole(row.get(2)?),
                    ask_above: whole(row.get(3)?),
                })
            },
        )?;
        let before = transaction
            .query_row(
                "SELECT account_id, change_per_call, trash_per_call, trash_per_day, ask_above, set_at
                 FROM account_policy WHERE account_id = ?1",
                [account.0],
                account_policy_row,
            )
            .optional()?
            .map_or(base, |row| row.overrides.resolve(base));
        transaction.execute(
            "INSERT INTO account_policy
                 (account_id, change_per_call, trash_per_call, trash_per_day, ask_above, set_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (account_id) DO UPDATE SET
                 change_per_call = excluded.change_per_call,
                 trash_per_call = excluded.trash_per_call,
                 trash_per_day = excluded.trash_per_day,
                 ask_above = excluded.ask_above,
                 set_at = excluded.set_at",
            params![
                account.0,
                overrides.change_per_call,
                overrides.trash_per_call,
                overrides.trash_per_day,
                overrides.ask_above,
                now
            ],
        )?;
        note_change(&transaction, now, "account-policy", account.0)?;
        transaction.commit()?;
        Ok(before)
    }

    /// Removes `account`'s policy override row so it falls back to the default
    /// policy, returning its previous effective policy.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when `account` does not exist, or when SQLite
    /// refuses.
    pub fn clear_account_policy(
        &mut self,
        account: AccountId,
        now: i64,
    ) -> Result<Policy, StoreError> {
        let transaction = self.connection.transaction()?;
        let exists = transaction
            .query_row("SELECT 1 FROM account WHERE id = ?1", [account.0], |_| {
                Ok(())
            })
            .optional()?
            .is_some();
        if !exists {
            return Err(StoreError::NotFound("account"));
        }
        let base = transaction.query_row(
            "SELECT change_per_call, trash_per_call, trash_per_day, ask_above
             FROM policy WHERE id = 1",
            [],
            |row| {
                Ok(Policy {
                    change_per_call: whole(row.get(0)?),
                    trash_per_call: whole(row.get(1)?),
                    trash_per_day: whole(row.get(2)?),
                    ask_above: whole(row.get(3)?),
                })
            },
        )?;
        let before = transaction
            .query_row(
                "SELECT account_id, change_per_call, trash_per_call, trash_per_day, ask_above, set_at
                 FROM account_policy WHERE account_id = ?1",
                [account.0],
                account_policy_row,
            )
            .optional()?
            .map_or(base, |row| row.overrides.resolve(base));
        transaction.execute(
            "DELETE FROM account_policy WHERE account_id = ?1",
            [account.0],
        )?;
        note_change(&transaction, now, "account-policy", account.0)?;
        transaction.commit()?;
        Ok(before)
    }
}
