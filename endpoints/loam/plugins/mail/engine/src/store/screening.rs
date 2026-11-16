//! What step C1 reports of screening on the person's mail (the
//! specification's 6.3 and 7.2): the census's Q2 as the engine computes it,
//! and how many stream stories each of the two groupings would make.
//!
//! Counts only. Screening proper, with the person's decisions, is step C2's
//! (`classes.rs`); here a sender is `known` when the person has written to
//! it, which is what the census measured, and every other inbound message is
//! `bulk` when a lookup decides it (rule 3) and `unknown` otherwise. Since
//! step C2 the person's own addresses include those they said are theirs
//! (a `mine` decision), which the census did not have: on a store with such
//! a decision the report's Q2 leaves that address's mail out.

use serde::Serialize;

use super::senders::BULK;
use super::{Store, StoreError, count};

/// A template seen at least this many times decides a message (7.2, rule 3),
/// and a stream story needs at least this many messages (section 8). The
/// census's `TEMPLATE_MIN`.
pub const RECURRING: i64 = 5;

/// Which messages a report counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Scope {
    /// Every message the store holds.
    Every,
    /// The messages a mailbox other than junk and trash shows now, as the
    /// census read every mailbox but those.
    AsTheCensus,
    /// Those, leaving out the mailbox that shows the most messages, as the
    /// census's second iCloud run did.
    WithoutLargest,
}

/// How the bulk mail of a report falls into stream stories under one
/// grouping (section 8).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Grouping {
    /// Groups of at least [`RECURRING`] messages: the stories.
    pub stories: u64,
    /// The messages in them.
    pub messages_in_stories: u64,
    /// Every group, the stories among them.
    pub groups: u64,
    /// Bulk messages the grouping cannot place: no list id, and no template
    /// key (or, for the second grouping, no body shape), which a message
    /// held as its headers alone lacks.
    pub ungrouped: u64,
}

/// What a report counts in one scope.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreeningCounts {
    /// Messages in the scope.
    pub messages: u64,
    /// Those not from the person.
    pub inbound: u64,
    /// Of those, from senders the person never wrote to: Q2's whole.
    pub from_strangers: u64,
    /// Of those, the ones with a list or bulk header.
    pub decided_by_header: u64,
    /// Of those, the ones without such a header whose template was seen at
    /// least [`RECURRING`] times.
    pub decided_by_template_alone: u64,
    /// Of those from strangers, the ones with no template key: held as their
    /// headers alone, or unreadable.
    pub without_template_key: u64,
    /// Grouped by list id, or else by sender and template key.
    pub by_key: Grouping,
    /// Grouped by list id, or else by sender, template key and body shape.
    pub by_key_and_shape: Grouping,
    /// Grouped by list id, or else by sender alone: not one of section 8's
    /// groupings, reported beside them because a template key holds the
    /// subject's shape, so a newsletter whose subject changes with each issue
    /// makes a group of one each time.
    pub by_sender: Grouping,
}

impl ScreeningCounts {
    /// The messages from strangers a lookup decides: rule 3.
    #[must_use]
    pub fn decided(&self) -> u64 {
        self.decided_by_header + self.decided_by_template_alone
    }

    /// Q2: the share of the messages from strangers a lookup decides, or
    /// `None` when there are none.
    #[must_use]
    #[expect(
        clippy::cast_precision_loss,
        reason = "a share of message counts, far below 2^52"
    )]
    pub fn q2(&self) -> Option<f64> {
        (self.from_strangers > 0).then(|| self.decided() as f64 / self.from_strangers as f64)
    }
}

/// Q2 and the groupings in each scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreeningReport {
    /// Every message held.
    pub every_message: ScreeningCounts,
    /// What a mailbox other than junk and trash shows now.
    pub as_the_census_counted: ScreeningCounts,
    /// That, without the mailbox that shows the most.
    pub without_the_largest_mailbox: ScreeningCounts,
}

impl Store {
    /// Counts Q2 and the stream stories each grouping would make, in each
    /// scope. Reads the whole store; meant for a report, not a command.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn screening_report(&self) -> Result<ScreeningReport, StoreError> {
        self.connection.execute_batch(
            "DROP TABLE IF EXISTS temp.own;
             CREATE TEMP TABLE own (address TEXT PRIMARY KEY) WITHOUT ROWID;",
        )?;
        for address in super::senders::own_addresses(&self.connection)? {
            self.connection
                .execute("INSERT OR IGNORE INTO temp.own VALUES (?1)", [address])?;
        }
        self.connection.execute_batch(&format!(
            "DROP TABLE IF EXISTS temp.recurring;
             CREATE TEMP TABLE recurring (key BLOB PRIMARY KEY) WITHOUT ROWID;
             INSERT INTO recurring
                 SELECT template_key FROM envelope WHERE template_key IS NOT NULL
                 GROUP BY template_key HAVING count(*) >= {RECURRING};"
        ))?;
        let largest: i64 = self.connection.query_row(
            "SELECT coalesce((SELECT mailbox_id FROM observation WHERE ended_at IS NULL
                              GROUP BY mailbox_id ORDER BY count(*) DESC, mailbox_id
                              LIMIT 1), 0)",
            [],
            |row| row.get(0),
        )?;
        let report = ScreeningReport {
            every_message: self.screening_counts(Scope::Every, largest)?,
            as_the_census_counted: self.screening_counts(Scope::AsTheCensus, largest)?,
            without_the_largest_mailbox: self.screening_counts(Scope::WithoutLargest, largest)?,
        };
        self.connection
            .execute_batch("DROP TABLE temp.own; DROP TABLE temp.recurring;")?;
        Ok(report)
    }

    fn screening_counts(&self, scope: Scope, largest: i64) -> Result<ScreeningCounts, StoreError> {
        let shown = "EXISTS (SELECT 1 FROM observation JOIN mailbox
                             ON mailbox.id = observation.mailbox_id
                             WHERE observation.message_id = envelope.message_id
                               AND observation.ended_at IS NULL
                               AND mailbox.role NOT IN ('junk', 'trash')";
        let (scope, bound): (String, Vec<i64>) = match scope {
            Scope::Every => ("1".to_string(), vec![]),
            Scope::AsTheCensus => (format!("{shown})"), vec![]),
            Scope::WithoutLargest => (
                format!("{shown} AND observation.mailbox_id <> ?1)"),
                vec![largest],
            ),
        };
        // Each inbound message of the scope: whether its sender is one the
        // person wrote to, and whether a header or its template decides it.
        self.connection
            .execute_batch("DROP TABLE IF EXISTS temp.inbound;")?;
        self.connection.execute(
            &format!(
                "CREATE TEMP TABLE inbound AS
                 SELECT envelope.message_id, envelope.list_id, envelope.sender_address,
                        envelope.template_key, envelope.body_shape,
                        coalesce(sender.written, 0) > 0 AS known,
                        {BULK} AS by_header,
                        coalesce(envelope.template_key IN (SELECT key FROM temp.recurring), 0)
                            AS by_template
                 FROM envelope LEFT JOIN sender ON sender.address = envelope.sender_address
                 WHERE ({scope}) AND envelope.sender_address NOT IN (SELECT address FROM temp.own)"
            ),
            rusqlite::params_from_iter(&bound),
        )?;
        let messages: i64 = self.connection.query_row(
            &format!("SELECT count(*) FROM envelope WHERE {scope}"),
            rusqlite::params_from_iter(&bound),
            |row| row.get(0),
        )?;
        let (inbound, strangers, by_header, by_template, keyless): (i64, i64, i64, i64, i64) =
            self.connection.query_row(
                "SELECT count(*),
                        count(*) FILTER (WHERE NOT known),
                        count(*) FILTER (WHERE NOT known AND by_header),
                        count(*) FILTER (WHERE NOT known AND NOT by_header AND by_template),
                        count(*) FILTER (WHERE NOT known AND template_key IS NULL)
                 FROM temp.inbound",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )?;
        let grouping = |key: &str| -> Result<Grouping, StoreError> {
            let (stories, in_stories, groups, ungrouped): (i64, i64, i64, i64) =
                self.connection.query_row(
                    &format!(
                        "WITH bulk AS (SELECT {key} AS story FROM temp.inbound
                                       WHERE NOT known AND (by_header OR by_template)),
                              grouped AS (SELECT count(*) AS n FROM bulk
                                          WHERE story IS NOT NULL GROUP BY story)
                         SELECT (SELECT count(*) FROM grouped WHERE n >= {RECURRING}),
                                (SELECT coalesce(sum(n), 0) FROM grouped WHERE n >= {RECURRING}),
                                (SELECT count(*) FROM grouped),
                                (SELECT count(*) FROM bulk WHERE story IS NULL)"
                    ),
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )?;
            Ok(Grouping {
                stories: count(stories),
                messages_in_stories: count(in_stories),
                groups: count(groups),
                ungrouped: count(ungrouped),
            })
        };
        let by_key = grouping(
            "CASE WHEN list_id <> '' THEN 'list ' || list_id
                  WHEN template_key IS NOT NULL
                      THEN 'sender ' || hex(template_key) || ' ' || sender_address END",
        )?;
        let by_key_and_shape = grouping(
            "CASE WHEN list_id <> '' THEN 'list ' || list_id
                  WHEN template_key IS NOT NULL AND body_shape IS NOT NULL
                      THEN 'sender ' || hex(template_key) || ' ' || hex(body_shape) || ' '
                           || sender_address END",
        )?;
        let by_sender = grouping(
            "CASE WHEN list_id <> '' THEN 'list ' || list_id ELSE 'sender ' || sender_address END",
        )?;
        self.connection.execute_batch("DROP TABLE temp.inbound;")?;
        Ok(ScreeningCounts {
            messages: count(messages),
            inbound: count(inbound),
            from_strangers: count(strangers),
            decided_by_header: count(by_header),
            decided_by_template_alone: count(by_template),
            without_template_key: count(keyless),
            by_key,
            by_key_and_shape,
            by_sender,
        })
    }
}
