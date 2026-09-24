mod commands;
mod server;
mod store;
mod types;
mod validation;

use afd::{CommandContext, CommandRegistry};
use commands::Tool;
use serde_json::Value;
use std::env;
use std::io::{self, BufRead, Write};
use std::process::ExitCode;
use std::sync::Arc;
use store::TodoStore;

fn print_usage() {
    println!("Usage:");
    println!("  todo-backend-rust server            Start the MCP-over-HTTP server (default)");
    println!("  todo-backend-rust <command> [json]  Run one command, e.g. todo-list '{{}}'");
    println!("  todo-backend-rust shell             Interactive shell (exit or Ctrl+D to quit)");
    println!("  todo-backend-rust list-commands     List the commands");
    println!();
    println!("Server settings: HOST (127.0.0.1), PORT (3100), ALLOWED_ORIGINS, ALLOWED_HOSTS,");
    println!("MAX_BODY_BYTES. See README.md.");
}

fn build() -> Result<(CommandRegistry, Vec<Tool>), String> {
    let mut registry = CommandRegistry::new();
    let tools = commands::register_commands(&mut registry, &Arc::new(TodoStore::default()))?;
    Ok((registry, tools))
}

#[tokio::main]
async fn main() -> ExitCode {
    let (registry, tools) = match build() {
        Ok(built) => built,
        Err(error) => {
            eprintln!("Could not register the commands: {error}");
            return ExitCode::FAILURE;
        }
    };

    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None | Some("server") => run_server(registry, tools).await,
        Some("shell") => run_shell(&registry).await,
        Some("list-commands") => {
            for name in cli_commands(&registry) {
                println!("- {name}");
            }
            ExitCode::SUCCESS
        }
        Some("help" | "--help" | "-h") => {
            print_usage();
            ExitCode::SUCCESS
        }
        Some(name) => {
            let input = match args.get(1).map(|json| serde_json::from_str(json)) {
                None => Value::Null,
                Some(Ok(input)) => input,
                Some(Err(error)) => {
                    eprintln!("Invalid JSON input: {error}");
                    return ExitCode::from(2);
                }
            };
            run_command(&registry, name, input).await
        }
    }
}

async fn run_server(registry: CommandRegistry, tools: Vec<Tool>) -> ExitCode {
    let config = match server::ServerConfig::from_env(|name| env::var(name).ok()) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    let state = server::AppState {
        registry,
        tools,
        policy: config.policy.clone(),
    };
    match server::start_server(state, &config).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

/// Names of the commands exposed to the CLI, sorted.
fn cli_commands(registry: &CommandRegistry) -> Vec<String> {
    let mut names: Vec<String> = registry
        .list()
        .iter()
        .filter(|command| command.expose.cli)
        .map(|command| command.name.clone())
        .collect();
    names.sort();
    names
}

/// Run a command exposed to the CLI and print its result. Exit code 1 on failure.
async fn run_command(registry: &CommandRegistry, name: &str, input: Value) -> ExitCode {
    if !registry.get(name).is_some_and(|command| command.expose.cli) {
        eprintln!("Unknown command: {name}");
        eprintln!("Available: {}", cli_commands(registry).join(", "));
        return ExitCode::from(2);
    }
    let context = CommandContext::new().with_trace_id(format!("cli-{}", uuid::Uuid::new_v4()));
    let result = registry.execute(name, input, Some(context)).await;
    match serde_json::to_string_pretty(&result) {
        Ok(text) => println!("{text}"),
        Err(error) => eprintln!("Could not print the result: {error}"),
    }
    if result.success {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

async fn run_shell(registry: &CommandRegistry) -> ExitCode {
    println!("Todo Rust Backend Shell");
    println!("Type 'exit' (or press Ctrl+D) to quit, 'help' for commands.");

    let stdin = io::stdin();
    let mut line = String::new();
    loop {
        print!("> ");
        // A closed stdout is not worth aborting the shell over.
        let _ = io::stdout().flush();

        line.clear();
        match stdin.lock().read_line(&mut line) {
            // End of input: stop instead of spinning on empty reads.
            Ok(0) => {
                println!();
                return ExitCode::SUCCESS;
            }
            Ok(_) => {}
            Err(error) => {
                eprintln!("Could not read input: {error}");
                return ExitCode::FAILURE;
            }
        }

        let input = line.trim();
        match input {
            "" => continue,
            "exit" | "quit" => return ExitCode::SUCCESS,
            "help" => {
                for name in cli_commands(registry) {
                    println!("- {name}");
                }
                continue;
            }
            _ => {}
        }

        let (name, json) = input.split_once(' ').unwrap_or((input, "null"));
        match serde_json::from_str(json) {
            Ok(value) => {
                run_command(registry, name, value).await;
            }
            Err(error) => println!("Invalid JSON: {error}"),
        }
    }
}
