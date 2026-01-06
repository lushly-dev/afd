pub mod create;
pub mod list;
pub mod get;
pub mod update;
pub mod delete;
pub mod toggle;
pub mod clear;
pub mod stats;

use afd::{CommandRegistry, CommandDefinition, CommandParameter};

pub fn register_commands(registry: &mut CommandRegistry) {
    registry.register(CommandDefinition::new(
        "todo-create",
        "Create a new todo item",
        vec![
            CommandParameter::required_string("title", "Todo title"),
            CommandParameter::optional_string("description", "Optional description"),
            CommandParameter::optional_string("priority", "Priority (low, medium, high)"),
        ],
        create::CreateHandler,
    )).unwrap();

    registry.register(CommandDefinition::new(
        "todo-list",
        "List todo items with filtering and sorting",
        vec![
            CommandParameter::optional_string("search", "Search in title/description"),
            CommandParameter::optional_string("priority", "Filter by priority"),
            CommandParameter::required_boolean("completed", "Filter by completion status").with_default(serde_json::Value::Null),
        ],
        list::ListHandler,
    )).unwrap();

    registry.register(CommandDefinition::new(
        "todo-get",
        "Get a specific todo item by ID",
        vec![CommandParameter::required_string("id", "Todo ID")],
        get::GetHandler,
    )).unwrap();

    registry.register(CommandDefinition::new(
        "todo-update",
        "Update an existing todo item",
        vec![
            CommandParameter::required_string("id", "Todo ID"),
            CommandParameter::optional_string("title", "New title"),
            CommandParameter::optional_string("description", "New description"),
            CommandParameter::optional_string("priority", "New priority"),
            CommandParameter::required_boolean("completed", "New completion status").with_default(serde_json::Value::Null),
        ],
        update::UpdateHandler,
    )).unwrap();

    registry.register(CommandDefinition::new(
        "todo-delete",
        "Delete a todo item",
        vec![CommandParameter::required_string("id", "Todo ID")],
        delete::DeleteHandler,
    )).unwrap();

    registry.register(CommandDefinition::new(
        "todo-toggle",
        "Toggle the completion status of a todo item",
        vec![CommandParameter::required_string("id", "Todo ID")],
        toggle::ToggleHandler,
    )).unwrap();

    registry.register(CommandDefinition::new(
        "todo-clear",
        "Clear all todo items",
        vec![],
        clear::ClearHandler,
    )).unwrap();

    registry.register(CommandDefinition::new(
        "todo-stats",
        "Get statistics about todo items",
        vec![],
        stats::StatsHandler,
    )).unwrap();
}
