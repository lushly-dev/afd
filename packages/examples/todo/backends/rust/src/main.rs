use afd::{ActorKind, CommandContext, CommandRegistry};
use serde_json::Value;
use std::env;
use std::io::{self, BufRead, Write};
use std::process::ExitCode;
use std::sync::Arc;
use todo_backend_rust::app::{self, Approvals};
use todo_backend_rust::server::{self, ServerConfig};
use todo_backend_rust::TodoStore;

fn print_usage() {
    println!("Usage:");
    println!("  todo-backend-rust server            Serve MCP over HTTP (default)");
    println!("  todo-backend-rust stdio             Serve MCP over stdin and stdout");
    println!("  todo-backend-rust <command> [json]  Run one command, e.g. todo-list '{{}}'");
    println!("  todo-backend-rust shell             Interactive shell (exit or Ctrl+D to quit)");
    println!("  todo-backend-rust list-commands     List the commands");
    println!();
    println!("Server settings: HOST (127.0.0.1), PORT (3100), ALLOWED_ORIGINS, ALLOWED_HOSTS,");
    println!("MAX_BODY_BYTES, CONFIRMATIONS, TOOL_STRATEGY, APPROVALS, TODO_APPROVAL_SECRET.");
    println!("See README.md.");
}

/// The configuration from the environment, and the registry over a new store.
fn build() -> Result<(ServerConfig, Arc<CommandRegistry>), (ExitCode, String)> {
    let config = ServerConfig::from_env(|name| env::var(name).ok())
        .map_err(|error| (ExitCode::from(2), error))?;
    // The key is read only when clears are held, as TypeScript and Python read it.
    let secret = match config.approvals {
        Approvals::Agents => app::approval_secret(env::var("TODO_APPROVAL_SECRET").ok())
            .map_err(|error| (ExitCode::from(2), error))?,
        Approvals::Off => Vec::new(),
    };
    let registry =
        app::registry(Arc::new(TodoStore::new()), config.approvals, &secret).map_err(|error| {
            (
                ExitCode::FAILURE,
                format!("Could not register the commands: {error}"),
            )
        })?;
    if env::var("PROTOCOL_CONFORMANCE").as_deref() == Ok("1") {
        app::register_protocol_conformance_command(&registry).map_err(|error| {
            (
                ExitCode::FAILURE,
                format!("Could not register protocol conformance command: {error}"),
            )
        })?;
    }
    if env::var("TASK_CONFORMANCE").as_deref() == Ok("1") {
        app::register_task_conformance_command(&registry).map_err(|error| {
            (
                ExitCode::FAILURE,
                format!("Could not register task conformance command: {error}"),
            )
        })?;
    }
    Ok((config, registry))
}

#[tokio::main]
async fn main() -> ExitCode {
    let (config, registry) = match build() {
        Ok(built) => built,
        Err((code, error)) => {
            eprintln!("{error}");
            return code;
        }
    };

    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None | Some("server") => run_server(registry, config).await,
        Some("stdio") => run_stdio(registry, config).await,
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

async fn run_server(registry: Arc<CommandRegistry>, config: ServerConfig) -> ExitCode {
    let mcp = match server::mcp_server(registry, &config) {
        Ok(mcp) => mcp,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::FAILURE;
        }
    };
    if config.approvals == Approvals::Off {
        println!("  Approvals are off: todo-clear runs for any caller (APPROVALS=off)");
    }
    let state = server::AppState {
        mcp,
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

/// Serve MCP over stdin and stdout until the client disconnects. stdout carries JSON-RPC, so
/// nothing else is printed there.
async fn run_stdio(registry: Arc<CommandRegistry>, config: ServerConfig) -> ExitCode {
    let served = match server::mcp_server(registry, &config) {
        Ok(mcp) => mcp.serve_stdio().await,
        Err(error) => Err(error),
    };
    match served {
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
    // The command line is the person at the terminal, so todo-clear is not held for them.
    let context = CommandContext::new()
        .with_trace_id(format!("cli-{}", uuid::Uuid::new_v4()))
        .with_actor(ActorKind::Human);
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
                // The shell keeps going whatever one command returns; its result is already printed.
                let _ = run_command(registry, name, value).await;
            }
            Err(error) => println!("Invalid JSON: {error}"),
        }
    }
}
