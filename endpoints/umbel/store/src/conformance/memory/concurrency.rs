//! Group `memory_concurrency`: two threads, then two processes, 200 interleaved writes and a
//! reader: revisions are dense and every writer reads its own writes.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write as _;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};

use super::{ADA, MemoryEnv, P_ADA, T0, ada, get_at, write};
use crate::conformance::child::{ENV_COUNT, ENV_ID, ENV_KIND, KIND_MEMORY, WROTE_PREFIX};
use crate::conformance::{CaseResult, Ctx, ensure, ensure_eq, pass, samples, skip};

pub(super) const CASES: &[(&str, super::MemoryCaseFn)] = &[
    ("two_threads_write_densely_and_read_their_writes", threads),
    ("two_processes_write_densely", processes),
];

const PER_WRITER: u64 = 100;

fn threads(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    // Provision first, so the reader never meets an unprovisioned store.
    write(
        m,
        T0,
        vec![samples::memory_entry(
            1,
            ADA,
            &[P_ADA],
            "first",
            "provisions",
        )],
    )?;
    let done = AtomicBool::new(false);
    let result: Result<(), String> = std::thread::scope(|scope| {
        let reader = scope.spawn(|| -> Result<(), String> {
            let mut after = 0;
            loop {
                let finished = done.load(Ordering::SeqCst);
                for change in m.changes(after, 1000, &ada(), None).ctx("changes")? {
                    ensure_eq(change.rev, after + 1, "revisions come out dense")?;
                    after = change.rev;
                    ensure(
                        get_at(m, &change.id, T0, &ada())?.is_some(),
                        "a visible change has its record",
                    )?;
                }
                if finished && m.head().ctx("head")? == after {
                    return Ok(());
                }
            }
        });
        let writers: Vec<_> = [1000_u64, 2000]
            .into_iter()
            .map(|base| {
                scope.spawn(move || -> Result<Vec<u64>, String> {
                    let mut revs = Vec::new();
                    for n in 0..PER_WRITER {
                        let entry = samples::memory_entry(
                            base + n,
                            ADA,
                            &[P_ADA],
                            &format!("thread {base}"),
                            &format!("write {n} of thread {base}"),
                        );
                        let receipt = write(m, T0, vec![entry])?;
                        revs.push(receipt.to_rev.ok_or("no revision")?);
                        ensure(
                            get_at(m, &samples::memory_id(base + n), T0, &ada())?.is_some(),
                            "a writer reads its own write",
                        )?;
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
            all.into_iter().collect::<Vec<_>>(),
            (2..=PER_WRITER * 2 + 1).collect::<Vec<_>>(),
            "revisions are dense and distinct",
        )
    });
    result?;
    ensure_eq(m.head().ctx("head")?, PER_WRITER * 2 + 1, "head")?;
    pass()
}

fn processes(env: &MemoryEnv<'_>) -> CaseResult {
    let Some(spawn) = env.spawn_writer else {
        return skip("the backend supplied no spawn_writer");
    };
    let f = env.fresh()?;
    let m = &*f.memory;
    write(
        m,
        T0,
        vec![samples::memory_entry(
            1,
            ADA,
            &[P_ADA],
            "first",
            "provisions",
        )],
    )?;
    let mut children = Vec::new();
    for name in ["a", "b"] {
        let mut command = spawn(f.dir.path());
        command
            .env(ENV_ID, name)
            .env(ENV_COUNT, PER_WRITER.to_string())
            .env(ENV_KIND, KIND_MEMORY)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        children.push(
            command
                .spawn()
                .map_err(|e| format!("spawning a writer: {e}"))?,
        );
    }
    for child in &mut children {
        let mut stdin = child.stdin.take().ok_or("a child's stdin")?;
        writeln!(stdin, "start").map_err(|e| format!("starting a writer: {e}"))?;
    }
    let mut wrote: BTreeMap<u64, String> = BTreeMap::new();
    for child in children {
        let output = child
            .wait_with_output()
            .map_err(|e| format!("waiting for a writer: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        if !output.status.success() {
            return Err(format!(
                "a writer failed: {}\n{stdout}\n{}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        for line in stdout.lines().filter_map(|l| l.strip_prefix(WROTE_PREFIX)) {
            let mut parts = line.split_whitespace();
            let rev: u64 = parts
                .next()
                .and_then(|r| r.parse().ok())
                .ok_or("a WROTE line's revision")?;
            let id = parts.next().ok_or("a WROTE line's id")?;
            if wrote.insert(rev, id.to_owned()).is_some() {
                return Err(format!("revision {rev} was taken twice"));
            }
        }
    }
    ensure_eq(
        wrote.keys().copied().collect::<Vec<_>>(),
        (2..=PER_WRITER * 2 + 1).collect::<Vec<_>>(),
        "revisions are dense across processes",
    )?;
    for id in wrote.values() {
        ensure(
            get_at(m, id, T0, &ada())?.is_some(),
            "every write is readable",
        )?;
    }
    pass()
}
