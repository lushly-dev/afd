//! The state of one call's store: the host services behind the `umbel:plugin` imports, the
//! virtualized WASI context, and the resource limiter.

use std::sync::Arc;

use wasmtime::component::{HasSelf, Linker, ResourceTable};
use wasmtime::{ResourceLimiter, StoreLimits, StoreLimitsBuilder};
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use super::super::grants::CallServices;
use umbel_sdk::{HostError as ServiceError, HostServices, Level};

/// The bindings of the WIT world `umbel:plugin/plugin@1.0.0`, generated from
/// `wit/umbel-plugin-1.0.0/world.wit`, the normative file. The host imports of the world are
/// traits implemented on [`CallState`]; the export is called dynamically (see `call.rs`), so any
/// `umbel:plugin/command@1.x` export is served.
#[allow(missing_docs, unreachable_pub, clippy::all)]
pub(super) mod bindings {
    wasmtime::component::bindgen!({
        path: "wit/umbel-plugin-1.0.0",
        world: "plugin",
        imports: { default: trappable },
    });
}

use bindings::umbel::plugin::{clock, config, events, log, packs, random, types};

/// Everything a store holds for one call.
pub(super) struct CallState {
    pub(super) wasi: WasiCtx,
    pub(super) table: ResourceTable,
    pub(super) limiter: Limiter,
    pub(super) services: Arc<CallServices>,
}

impl WasiView for CallState {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

/// Link the six host interfaces of the world (and the shared `types`).
pub(super) fn add_world_to_linker(linker: &mut Linker<CallState>) -> wasmtime::Result<()> {
    bindings::Plugin::add_to_linker::<CallState, HasSelf<CallState>>(linker, |state| state)
}

/// Where a call's resource limits stop it, noticed by the limiter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LimitHit {
    Memory,
    Table,
}

/// `StoreLimits`, plus a note of which limit refused a growth, so the host can say which
/// `details.limit` stopped a call that then trapped.
pub(super) struct Limiter {
    inner: StoreLimits,
    memory_size: usize,
    table_elements: usize,
    pub(super) hit: Option<LimitHit>,
}

/// Core instances, memories and tables per store (specification section 6.2). A component
/// instantiates several core instances; `StoreLimits` caps each linear memory, not their sum.
const INSTANCES: usize = 64;
const MEMORIES: usize = 4;
const TABLES: usize = 16;

impl Limiter {
    pub(super) fn new(memory_bytes: usize, table_elements: usize) -> Self {
        Self {
            inner: StoreLimitsBuilder::new()
                .memory_size(memory_bytes)
                .table_elements(table_elements)
                .instances(INSTANCES)
                .memories(MEMORIES)
                .tables(TABLES)
                .build(),
            memory_size: memory_bytes,
            table_elements,
            hit: None,
        }
    }
}

impl ResourceLimiter for Limiter {
    fn memory_growing(
        &mut self,
        current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        let allowed = self.inner.memory_growing(current, desired, maximum)?;
        if !allowed && desired > self.memory_size {
            self.hit = Some(LimitHit::Memory);
        }
        Ok(allowed)
    }

    fn table_growing(
        &mut self,
        current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        let allowed = self.inner.table_growing(current, desired, maximum)?;
        if !allowed && desired > self.table_elements {
            self.hit = Some(LimitHit::Table);
        }
        Ok(allowed)
    }

    fn instances(&self) -> usize {
        self.inner.instances()
    }

    fn tables(&self) -> usize {
        self.inner.tables()
    }

    fn memories(&self) -> usize {
        self.inner.memories()
    }
}

fn wit_error(error: ServiceError) -> types::HostError {
    match error {
        ServiceError::NotGranted(message) => types::HostError::NotGranted(message),
        ServiceError::NotFound(message) => types::HostError::NotFound(message),
        ServiceError::Invalid(message) => types::HostError::Invalid(message),
        ServiceError::TooLarge(message) => types::HostError::TooLarge(message),
    }
}

/// A grant a component's import needs but does not hold traps the call: the import check at load
/// makes this unreachable, and it is the second lock if it ever is not.
fn require(state: &CallState, grant: &str) -> wasmtime::Result<()> {
    if state.services.holds(grant) {
        Ok(())
    } else {
        Err(wasmtime::Error::msg(format!(
            "the grant `{grant}` was not declared or was denied"
        )))
    }
}

impl types::Host for CallState {}

impl config::Host for CallState {
    fn get(&mut self) -> wasmtime::Result<String> {
        require(self, "config")?;
        let value = self
            .services
            .config()
            .map_err(|error| wasmtime::Error::msg(error.to_string()))?;
        Ok(value.to_string())
    }
}

impl log::Host for CallState {
    fn write(&mut self, level: log::Level, message: String) -> wasmtime::Result<()> {
        require(self, "log")?;
        let level = match level {
            log::Level::Error => Level::Error,
            log::Level::Warn => Level::Warn,
            log::Level::Info => Level::Info,
            log::Level::Debug => Level::Debug,
            log::Level::Trace => Level::Trace,
        };
        self.services.log(level, &message);
        Ok(())
    }
}

impl packs::Host for CallState {
    fn list(&mut self, pack: String) -> wasmtime::Result<Result<Vec<String>, types::HostError>> {
        require(self, "packs")?;
        Ok(self.services.pack_list(&pack).map_err(wit_error))
    }

    fn read(
        &mut self,
        pack: String,
        path: String,
    ) -> wasmtime::Result<Result<Vec<u8>, types::HostError>> {
        require(self, "packs")?;
        Ok(self.services.pack_read(&pack, &path).map_err(wit_error))
    }
}

impl events::Host for CallState {
    fn list(
        &mut self,
        space: Option<String>,
        after: Option<String>,
        limit: u32,
    ) -> wasmtime::Result<Result<String, types::HostError>> {
        require(self, "events")?;
        Ok(self
            .services
            .events(space.as_deref(), after.as_deref(), limit)
            .map(|value| value.to_string())
            .map_err(wit_error))
    }
}

impl clock::Host for CallState {
    fn now(&mut self) -> wasmtime::Result<i64> {
        require(self, "clock")?;
        self.services
            .now_ms()
            .map_err(|error| wasmtime::Error::msg(error.to_string()))
    }
}

impl random::Host for CallState {
    fn next(&mut self) -> wasmtime::Result<f64> {
        require(self, "random")?;
        self.services
            .random()
            .map_err(|error| wasmtime::Error::msg(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_limiter_notes_which_limit_refused_a_growth() {
        let mut limiter = Limiter::new(1024, 8);
        assert!(limiter.memory_growing(0, 1024, None).unwrap());
        assert_eq!(limiter.hit, None);
        assert!(!limiter.memory_growing(1024, 1025, None).unwrap());
        assert_eq!(limiter.hit, Some(LimitHit::Memory));

        let mut limiter = Limiter::new(1024, 8);
        assert!(limiter.table_growing(0, 8, None).unwrap());
        assert!(!limiter.table_growing(8, 9, None).unwrap());
        assert_eq!(limiter.hit, Some(LimitHit::Table));

        // A growth the module's own maximum refuses is not the host's limit.
        let mut limiter = Limiter::new(1024, 8);
        assert!(!limiter.memory_growing(0, 100, Some(50)).unwrap());
        assert_eq!(limiter.hit, None);
    }

    #[test]
    fn a_store_holds_at_most_a_few_instances_memories_and_tables() {
        let limiter = Limiter::new(1024, 8);
        assert_eq!(limiter.instances(), 64);
        assert_eq!(limiter.memories(), 4);
        assert_eq!(limiter.tables(), 16);
    }
}
