//! Removing an account (the specification's section 11, `mail-account-remove`):
//! its mailboxes, what the provider showed in them, and every message no
//! other account's mailbox has shown, with the files in the log only those
//! messages held. Nothing at the provider is touched.

use rusqlite::OptionalExtension;

use super::{AccountId, AccountRow, Store, StoreError, note_change};
use crate::log::BlobId;

/// What removing an account would take, for the person to read before they
/// approve it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemovalPreview {
    /// The account.
    pub account: AccountRow,
    /// Its mailboxes.
    pub mailboxes: u64,
    /// The messages no other account shows, which go with it.
    pub messages: u64,
}

/// What removing an account took.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Removed {
    /// Messages removed: those no other account showed.
    pub messages: u64,
    /// Files removed from the log: bytes no message left holds.
    pub files: u64,
    /// Files that could not be removed. Nothing refers to them; they are
    /// left as they are.
    pub files_left: u64,
}

/// The messages any mailbox of the account has shown, now or before, that no
/// other account's mailbox has.
const ONLY_THIS_ACCOUNT: &str = "
    SELECT observation.message_id FROM observation
        JOIN mailbox ON mailbox.id = observation.mailbox_id
        WHERE mailbox.account_id = ?1
    EXCEPT
    SELECT observation.message_id FROM observation
        JOIN mailbox ON mailbox.id = observation.mailbox_id
        WHERE mailbox.account_id <> ?1";

impl Store {
    /// What removing `account` would take, or `None` when there is no such
    /// account.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn removal_preview(
        &self,
        account: AccountId,
    ) -> Result<Option<RemovalPreview>, StoreError> {
        let Some(row) = self.accounts()?.into_iter().find(|row| row.id == account) else {
            return Ok(None);
        };
        let mailboxes: i64 = self.connection.query_row(
            "SELECT count(*) FROM mailbox WHERE account_id = ?1",
            [account.0],
            |row| row.get(0),
        )?;
        let messages: i64 = self.connection.query_row(
            &format!("SELECT count(*) FROM ({ONLY_THIS_ACCOUNT})"),
            [account.0],
            |row| row.get(0),
        )?;
        Ok(Some(RemovalPreview {
            account: row,
            mailboxes: u64::try_from(mailboxes).unwrap_or(0),
            messages: u64::try_from(messages).unwrap_or(0),
        }))
    }

    /// Removes `account`: its mailboxes, what the provider showed in them,
    /// and every message no other account's mailbox has shown, then the
    /// files in the log that only those messages held.
    ///
    /// Everything derived is thrown away first and a rebuild is marked as
    /// under way ([`Store::rebuild_begin`]), so that nothing derived refers
    /// to what goes and the rebuild derives what is left. The rows go in one
    /// transaction; the files after it, so a stop between leaves files that
    /// nothing refers to, never a row whose file is gone.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when there is no such account, and when the
    /// database or the index refuses.
    pub fn remove_account(&mut self, account: AccountId, now: i64) -> Result<Removed, StoreError> {
        let exists = self
            .connection
            .query_row("SELECT 1 FROM account WHERE id = ?1", [account.0], |_| {
                Ok(())
            })
            .optional()?
            .is_some();
        if !exists {
            return Err(StoreError::NotFound("account"));
        }
        self.rebuild_begin()?;
        let transaction = self.connection.transaction()?;
        transaction.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS removing_message (id INTEGER PRIMARY KEY);
             DELETE FROM removing_message;",
        )?;
        transaction.execute(
            &format!("INSERT INTO removing_message (id) {ONLY_THIS_ACCOUNT}"),
            [account.0],
        )?;
        let messages: i64 =
            transaction.query_row("SELECT count(*) FROM removing_message", [], |row| {
                row.get(0)
            })?;
        // The files only the messages that go hold.
        let blobs: Vec<Vec<u8>> = {
            let mut statement = transaction.prepare(
                "SELECT blob FROM held WHERE message_id IN (SELECT id FROM removing_message)
                 EXCEPT
                 SELECT blob FROM held WHERE message_id NOT IN (SELECT id FROM removing_message)",
            )?;
            statement
                .query_map([], |row| row.get(0))?
                .collect::<Result<_, _>>()?
        };
        transaction.execute_batch(
            "DELETE FROM held WHERE message_id IN (SELECT id FROM removing_message);
             DELETE FROM refetch WHERE message_id IN (SELECT id FROM removing_message);
             DELETE FROM body_missing WHERE message_id IN (SELECT id FROM removing_message);
             DELETE FROM structure WHERE message_id IN (SELECT id FROM removing_message);",
        )?;
        transaction.execute(
            "DELETE FROM observation WHERE mailbox_id IN
                 (SELECT id FROM mailbox WHERE account_id = ?1)",
            [account.0],
        )?;
        transaction.execute(
            "DELETE FROM unreturned WHERE mailbox_id IN
                 (SELECT id FROM mailbox WHERE account_id = ?1)",
            [account.0],
        )?;
        transaction.execute("DELETE FROM mailbox WHERE account_id = ?1", [account.0])?;
        transaction.execute_batch(
            "DELETE FROM message WHERE id IN (SELECT id FROM removing_message);
             DELETE FROM removing_message;",
        )?;
        transaction.execute("DELETE FROM account WHERE id = ?1", [account.0])?;
        note_change(&transaction, now, "account-removed", account.0)?;
        transaction.commit()?;
        let mut removed = Removed {
            messages: u64::try_from(messages).unwrap_or(0),
            files: 0,
            files_left: 0,
        };
        for blob in blobs {
            let Some(id) = BlobId::from_bytes(&blob) else {
                continue;
            };
            match self.log.remove(id) {
                Ok(true) => removed.files += 1,
                Ok(false) => {}
                Err(_) => removed.files_left += 1,
            }
        }
        Ok(removed)
    }
}

/// Every table that refers to a message, a mailbox or an account, and what
/// removing an account does with it. A table added later fails the test
/// below until removal handles it.
#[cfg(test)]
const HANDLED: &[(&str, &str)] = &[
    // Not derived: removed here.
    ("held", "message"),
    ("refetch", "message"),
    ("body_missing", "message"),
    ("structure", "message"),
    ("observation", "message"),
    ("observation", "mailbox"),
    ("unreturned", "mailbox"),
    ("mailbox", "account"),
    // Derived: emptied by the rebuild that removal begins.
    ("envelope", "message"),
    ("part", "message"),
    ("link", "message"),
    ("thread_place", "mailbox"),
];

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::HANDLED;

    #[test]
    fn removal_handles_every_table_that_refers_to_what_it_removes() {
        let directory = tempfile::tempdir().unwrap();
        let home = crate::home::Home::at(directory.path().join("data"));
        let store = crate::store::Store::open(&home).unwrap();
        let mut referring = Vec::new();
        let tables: Vec<String> = {
            let mut statement = store
                .connection
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
                .unwrap();
            statement
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        for table in tables {
            let mut statement = store
                .connection
                .prepare("SELECT \"table\" FROM pragma_foreign_key_list(?1)")
                .unwrap();
            let targets: Vec<String> = statement
                .query_map([&table], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            for target in targets {
                if ["message", "mailbox", "account"].contains(&target.as_str()) {
                    referring.push((table.clone(), target));
                }
            }
        }
        let mut handled: Vec<(String, String)> = HANDLED
            .iter()
            .map(|(table, target)| ((*table).to_string(), (*target).to_string()))
            .collect();
        handled.sort();
        referring.sort();
        assert_eq!(referring, handled);
    }
}
