//! Group `concurrency`: several writers in threads and in processes share one revision sequence
//! with no gap, no duplicate and no lost write; graph `applied` never goes down.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};

use super::child::{ENV_COUNT, ENV_ID, WROTE_PREFIX};
use super::{CaseResult, Ctx, Env, ensure, ensure_eq, everyone, pass, samples, skip};
use crate::{ChangeKind, DocGraph, Expect, GraphBatch, Node, ReaderFilter, StoreError};

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    (
        "two_threads_write_densely_and_a_reader_sees_whole_commits",
        threads,
    ),
    ("two_processes_write_densely", processes),
    ("graph_applied_never_lowers_under_contention", graph_applied),
    ("two_index_writer_sessions_take_turns", index_writers),
];

const PER_WRITER: usize = 100;

/// What one graph-writing thread saw: each `applied` it tried and how the store answered.
type Attempts = Result<Vec<(u64, Result<(), StoreError>)>, String>;

fn threads(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    let d = &*f.stores.documents;
    let done = AtomicBool::new(false);
    let reads: Result<(), String> = std::thread::scope(|scope| {
        let reader = scope.spawn(|| -> Result<(), String> {
            // Whole commits: a change is never visible without its document, and revisions come
            // out dense, however the writers interleave.
            let derivation = ReaderFilter::derivation();
            let mut after = 0;
            loop {
                let finished = done.load(Ordering::SeqCst);
                for change in d.changes(after, 1000, &derivation, None).ctx("changes")? {
                    ensure_eq(change.rev, after + 1, "revisions come out dense")?;
                    after = change.rev;
                    ensure_eq(change.kind, ChangeKind::Put, "kind")?;
                    let doc = d
                        .get_document(&change.target, &derivation)
                        .ctx("get_document")?;
                    let doc = doc.ok_or_else(|| {
                        format!(
                            "revision {} is visible but `{}` is not",
                            change.rev, change.target
                        )
                    })?;
                    ensure_eq(
                        doc.rev,
                        change.rev,
                        "the document carries its change's revision",
                    )?;
                }
                if finished && d.head().ctx("head")? == after {
                    return Ok(());
                }
            }
        });
        let writers: Vec<_> = ["a", "b"]
            .iter()
            .map(|name| {
                scope.spawn(move || -> Result<Vec<u64>, String> {
                    let mut revs = Vec::new();
                    for n in 0..PER_WRITER {
                        let id = format!("{name}/doc-{n:03}");
                        let meta = d
                            .put_document(
                                samples::document(&id, &["space"], &id, "t"),
                                Expect::Absent,
                            )
                            .ctx("put_document")?;
                        revs.push(meta.rev);
                    }
                    Ok(revs)
                })
            })
            .collect();
        let mut all = BTreeSet::new();
        let mut failure = None;
        for writer in writers {
            match writer.join() {
                Ok(Ok(revs)) => all.extend(revs),
                Ok(Err(why)) => failure = Some(why),
                Err(_) => failure = Some("a writer thread panicked".to_owned()),
            }
        }
        done.store(true, Ordering::SeqCst);
        let read = reader
            .join()
            .map_err(|_| "the reader thread panicked".to_owned())?;
        if let Some(why) = failure {
            return Err(why);
        }
        read?;
        ensure_eq(
            all.len(),
            PER_WRITER * 2,
            "no two writes took the same revision",
        )?;
        ensure_eq(
            all.into_iter().collect::<Vec<_>>(),
            (1..=(PER_WRITER as u64 * 2)).collect::<Vec<_>>(),
            "revisions are dense",
        )
    });
    reads?;
    ensure_eq(d.head().ctx("head")?, PER_WRITER as u64 * 2, "head")?;
    for name in ["a", "b"] {
        let page = d
            .list_documents(
                &crate::ListQuery {
                    prefix: Some(format!("{name}/")),
                    ..crate::ListQuery::all(500)
                },
                &everyone(),
            )
            .ctx("list")?;
        ensure_eq(page.items.len(), PER_WRITER, "every write is readable")?;
    }
    pass()
}

fn processes(env: &Env<'_>) -> CaseResult {
    let Some(spawn) = env.spawn_writer else {
        return skip("the backend supplied no spawn_writer");
    };
    let f = env.fresh()?;
    let d = &*f.stores.documents;
    let mut children = Vec::new();
    for name in ["a", "b"] {
        let mut command = spawn(f.dir.path());
        command
            .env(ENV_ID, name)
            .env(ENV_COUNT, PER_WRITER.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        children.push(
            command
                .spawn()
                .map_err(|e| format!("spawning a writer child: {e}"))?,
        );
    }
    // The barrier: both children are up and waiting on this line before either writes.
    for child in &mut children {
        let mut stdin = child.stdin.take().ok_or("a child has no stdin")?;
        stdin
            .write_all(b"go\n")
            .map_err(|e| format!("starting a child: {e}"))?;
    }
    let mut seen: BTreeMap<u64, String> = BTreeMap::new();
    for child in children {
        let output = child
            .wait_with_output()
            .map_err(|e| format!("waiting for a child: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        if !output.status.success() {
            return Err(format!(
                "a writer child failed ({}):\n{stdout}\n{}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        for line in stdout.lines().filter_map(|l| l.strip_prefix(WROTE_PREFIX)) {
            let (rev, id) = line
                .trim()
                .split_once(' ')
                .ok_or("a malformed child line")?;
            let rev: u64 = rev
                .parse()
                .map_err(|e| format!("a child printed a bad revision: {e}"))?;
            ensure(
                seen.insert(rev, id.to_owned()).is_none(),
                &format!("two writes took revision {rev}"),
            )?;
        }
    }
    ensure_eq(
        seen.keys().copied().collect::<Vec<_>>(),
        (1..=(PER_WRITER as u64 * 2)).collect::<Vec<_>>(),
        "revisions are dense across processes",
    )?;
    ensure_eq(
        d.head().ctx("head")?,
        PER_WRITER as u64 * 2,
        "head, read by the parent",
    )?;
    for (rev, id) in &seen {
        let doc = d
            .get_document(id, &everyone())
            .ctx("get_document")?
            .ok_or_else(|| format!("`{id}` was written and is not readable"))?;
        ensure_eq(doc.rev, *rev, "the revision the child was told")?;
    }
    pass()
}

fn graph_applied(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    for n in 0..20 {
        f.stores
            .documents
            .put_document(
                samples::document(&format!("a/doc-{n:02}"), &["space"], "x", "t"),
                Expect::Any,
            )
            .ctx("put")?;
    }
    let g = &*f.stores.graph;
    let outcomes: Vec<Attempts> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..2u64)
            .map(|t| {
                scope.spawn(move || -> Attempts {
                    (0..10u64)
                        .map(|i| {
                            let applied = 1 + i * 2 + t;
                            let doc = format!("a/doc-{:02}", i * 2 + t);
                            let graph = DocGraph {
                                nodes: vec![Node {
                                    id: format!("doc:{doc}"),
                                    kind: "document".to_owned(),
                                    label: doc.clone(),
                                }],
                                edges: vec![],
                            };
                            Ok((
                                applied,
                                g.apply(
                                    GraphBatch {
                                        entries: vec![(doc, Some(graph))],
                                    },
                                    applied,
                                ),
                            ))
                        })
                        .collect()
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| {
                h.join()
                    .unwrap_or_else(|_| Err("a thread panicked".to_owned()))
            })
            .collect()
    });
    let mut highest = 0;
    let mut written = BTreeSet::new();
    for outcome in outcomes {
        for (applied, result) in outcome? {
            match result {
                Ok(()) => {
                    highest = highest.max(applied);
                    written.insert(applied);
                }
                Err(StoreError::Conflict { current: Some(c) }) => {
                    let current: u64 = c
                        .parse()
                        .map_err(|e| format!("a non-numeric current: {e}"))?;
                    ensure(current > applied, "a conflict names a higher revision")?;
                    highest = highest.max(current);
                }
                Err(other) => return Err(format!("apply failed oddly: {other}")),
            }
        }
    }
    ensure_eq(
        g.applied().ctx("applied")?,
        highest,
        "applied is the highest ever accepted",
    )?;
    let nodes = g
        .subgraph(&ReaderFilter::derivation())
        .ctx("subgraph")?
        .nodes;
    ensure_eq(
        nodes.len(),
        written.len(),
        "every accepted apply left its contribution",
    )?;
    // Whatever the interleaving was, the contended store still refuses to go back.
    let lower = GraphBatch::default();
    ensure(
        matches!(
            g.apply(lower, highest - 1),
            Err(StoreError::Conflict { .. })
        ),
        "after the contention, a lower revision is still refused",
    )?;
    ensure_eq(
        g.applied().ctx("applied")?,
        highest,
        "and applied did not move",
    )?;
    pass()
}

fn index_writers(env: &Env<'_>) -> CaseResult {
    let f = env.fresh()?;
    let Some(index) = f.stores.index.clone() else {
        return skip("this backend has no search index");
    };
    let first = index.writer().ctx("the first writer")?;
    let released = AtomicBool::new(false);
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let outcome = std::thread::scope(|scope| -> Result<(), String> {
        let second = scope.spawn(|| {
            let _ = started_tx.send(());
            let result = index.writer();
            // Read after the answer: a writer granted while the first was held saw `false`.
            let after_release = released.load(Ordering::SeqCst);
            (result.map(drop), after_release)
        });
        started_rx
            .recv()
            .map_err(|_| "the second writer never started".to_owned())?;
        std::thread::sleep(std::time::Duration::from_millis(150));
        released.store(true, Ordering::SeqCst);
        let mut first = first;
        first.commit(1).ctx("the first writer's commit")?;
        let (second, after_release) = second
            .join()
            .map_err(|_| "the second writer's thread panicked".to_owned())?;
        match second {
            Ok(()) => ensure(
                after_release,
                "a second writer was granted while the first still held the index",
            ),
            Err(StoreError::Busy) => Ok(()),
            Err(other) => Err(format!("the second writer failed oddly: {other}")),
        }
    });
    outcome?;
    // Committing, aborting and dropping each release the writer.
    let mut next = index.writer().ctx("a writer after a commit")?;
    ensure_eq(
        next.applied().ctx("applied")?,
        1,
        "the next writer reads the revision",
    )?;
    next.abort();
    let again = index.writer().ctx("a writer after an abort")?;
    drop(again);
    let mut last = index.writer().ctx("a writer after a drop")?;
    ensure(
        matches!(last.commit(0), Err(StoreError::Conflict { .. })),
        "the second writer, holding the index in turn, still cannot lower its revision",
    )?;
    pass()
}
