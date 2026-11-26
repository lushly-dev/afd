//! Which calls an approval step admitted (`spec/command-metadata.md`, "Approvals"; #1886).
//!
//! [`CommandRegistry::execute`](crate::CommandRegistry::execute) gives every call a fresh
//! [`Admission`] on its context before any middleware runs, naming the command the call runs. An
//! approval middleware whose own policies (the command's and its list's) may gate the call
//! records, on every path that lets the call through, what it decided on: the command name and
//! the canonical JSON of the validated input. A middleware none of whose policies gate the command
//! admits nothing. Just before the handler, the registry dispatches a command whose declared
//! policy is neither unset nor `NotRequired` (or whose gate the approval middleware's commands
//! list declares, [`Admission::require`]) only when it takes at least one admission and every
//! admission names this command and this input, and every approval step that ever admitted the
//! call admitted it again since the last dispatch. It takes them all at once, under one lock: a
//! second dispatch on the same call (a retry inside the chain, or two overlapping `next` calls)
//! needs a fresh admission from each step. An input with no canonical JSON is compared as a value: only a
//! policy that let the call through admits one, since the approval middleware refuses to hold such
//! an input.
//!
//! A batch item, a pipeline step and a command run from inside another command's handler each go
//! through `execute` and get their own record, so no call inherits another's admission. The
//! record lives in a crate-private context field: no input, `extra` entry or declared context
//! field can set it.

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use serde_json::Value;

use super::ApprovalPolicy;
use crate::commands::CommandDefinition;

/// Whether a declared policy needs an approval step: anything but unset or `NotRequired`.
pub(crate) fn gates(policy: Option<&ApprovalPolicy>) -> bool {
    !matches!(policy, None | Some(ApprovalPolicy::NotRequired))
}

/// What a dispatch found when it took the call's admission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Taken {
    /// An approval step admitted this command on this input.
    Admitted,
    /// No approval step admitted the call.
    Missing,
    /// An admission was taken already, or names another command or input.
    Mismatch,
}

/// The input an approval step decided on, as an admission binds it.
#[cfg_attr(not(feature = "approval"), allow(dead_code))]
#[derive(Clone)]
pub(crate) enum Decided {
    /// Its canonical JSON: the binding a token was verified against.
    Canonical(String),
    /// The input itself, compared as a value, when it has no canonical JSON.
    Value(Value),
}

impl Decided {
    /// What an approval step decided on `input`, whose canonical JSON is `canonical`: the input is
    /// kept only when it has none.
    #[cfg_attr(not(feature = "approval"), allow(dead_code))]
    pub(crate) fn of(canonical: Option<String>, input: &Value) -> Self {
        match canonical {
            Some(canonical) => Self::Canonical(canonical),
            None => Self::Value(input.clone()),
        }
    }

    fn matches(&self, input: &Value) -> bool {
        match self {
            Self::Canonical(canonical) => {
                crate::canonical::exact(input).ok().as_deref() == Some(canonical.as_str())
            }
            // An input with canonical JSON is never one decided on without it.
            Self::Value(decided) => crate::canonical::exact(input).is_err() && decided == input,
        }
    }
}

/// One approval step: a middleware instance, numbered when it is created.
pub(crate) type Step = u64;

/// What one approval step admitted.
struct Admitted {
    /// The approval step that admitted it.
    step: Step,
    name: String,
    decided: Decided,
}

/// What approval steps admitted that no dispatch took yet, and whether a dispatch took any.
#[derive(Default)]
struct State {
    /// Every admission since the last dispatch, in order. Two approval middlewares that both gate
    /// the command each admit, and the dispatch must match them all, so a later one never
    /// replaces or weakens an earlier one's binding.
    admitted: Vec<Admitted>,
    /// Every approval step that ever admitted this call, never cleared. A dispatch needs a fresh
    /// admission from each, so a retry that reruns only the steps after one of them is refused.
    steps: Vec<Step>,
    /// Set once a dispatch took admissions, so a second dispatch with none reads as a mismatch.
    taken: bool,
}

/// One call's admission record.
pub(crate) struct Admission {
    command: Arc<CommandDefinition>,
    state: Mutex<State>,
    /// Set by the approval middleware when its commands list gates this command.
    required: AtomicBool,
    /// Set when the registry's call of this record returns, so a context kept past it (a clone a
    /// middleware held on to) no longer speaks for the command.
    ended: AtomicBool,
}

impl Admission {
    /// A record for a call of `command`, not yet admitted.
    pub(crate) fn begin(command: Arc<CommandDefinition>) -> Arc<Self> {
        Arc::new(Self {
            command,
            state: Mutex::new(State::default()),
            required: AtomicBool::new(false),
            ended: AtomicBool::new(false),
        })
    }

    /// Record that the registry's call of this record returned.
    pub(crate) fn end(&self) {
        self.ended.store(true, Ordering::SeqCst);
    }

    /// The command's `mutation` declaration, for the retry middleware: `None` once the call that
    /// made this record returned, or when it names another command.
    pub(crate) fn live_mutation(&self, name: &str) -> Option<bool> {
        (!self.ended.load(Ordering::SeqCst) && self.command.name == name)
            .then_some(self.command.mutation)
    }

    /// The command this call runs, as registered.
    #[cfg_attr(not(feature = "approval"), allow(dead_code))]
    pub(crate) fn command(&self) -> &CommandDefinition {
        &self.command
    }

    /// Record that the approval middleware's commands list gates this command, so its dispatch
    /// takes an admission though the command declares no gating policy itself.
    #[cfg_attr(not(feature = "approval"), allow(dead_code))]
    pub(crate) fn require(&self) {
        self.required.store(true, Ordering::SeqCst);
    }

    /// Whether the dispatch must take an admission: the command's own policy gates, or the
    /// approval middleware's list does.
    pub(crate) fn gated(&self) -> bool {
        gates(self.command.approval.as_ref()) || self.required.load(Ordering::SeqCst)
    }

    /// Record that the approval `step`, which may gate this call, admitted it to run `name` on
    /// the input it `decided` on.
    #[cfg_attr(not(feature = "approval"), allow(dead_code))]
    pub(crate) fn admit(&self, step: Step, name: &str, decided: Decided) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if !state.steps.contains(&step) {
            state.steps.push(step);
        }
        state.admitted.push(Admitted {
            step,
            name: name.to_owned(),
            decided,
        });
    }

    /// Take every admission for a dispatch of `name` on `input`, at once: `Admitted` when every
    /// approval step that ever admitted the call admitted it again since the last dispatch, and
    /// every admission names this command and input, `Missing` when there is none and no dispatch
    /// took any, `Mismatch` otherwise. Taken whatever the answer, so a second dispatch needs a
    /// fresh admission from each step.
    pub(crate) fn take(&self, name: &str, input: &Value) -> Taken {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.admitted.is_empty() {
            return if state.taken {
                Taken::Mismatch
            } else {
                Taken::Missing
            };
        }
        state.taken = true;
        let admitted = std::mem::take(&mut state.admitted);
        let every_step = state
            .steps
            .iter()
            .all(|step| admitted.iter().any(|fresh| fresh.step == *step));
        drop(state);
        if every_step
            && admitted
                .iter()
                .all(|step| step.name == name && step.decided.matches(input))
        {
            Taken::Admitted
        } else {
            Taken::Mismatch
        }
    }
}

impl fmt::Debug for Admission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        f.debug_struct("Admission")
            .field("command", &self.command.name)
            .field("admitted", &state.admitted.len())
            .field("taken", &state.taken)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{success, CommandContext, CommandHandler, CommandResult};
    use serde_json::json;

    struct Noop;
    #[async_trait::async_trait]
    impl CommandHandler for Noop {
        async fn execute(&self, _: Value, _: CommandContext) -> CommandResult<Value> {
            success(Value::Null)
        }
    }

    /// Admit `name` on `input`, as the approval middleware does.
    fn admit(admission: &Admission, name: &str, input: &Value) {
        admit_as(admission, 1, name, input);
    }

    /// Admit `name` on `input` as the approval step `step`.
    fn admit_as(admission: &Admission, step: Step, name: &str, input: &Value) {
        admission.admit(
            step,
            name,
            Decided::of(crate::canonical::exact(input).ok(), input),
        );
    }

    fn record(policy: Option<ApprovalPolicy>) -> Arc<Admission> {
        let command = CommandDefinition::new("todo-delete", "Delete", vec![], Noop);
        let command = match policy {
            Some(policy) => command.with_approval(policy),
            None => command,
        };
        Admission::begin(Arc::new(command))
    }

    #[test]
    fn only_unset_and_not_required_do_not_gate() {
        assert!(!gates(None));
        assert!(!gates(Some(&ApprovalPolicy::NotRequired)));
        assert!(gates(Some(&ApprovalPolicy::Required)));
        assert!(gates(Some(&ApprovalPolicy::when(|_, _| {
            crate::ApprovalDecision::NotRequired
        }))));
    }

    #[test]
    fn an_admission_runs_one_dispatch_of_the_same_command_and_input() {
        let admission = record(Some(ApprovalPolicy::Required));
        assert_eq!(admission.take("todo-delete", &json!({})), Taken::Missing);
        admit(&admission, "todo-delete", &json!({"id": 1, "all": false}));
        assert_eq!(
            admission.take("todo-delete", &json!({"all": false, "id": 1})),
            Taken::Admitted
        );
        assert_eq!(
            admission.take("todo-delete", &json!({"id": 1, "all": false})),
            Taken::Mismatch
        );
    }

    #[test]
    fn another_command_or_input_is_a_mismatch() {
        let admission = record(Some(ApprovalPolicy::Required));
        admit(&admission, "todo-touch", &json!({"id": 1}));
        assert_eq!(
            admission.take("todo-delete", &json!({"id": 1})),
            Taken::Mismatch
        );
        admit(&admission, "todo-delete", &json!({"id": 1}));
        assert_eq!(
            admission.take("todo-delete", &json!({"id": 2})),
            Taken::Mismatch
        );
    }

    #[test]
    fn every_admission_must_match_and_all_are_taken_at_once() {
        let admission = record(Some(ApprovalPolicy::Required));
        admit(&admission, "todo-delete", &json!({"id": 1}));
        admit(&admission, "todo-delete", &json!({"id": 1}));
        assert_eq!(
            admission.take("todo-delete", &json!({"id": 1})),
            Taken::Admitted
        );
        // Both were taken: a second dispatch has none.
        assert_eq!(
            admission.take("todo-delete", &json!({"id": 1})),
            Taken::Mismatch
        );
        // A later admission on another input does not replace an earlier one's binding.
        admit(&admission, "todo-delete", &json!({"id": 1}));
        admit(&admission, "todo-delete", &json!({"id": 2}));
        assert_eq!(
            admission.take("todo-delete", &json!({"id": 2})),
            Taken::Mismatch
        );
    }

    #[test]
    fn a_dispatch_needs_a_fresh_admission_from_every_step_that_ever_admitted() {
        let admission = record(Some(ApprovalPolicy::Required));
        admit_as(&admission, 1, "todo-delete", &json!({"id": 1}));
        admit_as(&admission, 2, "todo-delete", &json!({"id": 1}));
        assert_eq!(
            admission.take("todo-delete", &json!({"id": 1})),
            Taken::Admitted
        );
        // A retry that reruns only step 2.
        admit_as(&admission, 2, "todo-delete", &json!({"id": 1}));
        assert_eq!(
            admission.take("todo-delete", &json!({"id": 1})),
            Taken::Mismatch
        );
    }

    #[test]
    fn an_input_without_canonical_json_is_compared_as_a_value() {
        let admission = record(Some(ApprovalPolicy::Required));
        let big = json!({"id": u64::MAX});
        admit(&admission, "todo-delete", &big);
        assert_eq!(admission.take("todo-delete", &big), Taken::Admitted);
        admit(&admission, "todo-delete", &big);
        assert_eq!(
            admission.take("todo-delete", &json!({"id": u64::MAX - 1})),
            Taken::Mismatch
        );
    }

    #[test]
    fn a_list_gate_makes_an_ungated_command_take_its_admission() {
        let admission = record(None);
        assert!(!admission.gated());
        admission.require();
        assert!(admission.gated());
    }
}
