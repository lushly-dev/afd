use afd::{CommandHandler, CommandResult, CommandContext, success};
use crate::types::{TodoStats, PriorityStats, Priority};
use crate::store::STORE;
use async_trait::async_trait;

pub struct StatsHandler;

#[async_trait]
impl CommandHandler for StatsHandler {
    async fn execute(&self, _input: serde_json::Value, _context: CommandContext) -> CommandResult<serde_json::Value> {
        let total = STORE.len();
        let mut completed = 0;
        let mut low = 0;
        let mut medium = 0;
        let mut high = 0;

        for r in STORE.iter() {
            let t = r.value();
            if t.completed {
                completed += 1;
            }
            match t.priority {
                Priority::Low => low += 1,
                Priority::Medium => medium += 1,
                Priority::High => high += 1,
            }
        }

        let stats = TodoStats {
            total,
            completed,
            pending: total - completed,
            by_priority: PriorityStats { low, medium, high },
            completion_rate: if total > 0 { completed as f64 / total as f64 } else { 0.0 },
        };

        success(serde_json::to_value(stats).unwrap())
    }
}
