//! `CommandRegistry::execute` per-call cost, with 0 and 4 pass-through middleware and with an
//! output budget (#1764). Run with `cargo bench --bench execute`.
//!
//! It prints heap allocations and bytes allocated per call, counted by a global allocator, which
//! do not vary with machine load, and the median time per call over several rounds, which does.
//! No benchmark framework: it needs only the crate and Tokio.

#![allow(unsafe_code)]

use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandMiddleware, CommandRegistry,
    CommandResult,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

const CALLS: u32 = 2_000;
const ROUNDS: usize = 5;

/// The system allocator, counting allocations and bytes.
struct Counting;

static ALLOCATIONS: AtomicU64 = AtomicU64::new(0);
static BYTES: AtomicU64 = AtomicU64::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        BYTES.fetch_add(layout.size() as u64, Ordering::Relaxed);
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        BYTES.fetch_add(new_size as u64, Ordering::Relaxed);
        System.realloc(ptr, layout, new_size)
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

struct Echo;

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(input)
    }
}

/// A realistic input: 50 records of a few fields each.
fn input() -> Value {
    let items: Vec<Value> = (0..50)
        .map(|index| {
            json!({
                "id": format!("item-{index}"),
                "title": "A todo with a moderately long title",
                "done": index % 2 == 0,
                "priority": index % 5,
                "tags": ["work", "home"],
            })
        })
        .collect();
    json!({ "items": items })
}

fn pass_through() -> CommandMiddleware {
    Arc::new(|_name, _input, context, next| Box::pin(async move { next(context).await }))
}

fn registry(layers: usize, budget: bool) -> CommandRegistry {
    let registry = CommandRegistry::new();
    let mut command = CommandDefinition::new("bench-echo", "Echo the input", vec![], Echo);
    if budget {
        command = command.with_output_budget(1 << 20, 1 << 22);
    }
    let schema = json!({"type": "object", "properties": {"items": {"type": "array"}}});
    registry
        .register_with_schema(command, schema)
        .expect("registers");
    for _ in 0..layers {
        registry.add_middleware(pass_through());
    }
    registry
}

async fn call(registry: &CommandRegistry, input: &Value) {
    let result = registry.execute("bench-echo", input.clone(), None).await;
    assert!(result.data.is_some_and(|data| data["items"].is_array()));
}

async fn measure(label: &str, registry: &CommandRegistry, input: &Value) {
    // The caller's own copy of the input is counted apart and subtracted.
    let (copies, copy_bytes) = counted(|| drop(std::hint::black_box(input.clone())));
    call(registry, input).await;
    let before = (
        ALLOCATIONS.load(Ordering::Relaxed),
        BYTES.load(Ordering::Relaxed),
    );
    call(registry, input).await;
    let allocations = ALLOCATIONS.load(Ordering::Relaxed) - before.0 - copies;
    let bytes = BYTES.load(Ordering::Relaxed) - before.1 - copy_bytes;

    let mut rounds = Vec::with_capacity(ROUNDS);
    for _ in 0..ROUNDS {
        let start = Instant::now();
        for _ in 0..CALLS {
            call(registry, input).await;
        }
        rounds.push(start.elapsed().as_nanos() / u128::from(CALLS));
    }
    rounds.sort_unstable();
    println!(
        "{label:<28} {allocations:>6} allocations {bytes:>8} bytes {:>8} ns/call",
        rounds[ROUNDS / 2]
    );
}

fn counted(run: impl FnOnce()) -> (u64, u64) {
    let before = (
        ALLOCATIONS.load(Ordering::Relaxed),
        BYTES.load(Ordering::Relaxed),
    );
    run();
    (
        ALLOCATIONS.load(Ordering::Relaxed) - before.0,
        BYTES.load(Ordering::Relaxed) - before.1,
    )
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let input = input();
    measure("0 middleware", &registry(0, false), &input).await;
    measure("4 middleware", &registry(4, false), &input).await;
    measure("0 middleware, output budget", &registry(0, true), &input).await;
    measure("4 middleware, output budget", &registry(4, true), &input).await;
}
