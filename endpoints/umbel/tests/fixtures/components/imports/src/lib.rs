//! A component that calls every `umbel:plugin` host interface, one per command, so a test can
//! grant some and not others: an import with no grant is refused at load.

#[allow(unsafe_code, missing_docs, unreachable_pub)]
mod glue {
    use serde_json::{Value, json};

    wit_bindgen::generate!({ path: "../../../../wit/umbel-plugin-1.0.0", world: "plugin" });

    use umbel::plugin::{clock, config, events, log, packs, random};

    struct Component;

    /// A result as `{ "ok": value }` or `{ "err": message }`.
    fn outcome<T: serde::Serialize, E: std::fmt::Debug>(result: Result<T, E>) -> Value {
        match result {
            Ok(value) => json!({ "ok": value }),
            Err(error) => json!({ "err": format!("{error:?}") }),
        }
    }

    fn ok(data: Value) -> String {
        json!({ "success": true, "data": data }).to_string()
    }

    impl exports::umbel::plugin::command::Guest for Component {
        fn execute(
            name: String,
            input: String,
            _context: umbel::plugin::types::CallContext,
        ) -> String {
            let input: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
            match name.as_str() {
                "imports-config" => ok(serde_json::from_str(&config::get()).unwrap_or(Value::Null)),
                "imports-log" => {
                    let lines = input.get("lines").and_then(Value::as_u64).unwrap_or(1);
                    let line = "x".repeat(1024);
                    for _ in 0..lines {
                        log::write(log::Level::Info, &line);
                    }
                    ok(json!({ "lines": lines }))
                }
                "imports-packs" => {
                    let read = packs::read("greetings", "data/salutation.txt")
                        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
                    ok(json!({ "read": outcome(read) }))
                }
                "imports-events" => {
                    let listed = events::list(None, None, 10);
                    ok(json!({ "events": outcome(listed) }))
                }
                "imports-clock" => ok(json!({ "now": clock::now() })),
                "imports-random" => ok(json!({ "next": random::next() })),
                other => json!({
                    "success": false,
                    "error": {
                        "code": "COMMAND_NOT_FOUND",
                        "message": format!("no command {other}"),
                        "suggestion": "Call a command the fixture declares."
                    }
                })
                .to_string(),
            }
        }
    }

    export!(Component);
}
