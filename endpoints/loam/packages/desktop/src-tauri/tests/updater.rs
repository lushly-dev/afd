//! P6-D5 updater integration harness (phase 6 specification, 10.6 and section 19).
//!
//! 1. Under plain `cargo test --locked` (no `LOAM_P6_D5_*` env vars), runs standalone checks:
//!    build-time config defaults to off, non-HTTPS endpoints are refused, and `tauri-plugin-updater`
//!    with no key makes no update request.
//! 2. When `/UPDATE` is passed in `argv` with `LOAM_P6_D5_INSTALLER_MARKER` set (Windows only,
//!    when `tauri-plugin-updater` extracts and runs a signed copy of this executable via
//!    `ShellExecuteW`), updates the disposable `LOAM_P6_D5_TARGET_PATH` target, writes the
//!    received arguments to that marker path, and exits 0 — proving the signed update executed.
//! 3. When `LOAM_P6_D5_MODE` is set (`disabled`, `install`, or `refuse`), builds a real Tauri
//!    mock app with `tauri_plugin_updater` initialized from `tauri.conf.json` and drives the
//!    production `loam_desktop::updater::run_startup` (and `updater::start` in `disabled` mode)
//!    against a local HTTPS feed using a test CA and ephemeral test key.
use loam_desktop::updater::{
    CheckOptions, StartupOutcome, UpdaterConfig, UpdaterError, run_startup, start,
};
use std::path::PathBuf;
use std::time::Duration;
use tauri::test::mock_builder;

fn main() {
    // Mode 2 (Windows signed update payload): when launched by `tauri-plugin-updater`'s
    // `ShellExecuteW`, it passes `/P /UPDATE` and inherits the target/marker paths. Check
    // `/UPDATE` first so the driving parent process (which also carries the env vars for its
    // child) enters Mode 3.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg.eq_ignore_ascii_case("/UPDATE"))
        && let Some(marker) = std::env::var_os("LOAM_P6_D5_INSTALLER_MARKER")
    {
        if let Some(target_path) = std::env::var_os("LOAM_P6_D5_TARGET_PATH") {
            std::fs::write(&target_path, "LOAM_UPDATED_0.2.0\n")
                .expect("update disposable target binary");
        }
        std::fs::write(
            &marker,
            format!("installed=0.2.0\nargs={}\n", args.join(" ")),
        )
        .expect("write updater install marker");
        return;
    }

    // Mode 3: driven by `test/installers/p6-d5.test.ts` with a real local HTTPS feed server.
    if let Ok(mode) = std::env::var("LOAM_P6_D5_MODE") {
        run_driven(&mode);
        return;
    }

    // Mode 1: standalone checks under `cargo test --locked`.
    assert_eq!(
        UpdaterConfig::from_build_env(),
        Ok(None),
        "default build must have updater disabled"
    );
    assert_eq!(
        UpdaterConfig::parse(None, Some("https://127.0.0.1:4443/latest.json")),
        Ok(None),
        "without a key, updater must stay off"
    );
    assert_eq!(
        UpdaterConfig::parse(
            Some("dW50cnVzdGVk"),
            Some("http://127.0.0.1:4443/latest.json")
        ),
        Err(UpdaterError::InsecureEndpoint),
        "plain http endpoint must be refused"
    );
    println!("test p6_d5_updater_defaults_off_and_requires_https ... ok");
}

fn run_driven(mode: &str) {
    let pubkey = std::env::var("LOAM_P6_D5_PUBKEY").ok();
    let endpoint = std::env::var("LOAM_P6_D5_ENDPOINT").ok();
    let ca_pem = std::env::var_os("LOAM_P6_D5_CA_PATH")
        .map(|path| std::fs::read(path).expect("read test CA PEM"));
    let executable_path = std::env::var_os("LOAM_P6_D5_TARGET_PATH").map(PathBuf::from);
    let target = std::env::var("LOAM_P6_D5_TARGET").ok();

    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(tauri::generate_context!("tauri.conf.json", test = true))
        .expect("mock app with updater plugin");

    let options = CheckOptions {
        ca_pem,
        executable_path,
        target,
        timeout: Some(Duration::from_secs(15)),
        restart_after_install: false,
    };

    if mode == "disabled" {
        // Exercise both the compiled-in production `start()` entry and `run_startup()` with a live
        // HTTPS endpoint + test CA and no public key, ensuring the initialized plugin makes zero
        // network requests.
        start(app.handle());
        let outcome = tauri::async_runtime::block_on(async {
            let outcome = run_startup(
                app.handle(),
                pubkey.as_deref(),
                endpoint.as_deref(),
                &options,
            )
            .await;
            tokio::time::sleep(Duration::from_millis(150)).await;
            outcome
        });
        assert_eq!(
            outcome,
            Ok(StartupOutcome::Disabled),
            "expected updater startup to stay disabled without a key"
        );
        println!("disabled: ok");
        return;
    }

    let result = tauri::async_runtime::block_on(run_startup(
        app.handle(),
        pubkey.as_deref(),
        endpoint.as_deref(),
        &options,
    ));

    match mode {
        "install" => {
            let outcome = result.expect("signed HTTPS update should succeed");
            match outcome {
                StartupOutcome::Installed(version) => println!("installed: {version}"),
                other => panic!("expected Installed outcome, got: {other:?}"),
            }
        }
        "refuse" => {
            let err = result.expect_err("expected tampered/untrusted/insecure update to fail");
            println!("refused: {err}");
        }
        other => panic!("unknown LOAM_P6_D5_MODE: {other}"),
    }
}
