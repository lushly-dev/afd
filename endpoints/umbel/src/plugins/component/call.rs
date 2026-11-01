//! One call of a component command (specification section 6.2): a new store with its own limits,
//! an instance from the pre-linked component, `command.execute`, and the store dropped.

use std::sync::Arc;
use std::time::Duration;

use afd::{CommandContext, CommandResult};
use serde_json::Value;
use wasmtime::component::ResourceTable;
use wasmtime::{Store, Trap};
use wasmtime_wasi::I32Exit;

use super::super::PluginError;
use super::super::compiled::call_context;
use super::super::grants::CallServices;
use super::engine::EPOCH_MS;
use super::state::bindings::umbel::plugin::types::CallContext;
use super::state::{CallState, LimitHit, Limiter};
use super::wasi::virtualized;
use super::{ComponentRuntime, MAX_IO_BYTES};

/// Run `name` with `input`. The component executes on a blocking thread: a call is CPU work, and
/// the host services it uses read files.
pub(super) async fn run(
    runtime: &Arc<ComponentRuntime>,
    name: &str,
    has_space: bool,
    input: Value,
    context: CommandContext,
) -> Result<CommandResult<Value>, PluginError> {
    let instance = &runtime.instance;
    let text = input.to_string();
    if text.len() > MAX_IO_BYTES {
        return Err(PluginError::component_limit(
            instance,
            "io",
            format!(
                "the input is {} bytes; the limit is {MAX_IO_BYTES}",
                text.len()
            ),
        ));
    }
    let services = Arc::new(runtime.services.call(&input, &context));
    let call = call_context(name, has_space, &services, &context);
    let record = CallContext {
        command: call.command,
        trace_id: call.trace_id,
        space: call.space,
        actor_kind: call.actor_kind,
        actor_id: call.actor_id,
        on_behalf_of: call.on_behalf_of,
        interface: call.interface,
    };
    let runtime = Arc::clone(runtime);
    let name = name.to_owned();
    let handle = tokio::runtime::Handle::current();
    let joined = tokio::task::spawn_blocking(move || {
        handle.block_on(execute(&runtime, &name, text, record, services))
    })
    .await;
    match joined {
        Ok(answer) => parse(instance, &answer?),
        // A panic in the host is AFD's COMMAND_EXECUTION_ERROR, as for any handler.
        Err(error) if error.is_panic() => std::panic::resume_unwind(error.into_panic()),
        Err(error) => Err(PluginError::trapped(
            instance,
            format!("the call was cancelled: {error}"),
        )),
    }
}

fn parse(instance: &str, answer: &str) -> Result<CommandResult<Value>, PluginError> {
    if answer.len() > MAX_IO_BYTES {
        return Err(PluginError::component_limit(
            instance,
            "io",
            format!(
                "the result is {} bytes; the limit is {MAX_IO_BYTES}",
                answer.len()
            ),
        ));
    }
    serde_json::from_str::<CommandResult<Value>>(answer)
        .map_err(|error| PluginError::result_invalid(instance, error))
}

async fn execute(
    runtime: &ComponentRuntime,
    name: &str,
    input: String,
    record: CallContext,
    services: Arc<CallServices>,
) -> Result<String, PluginError> {
    let instance = &runtime.instance;
    let limits = runtime.limits;
    let (wasi, flush) = virtualized(&services, runtime.seeds);
    let state = CallState {
        wasi,
        table: ResourceTable::new(),
        limiter: Limiter::new(
            usize::try_from(limits.memory_bytes).unwrap_or(usize::MAX),
            usize::try_from(limits.table_elements).unwrap_or(usize::MAX),
        ),
        services,
    };
    let mut store = Store::new(&runtime.shared.engine, state);
    store.limiter(|state| &mut state.limiter);
    store
        .set_fuel(limits.fuel)
        .map_err(|error| PluginError::load_failed(instance, format!("{error:#}")))?;
    // One tick more than the timeout, because the epoch advances on its own schedule and the
    // deadline is counted from the epoch the store starts in.
    store.set_epoch_deadline(limits.timeout_ms.div_ceil(EPOCH_MS) + 1);
    store.epoch_deadline_trap();

    let timeout = Duration::from_millis(limits.timeout_ms);
    let outcome = tokio::time::timeout(timeout, async {
        let component = runtime.pre.instantiate_async(&mut store).await?;
        let function = component.get_typed_func::<(String, String, CallContext), (String,)>(
            &mut store,
            &runtime.execute,
        )?;
        let (answer,) = function
            .call_async(&mut store, (name.to_owned(), input, record))
            .await?;
        Ok::<String, wasmtime::Error>(answer)
    })
    .await;
    flush.finish();
    match outcome {
        Ok(Ok(answer)) => Ok(answer),
        Ok(Err(error)) => Err(classify(instance, limits.timeout_ms, &store, &error)),
        // The deadline passed while the component was waiting in the host (a sleep, say), where
        // the epoch cannot reach it.
        Err(_) => Err(PluginError::component_limit(
            instance,
            "timeout",
            format!("the call ran past timeout_ms ({} ms)", limits.timeout_ms),
        )),
    }
}

/// Which limit, or which trap, ended a call.
fn classify(
    instance: &str,
    timeout_ms: u64,
    store: &Store<CallState>,
    error: &wasmtime::Error,
) -> PluginError {
    if let Some(trap) = error.downcast_ref::<Trap>() {
        match trap {
            Trap::OutOfFuel => {
                return PluginError::component_limit(
                    instance,
                    "fuel",
                    "the call ran out of fuel (limits.fuel)",
                );
            }
            Trap::Interrupt => {
                return PluginError::component_limit(
                    instance,
                    "timeout",
                    format!("the call ran past timeout_ms ({timeout_ms} ms)"),
                );
            }
            _ => {}
        }
    }
    match store.data().limiter.hit {
        Some(LimitHit::Memory) => {
            return PluginError::component_limit(
                instance,
                "memory",
                "the call asked for more memory than limits.memory_bytes allows",
            );
        }
        Some(LimitHit::Table) => {
            return PluginError::component_limit(
                instance,
                "table",
                "the call asked for more table elements than limits.table_elements allows",
            );
        }
        None => {}
    }
    if let Some(exit) = error.downcast_ref::<I32Exit>() {
        return PluginError::trapped(instance, format!("the component called exit({})", exit.0));
    }
    PluginError::trapped(instance, format!("{error:#}"))
}
