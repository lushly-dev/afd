//! A component that opens a TCP socket. Its standard library imports `wasi:sockets/*`, which no
//! grant allows, so the host refuses it at load with `PLUGIN_IMPORT_DENIED`.

#[allow(unsafe_code, missing_docs, unreachable_pub)]
mod glue {
    use std::net::TcpStream;

    wit_bindgen::generate!({ path: "../../../../wit/umbel-plugin-1.0.0", world: "plugin" });

    struct Component;

    impl exports::umbel::plugin::command::Guest for Component {
        fn execute(
            _name: String,
            _input: String,
            _context: umbel::plugin::types::CallContext,
        ) -> String {
            match TcpStream::connect("127.0.0.1:9") {
                Ok(_) => r#"{"success":true,"data":{"connected":true}}"#.to_owned(),
                Err(error) => format!(
                    r#"{{"success":true,"data":{{"connected":false,"error":{:?}}}}}"#,
                    error.to_string()
                ),
            }
        }
    }

    export!(Component);
}
