//! Pipeline attestation (phase 4 specification, section 10.1, D91).
//!
//! A pipeline's handler runs each step under a **fresh random trace id** of its own, in place of
//! AFD's predictable `<pipeline id>-step-<i>`, and records the step here, keyed by that trace id:
//! the plugin and instance that ship the pipeline, the pipeline, the run (the pipeline call's
//! trace id) and the step's command. The entry lives exactly as long as the step: the
//! [`StepGuard`] that holds it removes it when the step returns, fails, panics or is cancelled.
//!
//! [`CallServices::pipeline`](super::CallServices::pipeline), which fills the SDK's
//! `CallContext.pipeline`, reads it only for the call's own trace id and only when the entry
//! names the command being called. **Nothing is read from `extra`** or from anything else a call
//! carries, so no surface forges it: MCP and the CLI make their own trace ids, `umbel batch`,
//! `afd-batch`, `afd-call` and `afd-pipe` derive theirs from those, and none of them can write
//! this table or know a 128-bit trace id the host drew for a step that is running. A library
//! embedder, which chooses its own trace ids and runs in the host's process, is trusted, as it
//! already is for actors (D14).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use umbel_sdk::PipelineAttestation;

/// How many fresh trace ids a step draws before giving up: one is enough unless the operating
/// system's random source repeats itself.
const DRAWS: usize = 4;

/// The steps in flight, by their trace id.
#[derive(Debug, Default)]
pub(crate) struct PipelineAttestations {
    steps: Mutex<HashMap<String, Step>>,
}

#[derive(Debug)]
struct Step {
    attestation: PipelineAttestation,
    /// The command the step runs: a call of any other command under this trace id gets nothing.
    command: String,
}

impl PipelineAttestations {
    /// Record a step that runs `command` for `attestation`, under a fresh random trace id that
    /// no other step in flight holds. `None` when the operating system's random source fails:
    /// the step must not run, since a trace id drawn from the clock could be guessed.
    pub(crate) fn begin(
        self: &Arc<Self>,
        attestation: PipelineAttestation,
        command: &str,
    ) -> Option<StepGuard> {
        let mut steps = self.steps.lock().unwrap_or_else(PoisonError::into_inner);
        for _ in 0..DRAWS {
            let trace = crate::host::random_trace_id()?;
            if steps.contains_key(&trace) {
                continue;
            }
            steps.insert(
                trace.clone(),
                Step {
                    attestation,
                    command: command.to_owned(),
                },
            );
            return Some(StepGuard {
                table: Arc::clone(self),
                trace,
            });
        }
        None
    }

    /// The attestation of the step running `command` under `trace`, if one is in flight.
    pub(crate) fn lookup(&self, trace: &str, command: &str) -> Option<PipelineAttestation> {
        let steps = self.steps.lock().unwrap_or_else(PoisonError::into_inner);
        steps
            .get(trace)
            .filter(|step| step.command == command)
            .map(|step| step.attestation.clone())
    }

    /// How many steps are in flight.
    #[cfg(test)]
    fn len(&self) -> usize {
        self.steps
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }
}

/// One step's entry in the table, removed when this is dropped.
#[derive(Debug)]
pub(crate) struct StepGuard {
    table: Arc<PipelineAttestations>,
    trace: String,
}

impl StepGuard {
    /// The step's trace id.
    pub(crate) fn trace(&self) -> &str {
        &self.trace
    }
}

impl Drop for StepGuard {
    fn drop(&mut self) {
        self.table
            .steps
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.trace);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attestation() -> PipelineAttestation {
        PipelineAttestation {
            plugin: "curator".into(),
            instance: "curator".into(),
            pipeline: "curator-run".into(),
            run: "r".into(),
        }
    }

    #[test]
    fn a_step_is_attested_for_its_own_command_until_it_is_dropped() {
        let table = Arc::new(PipelineAttestations::default());
        let guard = table.begin(attestation(), "knowledge-propose-batch");
        let Some(guard) = guard else {
            panic!("the random source failed");
        };
        let trace = guard.trace().to_owned();
        assert_eq!(trace.len(), 32);
        assert!(trace.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            table.lookup(&trace, "knowledge-propose-batch"),
            Some(attestation())
        );
        assert_eq!(table.lookup(&trace, "knowledge-approve"), None);
        assert_eq!(table.lookup("guess", "knowledge-propose-batch"), None);
        drop(guard);
        assert_eq!(table.lookup(&trace, "knowledge-propose-batch"), None);
        assert_eq!(table.len(), 0);
    }

    #[test]
    fn steps_in_flight_hold_distinct_traces() {
        let table = Arc::new(PipelineAttestations::default());
        let guards: Vec<StepGuard> = (0..64)
            .filter_map(|_| table.begin(attestation(), "a-b"))
            .collect();
        assert_eq!(guards.len(), 64);
        assert_eq!(table.len(), 64);
        drop(guards);
        assert_eq!(table.len(), 0);
    }
}
