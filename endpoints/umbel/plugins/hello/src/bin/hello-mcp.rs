//! `hello-mcp`: the hello plugin as a stdio MCP server, for the mounted build (specification
//! section 10.5). A host mounts it with `manifests/mounted.toml`.
#![forbid(unsafe_code)]

#[tokio::main]
async fn main() {
    if let Err(error) = umbel_sdk::serve_mounted(umbel_plugin_hello::plugin()).await {
        eprintln!("hello-mcp: {error}");
        std::process::exit(1);
    }
}
