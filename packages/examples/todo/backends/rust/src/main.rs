mod types;
mod store;
mod commands;
mod server;

use afd::CommandRegistry;
use std::env;
use std::io::{self, Write};

#[tokio::main]
async fn main() {
    let mut registry = CommandRegistry::new();
    commands::register_commands(&mut registry);

    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        // Default to starting the server if no args
        server::start_server(registry).await;
        return;
    }

    let command_name = &args[1];

    if command_name == "server" {
        server::start_server(registry).await;
        return;
    }

    if command_name == "shell" {
        run_shell(registry).await;
        return;
    }

    if command_name == "list-commands" {
        for cmd in registry.list() {
            println!("- {}", cmd.name);
        }
        return;
    }

    let input = if args.len() > 2 {
        match serde_json::from_str(&args[2]) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("Invalid JSON input: {}", e);
                return;
            }
        }
    } else {
        serde_json::Value::Null
    };

    let result = registry.execute(command_name, input, None).await;
    println!("{}", serde_json::to_string_pretty(&result).unwrap());
}

fn print_usage() {
    println!("Usage:");
    println!("  todo-backend-rust server           (Start the MCP/HTTP server)");
    println!("  todo-backend-rust <command> [json] (Run a single command)");
    println!("  todo-backend-rust shell            (Interactive shell)");
    println!("  todo-backend-rust list-commands    (List all commands)");
}

async fn run_shell(registry: CommandRegistry) {
    println!("Todo Rust Backend Shell");
    println!("Type 'exit' to quit, 'help' for commands.");

    loop {
        print!("> ");
        io::stdout().flush().unwrap();

        let mut input = String::new();
        io::stdin().read_line(&mut input).unwrap();
        let input = input.trim();

        if input == "exit" {
            break;
        }

        if input == "help" {
            for cmd in registry.list() {
                println!("- {}", cmd.name);
            }
            continue;
        }

        let parts: Vec<&str> = input.splitn(2, ' ').collect();
        let cmd = parts[0];
        let json_str = if parts.len() > 1 { parts[1] } else { "null" };

        let json_val = match serde_json::from_str(json_str) {
            Ok(v) => v,
            Err(e) => {
                println!("Invalid JSON: {}", e);
                continue;
            }
        };

        let result = registry.execute(cmd, json_val, None).await;
        println!("{}", serde_json::to_string_pretty(&result).unwrap());
    }
}
