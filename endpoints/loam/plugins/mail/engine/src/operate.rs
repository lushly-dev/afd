//! Running an operation at the provider (the specification's 9.1 to 9.3).
//!
//! An operation works through its frozen set a batch at a time: each batch
//! is one mailbox's items going to one place. Every step is recorded before
//! the next is asked for, so a stop anywhere is resumed from the step
//! reached:
//!
//! - **A copy or a move** records the destination's next id and the step
//!   `copying` before it asks. If the answer is lost, the next run looks
//!   among the ids the destination gave from there, by each message's
//!   identity (4.2), so a message is never copied twice. A message the
//!   provider never returned has no identity, and its copy is never guessed
//!   at: it is asked for again, which at worst leaves two copies.
//! - **A move without `MOVE`** is a copy, the delete flag on exactly the
//!   messages whose copies the provider confirmed, and `UID EXPUNGE` of
//!   exactly those: never a message removed before its copy is confirmed.
//! - **A change of flags** records each message's flags before it asks, and
//!   keeps them when it asks again, so that a change whose answer was lost
//!   is still known as made and its undo puts back the flags before.
//! - **A copy an undo removes** goes only while the message it was copied
//!   from is still where it was and not flagged to be deleted, checked
//!   again before a flagged copy is removed: the engine never removes the
//!   last of a message.
//!
//! A message that moved or went between the selection and its batch is
//! reported as missing and left alone. Text from a message appears nowhere
//! here: ids and counts only.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use afd::{Clock, CommandError};
use serde_json::{Value, json};

use crate::commands::{provider_failure, store_failure};
use crate::engine::Engine;
use crate::provider::{Provider, ProviderError};
use crate::store::{
    AccountId, AccountRow, Action, ItemStep, MailboxRow, OperationItem, OperationRow,
    OperationState, Step, StepCounts, StoreError, flags_after,
};

/// How operations size their work.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeOptions {
    /// Messages in one batch: one request of each kind to the provider.
    pub batch: usize,
    /// The most messages a change runs inside a call to a running server;
    /// a person's larger one is the server's work (9.1). What a call can
    /// finish, by the policy's own bound (9.4).
    pub inline_most: u64,
    /// Batches the server's work runs of one operation before it lets a
    /// pass of sync, or another operation, go first.
    pub slice: usize,
}

impl Default for ChangeOptions {
    fn default() -> Self {
        Self {
            batch: 100,
            inline_most: u64::from(crate::store::MOST_PER_CALL),
            slice: 20,
        }
    }
}

/// When a run gives the operation back before its end.
#[derive(Debug, Clone, Default)]
pub(crate) struct Until {
    /// After this, the run stops between batches and hands the rest to the
    /// server's work.
    pub deadline: Option<Instant>,
    /// After this many batches, the same.
    pub batches: Option<usize>,
    /// Set when the person presses Ctrl-C: the run stops after the batch in
    /// hand.
    pub interrupt: Option<Arc<AtomicBool>>,
}

/// How a run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Ran {
    /// The operation reached an end or stopped; its row says which.
    Ended,
    /// It gave the rest back, still running, as `Until` asked.
    GaveBack,
}

/// Marks an operation as running in this process while it lives. Dropped
/// before the run ends, as when a call is cut off, it marks the operation
/// as stopped, so that it can be resumed.
struct Operating<'a> {
    engine: &'a Engine,
    id: i64,
    /// Whether the run handed the operation on, still running.
    handed_on: bool,
}

impl Drop for Operating<'_> {
    fn drop(&mut self) {
        self.engine.end_operating(self.id);
        if !self.handed_on {
            let now = wall_clock();
            let _ = self.engine.with_store(|store| {
                if store
                    .operation(self.id)?
                    .is_some_and(|row| row.state == OperationState::Running)
                {
                    store.set_operation_state(
                        self.id,
                        OperationState::Stopped,
                        Some("it was stopped before its end"),
                        now,
                    )?;
                }
                Ok(())
            });
        }
    }
}

fn wall_clock() -> i64 {
    afd::SystemClock.now()
}

/// Why a batch stopped.
enum Failure {
    Provider(ProviderError),
    Store(StoreError),
}

impl From<ProviderError> for Failure {
    fn from(error: ProviderError) -> Self {
        Self::Provider(error)
    }
}

impl From<StoreError> for Failure {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

/// Normalizes an operation's stored `asked` JSON for display and digesting
/// (plugin.spec.md, sections 6 and 7): ensures `mail-archive` carries `copy`
/// derived from the stored action for both new and existing rows.
#[must_use]
pub fn normalized_asked(row: &OperationRow) -> Value {
    let mut asked = serde_json::from_str::<Value>(&row.asked).unwrap_or(Value::Null);
    if row.command == "mail-archive"
        && let Some(obj) = asked.as_object_mut()
        && !obj.contains_key("copy")
    {
        obj.insert("copy".to_string(), json!(row.action == Action::Copy));
    }
    asked
}

/// An operation and its counts as a result gives them: ids, counts and the
/// engine's words.
#[must_use]
pub fn operation_json(
    row: &OperationRow,
    counts: &StepCounts,
    tokens: &[crate::store::TokenRow],
) -> Value {
    json!({
        "operation": row.id,
        "command": row.command,
        "state": row.state.as_str(),
        "asked": normalized_asked(row),
        "selection": row.selection,
        // The query the selection was made with, as its caller wrote it.
        // Mail may have steered its words, so it is labelled as content
        // (12.1) for whoever reads it after.
        "query": row
            .query
            .as_deref()
            .and_then(|query| serde_json::from_str::<Value>(query).ok())
            .map(|query| json!({ "trust": "content", "written": query })),
        "undoOf": row.undo_of,
        "undoneBy": row.undone_by,
        "creator": crate::screening::proposer_json(&row.creator, tokens),
        // The proposal open now, or the last one: who proposed it, and
        // until when it waits for the person (9.4).
        "proposal": row.proposal.as_ref().map(|proposal| json!({
            "proposer": crate::screening::proposer_json(&proposal.proposer, tokens),
            "generation": proposal.generation,
            "proposedAt": proposal.proposed_at,
            "expiresAt": proposal.expires_at,
            "approvedAt": proposal.approved_at,
        })),
        "startedAt": row.started_at,
        "createdAt": row.created_at,
        "endedAt": row.ended_at,
        "stopAsked": row.stop_asked,
        "error": row.error,
        "messages": row.messages,
        // Each message in each mailbox, as the operation acts on it.
        "places": counts.items(),
        "changed": counts.done,
        "unchanged": counts.unchanged,
        "missing": counts.missing,
        "ignored": counts.ignored,
        "waiting": counts.waiting,
    })
}

/// The operation's row and counts now, as a result.
///
/// # Errors
/// When the store refuses, or the operation is gone.
pub(crate) fn operation_now(engine: &Engine, id: i64) -> Result<Value, Box<CommandError>> {
    engine
        .with_store(|store| {
            let row = store
                .operation(id)?
                .ok_or(StoreError::NotFound("operation"))?;
            let counts = store.operation_counts(id)?;
            let tokens = store.tokens()?;
            Ok(operation_json(&row, &counts, &tokens))
        })
        .map_err(|error| Box::new(store_failure(&error)))
}

/// Runs operation `id` until it ends, stops, or `until` gives it back.
///
/// # Errors
/// A provider's or the store's failure, with the operation stopped; the
/// failure's details name it. An operation that runs already is
/// `WORK_RUNNING`.
pub(crate) async fn run(
    engine: &Engine,
    id: i64,
    clock: &dyn Clock,
    until: &Until,
) -> Result<Ran, Box<CommandError>> {
    if !engine.begin_operating(id) {
        return Err(Box::new(
            CommandError::new("WORK_RUNNING", format!("operation {id} runs already"))
                .with_suggestion("Wait for it: `mail-operation-show` reports how far it has come.")
                .with_retryable(true),
        ));
    }
    let mut guard = Operating {
        engine,
        id,
        handed_on: false,
    };
    let mut connections: HashMap<i64, Box<dyn Provider>> = HashMap::new();
    let ran = run_batches(engine, id, clock, until, &mut connections).await;
    for (_, mut provider) in connections {
        provider.close().await;
    }
    match ran {
        Ok(Ran::GaveBack) => {
            // Let go first, so that the server's work can take it up; in
            // between it is `running` in the store, which a resume or an
            // undo refuses.
            guard.handed_on = true;
            drop(guard);
            engine.work().ask_operation(id);
            Ok(Ran::GaveBack)
        }
        Ok(Ran::Ended) => Ok(Ran::Ended),
        Err(failure) => {
            let (error, words) = match &failure {
                Failure::Provider(error) => (provider_failure(error), error.to_string()),
                Failure::Store(error) => (store_failure(error), error.to_string()),
            };
            let now = clock.now();
            let _ = engine.with_store(|store| {
                store.set_operation_state(id, OperationState::Stopped, Some(&words), now)
            });
            let mut details = HashMap::new();
            details.insert("operation".to_string(), json!(id));
            details.insert("state".to_string(), json!("stopped"));
            Err(Box::new(
                CommandError::new(error.code, error.message)
                    .with_suggestion(format!(
                        "Operation {id} stopped and can be resumed: `mail-operation-resume` with operation {id} carries on from the step each message reached."
                    ))
                    .with_retryable(error.retryable.unwrap_or(false))
                    .with_details(details),
            ))
        }
    }
}

/// One slice of an operation's batches, as the server's work runs it: its
/// row and counts after, `"state": "running"` when it waits for another.
///
/// # Errors
/// As [`run`].
pub(crate) async fn run_slice(
    engine: &Engine,
    id: i64,
    clock: &dyn Clock,
) -> Result<Value, Box<CommandError>> {
    let until = Until {
        batches: Some(engine.change_options().slice.max(1)),
        ..Until::default()
    };
    run(engine, id, clock, &until).await?;
    operation_now(engine, id)
}

/// The accounts, and each mailbox by its id with its account.
type Places = (Vec<AccountRow>, HashMap<i64, (AccountId, MailboxRow)>);

/// Where each mailbox is, by its id: its account and its row.
fn places(engine: &Engine) -> Result<Places, StoreError> {
    engine.with_store(|store| {
        let accounts = store.accounts()?;
        let mut mailboxes = HashMap::new();
        for account in &accounts {
            for mailbox in store.mailboxes(account.id)? {
                mailboxes.insert(mailbox.id.0, (account.id, mailbox));
            }
        }
        Ok((accounts, mailboxes))
    })
}

async fn run_batches(
    engine: &Engine,
    id: i64,
    clock: &dyn Clock,
    until: &Until,
    connections: &mut HashMap<i64, Box<dyn Provider>>,
) -> Result<Ran, Failure> {
    let (accounts, mailboxes) = places(engine)?;
    let mut ran = 0usize;
    let started = engine.with_store(|store| store.operation_counts(id))?;
    let (total, mut finished) = (started.items(), started.items() - started.waiting);
    loop {
        let Some(row) = engine.with_store(|store| store.operation(id))? else {
            return Ok(Ran::Ended);
        };
        if row.state != OperationState::Running {
            return Ok(Ran::Ended);
        }
        let interrupted = until
            .interrupt
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::SeqCst));
        if row.stop_asked || interrupted {
            let now = clock.now();
            engine.with_store(|store| {
                store.set_operation_state(id, OperationState::Stopped, None, now)
            })?;
            engine.report(&format!(
                "operation {id}: stopped after {finished} of {total} places"
            ));
            return Ok(Ran::Ended);
        }
        let out_of_time = until
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline);
        let out_of_batches = until.batches.is_some_and(|most| ran >= most);
        if out_of_time || out_of_batches {
            return Ok(Ran::GaveBack);
        }
        let batch_size = u32::try_from(engine.change_options().batch.max(1)).unwrap_or(u32::MAX);
        let batch = engine.with_store(|store| store.operation_batch(id, batch_size))?;
        let Some(first) = batch.first() else {
            let now = clock.now();
            engine.with_store(|store| {
                store.set_operation_state(id, OperationState::Done, None, now)
            })?;
            engine.report(&format!("operation {id}: done, {total} places"));
            return Ok(Ran::Ended);
        };
        let now = clock.now();
        let Some((account, source)) = mailboxes.get(&first.mailbox).cloned() else {
            // The mailbox is gone from the store: nothing there to act on.
            record(engine, id, first, &all(&batch, Step::Missing), now)?;
            finished += batch.len() as u64;
            continue;
        };
        let target = first
            .to_mailbox
            .and_then(|to| mailboxes.get(&to))
            .map(|(_, row)| row.clone());
        if source.gone || (first.to_mailbox.is_some() && target.as_ref().is_none_or(|row| row.gone))
        {
            record(engine, id, first, &all(&batch, Step::Missing), now)?;
            finished += batch.len() as u64;
            continue;
        }
        let provider = match connections.entry(account.0) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                let Some(connector) = engine.connector() else {
                    return Err(Failure::Provider(ProviderError::Unavailable(
                        "this build of the engine cannot reach a provider",
                    )));
                };
                let Some(account_row) = accounts.iter().find(|row| row.id == account) else {
                    record(engine, id, first, &all(&batch, Step::Missing), now)?;
                    finished += batch.len() as u64;
                    continue;
                };
                entry.insert(connector.connect(account_row).await?)
            }
        };
        let batch_run = Batch {
            engine,
            id,
            clock,
            source: &source,
            target: target.as_ref(),
            items: &batch,
        };
        let outcome = match row.action {
            Action::Flags => batch_run.flags(provider.as_mut()).await,
            Action::Move | Action::Copy => batch_run.copy(provider.as_mut(), row.action).await,
            Action::Remove => batch_run.remove(provider.as_mut()).await,
        };
        if let Err(failure) = outcome {
            // A connection that failed is not used again.
            if let Some(mut provider) = connections.remove(&account.0) {
                provider.close().await;
            }
            return Err(failure);
        }
        let counts = engine.with_store(|store| store.operation_counts(id))?;
        finished = counts.items() - counts.waiting;
        ran += 1;
        engine.report(&format!("operation {id}: {finished} of {total} places"));
        // Where a server stops its work, between two batches.
        tokio::task::yield_now().await;
    }
}

/// Every item of `batch` at `step`.
fn all(batch: &[OperationItem], step: Step) -> Vec<ItemStep> {
    batch
        .iter()
        .map(|item| ItemStep::only(&item.provider_id, step))
        .collect()
}

fn record(
    engine: &Engine,
    id: i64,
    first: &OperationItem,
    steps: &[ItemStep],
    now: i64,
) -> Result<(), StoreError> {
    engine.with_store(|store| store.record_steps(id, first.mailbox, &first.validity, steps, now))
}

/// One batch: items of one mailbox going to one place.
struct Batch<'a> {
    engine: &'a Engine,
    id: i64,
    clock: &'a dyn Clock,
    source: &'a MailboxRow,
    target: Option<&'a MailboxRow>,
    items: &'a [OperationItem],
}

impl Batch<'_> {
    fn record(&self, steps: &[ItemStep]) -> Result<(), StoreError> {
        let now = self.clock.now();
        self.engine.with_store(|store| {
            store.record_steps(
                self.id,
                self.source.id.0,
                &self.items[0].validity,
                steps,
                now,
            )
        })
    }

    /// The items, keyed by their ids, at the steps the batch has reached.
    fn steps(&self) -> HashMap<String, OperationItem> {
        self.items
            .iter()
            .map(|item| (item.provider_id.clone(), item.clone()))
            .collect()
    }

    /// Opens the batch's mailbox to change it. `false`, with every item that
    /// is not at its end recorded as missing, when the mailbox's generation
    /// is no longer the items': their ids name nothing now.
    async fn open_source(
        &self,
        provider: &mut dyn Provider,
        items: &HashMap<String, OperationItem>,
    ) -> Result<bool, Failure> {
        let opened = provider.open_to_change(&self.source.provider_key).await?;
        if opened.validity == self.items[0].validity {
            return Ok(true);
        }
        let steps: Vec<ItemStep> = items
            .values()
            .filter(|item| !item.step.finished())
            .map(|item| ItemStep::only(&item.provider_id, Step::Missing))
            .collect();
        self.record(&steps)?;
        Ok(false)
    }

    /// Sets or clears flags.
    async fn flags(&self, provider: &mut dyn Provider) -> Result<(), Failure> {
        let items = self.steps();
        if !self.open_source(provider, &items).await? {
            return Ok(());
        }
        let ids: Vec<String> = sorted_ids(items.keys());
        let seen: HashMap<String, Vec<String>> = provider
            .flags_of(&ids)
            .await?
            .into_iter()
            .map(|seen| (seen.provider_id, seen.flags))
            .collect();
        let mut steps = Vec::new();
        // Each flag to set or clear, and the ids it goes on.
        let mut wanted: HashMap<(String, bool), Vec<String>> = HashMap::new();
        for id in &ids {
            let item = &items[id];
            let Some(now) = seen.get(id) else {
                steps.push(ItemStep::only(id, Step::Missing));
                continue;
            };
            let target = item.flags_wanted.as_deref().unwrap_or("{}");
            let after = flags_after(now, target);
            let sorted_now = normalized(now);
            // Asked before, and its answer not read: the flags it had then
            // are its flags before, whatever part of the change was made.
            let before = match (&item.step, &item.flags_before) {
                (Step::Copying, Some(before)) => before.clone(),
                _ => now.clone(),
            };
            if item.step == Step::Copying
                && sorted_now == flags_after(&before, target)
                && sorted_now != normalized(&before)
            {
                steps.push(ItemStep {
                    flags_before: Some(before),
                    ..ItemStep::only(id, Step::Done)
                });
                continue;
            }
            if sorted_now == after {
                steps.push(ItemStep {
                    flags_before: Some(before),
                    ..ItemStep::only(id, Step::Unchanged)
                });
                continue;
            }
            let wanted_flags: serde_json::Map<String, Value> =
                serde_json::from_str(target).unwrap_or_default();
            for (flag, on) in wanted_flags {
                let on = on.as_bool() == Some(true);
                if sorted_now.contains(&flag) != on {
                    wanted.entry((flag, on)).or_default().push(id.clone());
                }
            }
            steps.push(ItemStep {
                flags_before: Some(before),
                ..ItemStep::only(id, Step::Copying)
            });
        }
        // The flags before, recorded before the change is asked for.
        let asking: Vec<ItemStep> = steps
            .iter()
            .filter(|step| step.step == Step::Copying)
            .cloned()
            .collect();
        let settled: Vec<ItemStep> = steps
            .iter()
            .filter(|step| step.step != Step::Copying)
            .cloned()
            .collect();
        self.record(&settled)?;
        self.record(&asking)?;
        let mut order: Vec<_> = wanted.into_iter().collect();
        order.sort();
        for ((flag, on), ids) in order {
            provider.set_flags(&ids, &[flag.as_str()], on).await?;
        }
        let done: Vec<ItemStep> = asking
            .into_iter()
            .map(|step| ItemStep {
                step: Step::Done,
                ..step
            })
            .collect();
        self.record(&done)?;
        Ok(())
    }

    /// Copies or moves to the batch's target.
    async fn copy(&self, provider: &mut dyn Provider, action: Action) -> Result<(), Failure> {
        let Some(target) = self.target else {
            self.record(&all(self.items, Step::Missing))?;
            return Ok(());
        };
        let mut items = self.steps();
        let one_step = action == Action::Move && provider.moves();
        // A copy asked for whose answer was lost is found first.
        let lost: Vec<OperationItem> = items
            .values()
            .filter(|item| item.step == Step::Copying)
            .cloned()
            .collect();
        if !lost.is_empty() {
            let found = self.find_copies(provider, target, &lost).await?;
            let mut steps = Vec::new();
            for item in &lost {
                let step = match found.get(&item.provider_id) {
                    Some(copy) => ItemStep {
                        to_provider_id: Some(copy.clone()),
                        ..ItemStep::only(
                            &item.provider_id,
                            if one_step || action == Action::Copy {
                                Step::Done
                            } else {
                                Step::Copied
                            },
                        )
                    },
                    None => ItemStep::only(&item.provider_id, Step::Waiting),
                };
                steps.push(step);
            }
            self.record(&steps)?;
            for step in steps {
                if let Some(item) = items.get_mut(&step.provider_id) {
                    item.step = step.step;
                    if step.to_provider_id.is_some() {
                        item.to_provider_id = step.to_provider_id;
                    }
                }
            }
        }
        if !self.open_source(provider, &items).await? {
            return Ok(());
        }
        let waiting = sorted_ids(
            items
                .values()
                .filter(|item| item.step == Step::Waiting)
                .map(|item| &item.provider_id),
        );
        if !waiting.is_empty() {
            let present: HashSet<String> = provider.present(&waiting).await?.into_iter().collect();
            let flags: HashMap<String, Vec<String>> = provider
                .flags_of(&waiting)
                .await?
                .into_iter()
                .map(|seen| (seen.provider_id, seen.flags))
                .collect();
            let mut missing = Vec::new();
            let mut asking = Vec::new();
            let next = provider.next_id(&target.provider_key).await?;
            for id in &waiting {
                if present.contains(id) {
                    asking.push(ItemStep {
                        flags_before: flags.get(id).cloned(),
                        to_validity: Some(next.validity.clone()),
                        to_mark: Some(next.next.clone()),
                        ..ItemStep::only(id, Step::Copying)
                    });
                } else {
                    missing.push(ItemStep::only(id, Step::Missing));
                }
            }
            self.record(&missing)?;
            // The mark is recorded before the copy is asked for.
            self.record(&asking)?;
            let ids: Vec<String> = asking.iter().map(|step| step.provider_id.clone()).collect();
            let copied = if one_step {
                provider.move_to(&ids, &target.provider_key).await?
            } else {
                provider.copy(&ids, &target.provider_key).await?
            };
            let went: HashMap<String, String> = copied.ids.into_iter().collect();
            let reached = if one_step || action == Action::Copy {
                Step::Done
            } else {
                Step::Copied
            };
            let mut steps: Vec<ItemStep> = ids
                .iter()
                .map(|id| match went.get(id) {
                    Some(to) => ItemStep {
                        to_validity: Some(copied.validity.clone()),
                        to_provider_id: Some(to.clone()),
                        ..ItemStep::only(id, reached)
                    },
                    None => ItemStep::only(id, Step::Ignored),
                })
                .collect();
            if one_step {
                // A move the server answered without naming where each
                // message went may still have moved them: one no longer in
                // its mailbox moved, and is looked for where it went.
                let unnamed: Vec<String> = ids
                    .iter()
                    .filter(|id| !went.contains_key(*id))
                    .cloned()
                    .collect();
                let still: HashSet<String> = if unnamed.is_empty() {
                    HashSet::new()
                } else {
                    provider.present(&unnamed).await?.into_iter().collect()
                };
                let moved: Vec<OperationItem> = unnamed
                    .iter()
                    .filter(|id| !still.contains(*id))
                    .filter_map(|id| items.get(id).cloned())
                    .map(|item| OperationItem {
                        to_validity: Some(next.validity.clone()),
                        to_mark: Some(next.next.clone()),
                        ..item
                    })
                    .collect();
                if !moved.is_empty() {
                    let found = self.find_copies(provider, target, &moved).await?;
                    for step in &mut steps {
                        if moved
                            .iter()
                            .any(|item| item.provider_id == step.provider_id)
                        {
                            step.step = Step::Done;
                            step.to_validity = Some(next.validity.clone());
                            step.to_provider_id = found.get(&step.provider_id).cloned();
                        }
                    }
                    // Looking opened the target: the source is opened again.
                    self.open_source(provider, &items).await?;
                }
            }
            self.record(&steps)?;
            for step in steps {
                if let Some(item) = items.get_mut(&step.provider_id) {
                    item.step = step.step;
                }
            }
        }
        if action == Action::Move {
            self.finish_move(provider, &items).await?;
        }
        Ok(())
    }

    /// The delete flag on each original whose copy was confirmed, then the
    /// removal of exactly those.
    async fn finish_move(
        &self,
        provider: &mut dyn Provider,
        items: &HashMap<String, OperationItem>,
    ) -> Result<(), Failure> {
        let copied = sorted_ids(
            items
                .values()
                .filter(|item| item.step == Step::Copied)
                .map(|item| &item.provider_id),
        );
        if !copied.is_empty() {
            provider.set_flags(&copied, &["\\Deleted"], true).await?;
            self.record(
                &copied
                    .iter()
                    .map(|id| ItemStep::only(id, Step::Flagged))
                    .collect::<Vec<_>>(),
            )?;
        }
        let flagged: Vec<String> = sorted_ids(
            items
                .values()
                .filter(|item| matches!(item.step, Step::Copied | Step::Flagged))
                .map(|item| &item.provider_id),
        );
        if !flagged.is_empty() {
            provider.remove(&flagged).await?;
            self.record(
                &flagged
                    .iter()
                    .map(|id| ItemStep::only(id, Step::Done))
                    .collect::<Vec<_>>(),
            )?;
        }
        Ok(())
    }

    /// Where copies asked for, and whose answer was lost, went: by each
    /// message's identity among the ids the target gave from the mark. A
    /// message the provider never returned has no identity, and its copy is
    /// never guessed at: another such message's copy could be taken for it
    /// and the original removed with no copy made. It is asked for again,
    /// which at worst leaves two copies.
    async fn find_copies(
        &self,
        provider: &mut dyn Provider,
        target: &MailboxRow,
        lost: &[OperationItem],
    ) -> Result<HashMap<String, String>, Failure> {
        let mut found = HashMap::new();
        let opened = provider.open(&target.provider_key).await?;
        let Some(mark) = lost
            .iter()
            .filter(|item| item.to_validity.as_deref() == Some(opened.validity.as_str()))
            .filter_map(|item| item.to_mark.as_deref())
            .filter_map(|mark| mark.parse::<u64>().ok())
            .min()
        else {
            // The target's generation changed: its ids from then name
            // nothing now, and the copy is asked for again.
            return Ok(found);
        };
        let new_ids = provider.ids_from(&mark.to_string()).await?;
        if new_ids.is_empty() {
            return Ok(found);
        }
        let headers = provider.headers(&new_ids).await?;
        let identities: Vec<(String, Option<i64>)> = self.engine.with_store(|store| {
            headers
                .iter()
                .map(|seen| {
                    Ok((
                        seen.provider_id.clone(),
                        store
                            .find_message(&seen.header_block, seen.reported_size)?
                            .map(|message| message.0),
                    ))
                })
                .collect::<Result<_, StoreError>>()
        })?;
        let mut by_message: HashMap<i64, Vec<String>> = HashMap::new();
        for (id, message) in identities {
            if let Some(message) = message {
                by_message.entry(message).or_default().push(id);
            }
        }
        for list in by_message.values_mut() {
            list.sort_by_key(|id| id.parse::<u64>().unwrap_or(u64::MAX));
            list.reverse();
        }
        for item in lost {
            if let Some(message) = item.message
                && let Some(copy) = by_message.get_mut(&message).and_then(Vec::pop)
            {
                found.insert(item.provider_id.clone(), copy);
            }
        }
        Ok(found)
    }

    /// Removes copies an undo takes back, each only while the message it was
    /// copied from is still there.
    async fn remove(&self, provider: &mut dyn Provider) -> Result<(), Failure> {
        let Some(original) = self.target else {
            self.record(&all(self.items, Step::Missing))?;
            return Ok(());
        };
        let mut items = self.steps();
        // Before a copy is flagged, and again before a flagged one is
        // removed, the message it was copied from must still be where it
        // was, and not flagged to be deleted itself.
        let checking: Vec<OperationItem> = items
            .values()
            .filter(|item| matches!(item.step, Step::Waiting | Step::Flagged))
            .cloned()
            .collect();
        let mut alone: Vec<OperationItem> = Vec::new();
        if !checking.is_empty() {
            let opened = provider.open(&original.provider_key).await?;
            let same = |item: &OperationItem| {
                item.to_validity.as_deref() == Some(opened.validity.as_str())
            };
            let originals: Vec<String> = checking
                .iter()
                .filter(|item| same(item))
                .filter_map(|item| item.to_provider_id.clone())
                .collect();
            // An original is there only when the provider returns it, not
            // flagged to be deleted: a listing is not enough, since iCloud's
            // search still lists messages that went, and the copy would then
            // be the last of its message.
            let there: HashSet<String> = provider
                .flags_of(&originals)
                .await?
                .into_iter()
                .filter(|seen| !seen.flags.iter().any(|flag| flag == "\\Deleted"))
                .map(|seen| seen.provider_id)
                .collect();
            alone = checking
                .into_iter()
                .filter(|item| {
                    !(same(item)
                        && item
                            .to_provider_id
                            .as_ref()
                            .is_some_and(|id| there.contains(id)))
                })
                .collect();
        }
        if !self.open_source(provider, &items).await? {
            return Ok(());
        }
        if !alone.is_empty() {
            // A copy whose original is gone is the last of its message, and
            // stays: one this undo had flagged loses the flag again.
            let flagged: Vec<String> = sorted_ids(
                alone
                    .iter()
                    .filter(|item| item.step == Step::Flagged)
                    .map(|item| &item.provider_id),
            );
            provider.set_flags(&flagged, &["\\Deleted"], false).await?;
            let steps: Vec<ItemStep> = alone
                .iter()
                .map(|item| ItemStep::only(&item.provider_id, Step::Missing))
                .collect();
            self.record(&steps)?;
            for item in &alone {
                items.remove(&item.provider_id);
            }
        }
        let asked = sorted_ids(
            items
                .values()
                .filter(|item| item.step == Step::Waiting)
                .map(|item| &item.provider_id),
        );
        if !asked.is_empty() {
            let present: HashSet<String> = provider.present(&asked).await?.into_iter().collect();
            let flags: HashMap<String, Vec<String>> = provider
                .flags_of(&asked)
                .await?
                .into_iter()
                .map(|seen| (seen.provider_id, seen.flags))
                .collect();
            let (here, away): (Vec<String>, Vec<String>) =
                asked.into_iter().partition(|id| present.contains(id));
            let away: Vec<ItemStep> = away
                .iter()
                .map(|id| ItemStep::only(id, Step::Missing))
                .collect();
            self.record(&away)?;
            for step in away {
                items.remove(&step.provider_id);
            }
            if !here.is_empty() {
                provider.set_flags(&here, &["\\Deleted"], true).await?;
                self.record(
                    &here
                        .iter()
                        .map(|id| ItemStep {
                            flags_before: flags.get(id).cloned(),
                            ..ItemStep::only(id, Step::Flagged)
                        })
                        .collect::<Vec<_>>(),
                )?;
                for id in &here {
                    if let Some(item) = items.get_mut(id) {
                        item.step = Step::Flagged;
                    }
                }
            }
        }
        let flagged = sorted_ids(
            items
                .values()
                .filter(|item| item.step == Step::Flagged)
                .map(|item| &item.provider_id),
        );
        if !flagged.is_empty() {
            provider.remove(&flagged).await?;
            self.record(
                &flagged
                    .iter()
                    .map(|id| ItemStep::only(id, Step::Done))
                    .collect::<Vec<_>>(),
            )?;
        }
        Ok(())
    }
}

/// Flags sorted, each once.
fn normalized(flags: &[String]) -> Vec<String> {
    let mut sorted = flags.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    sorted
}

/// Ids in the order the provider numbers them.
fn sorted_ids<'a>(ids: impl Iterator<Item = &'a String>) -> Vec<String> {
    let mut ids: Vec<String> = ids.cloned().collect();
    ids.sort_by_key(|id| (id.parse::<u64>().unwrap_or(u64::MAX), id.clone()));
    ids.dedup();
    ids
}
