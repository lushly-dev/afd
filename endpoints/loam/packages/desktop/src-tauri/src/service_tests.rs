use super::*;
use crate::engine_run::pump_rotated_stderr;

#[test]
fn p5_s9_4_macos_launchd_plist_matches_schema_and_escapes_xml() {
    let plist = render_launchd_plist(
        "mail-a1b2c3d4",
        Path::new(
            "/Users/a&b/Library/Application Support/dev.lushly.loam/plugins/mail/abc/engines/darwin-arm64/loam-mail",
        ),
        17401,
        Path::new("/Users/a&b/logs/plugin-mail.stderr.log"),
        Some("/Users/a&b"),
        Some("/private/tmp"),
        Some("en_US.UTF-8"),
    );
    assert!(plist.contains("<string>dev.lushly.loam.plugin.mail-a1b2c3d4</string>"));
    assert!(plist.contains("<string>/usr/bin/env</string>"));
    assert!(plist.contains("<string>-i</string>"));
    assert!(plist.contains("<string>PATH=/usr/bin:/bin</string>"));
    assert!(plist.contains("<string>serve</string>"));
    assert!(plist.contains("<string>--port</string>"));
    assert!(plist.contains("<string>17401</string>"));
    assert!(plist.contains("<key>RunAtLoad</key>\n    <true/>"));
    assert!(plist.contains("<key>SuccessfulExit</key>\n        <false/>"));
    assert!(plist.contains("<key>ThrottleInterval</key>\n    <integer>10</integer>"));
    assert!(plist.contains("<string>Background</string>"));
    assert!(plist.contains("<string>/dev/null</string>"));
    assert!(plist.contains("<key>PATH</key>\n        <string>/usr/bin:/bin</string>"));
    assert!(plist.contains("a&amp;b"));
    assert!(!plist.contains("BETTER_AUTH"));
}

#[test]
fn p5_s9_4_windows_run_value_strips_verbatim_prefix_and_enforces_260_char_cap() {
    assert_eq!(
        strip_verbatim_prefix(Path::new(r"\\?\C:\Program Files\Loam\loam-desktop.exe")),
        PathBuf::from(r"C:\Program Files\Loam\loam-desktop.exe")
    );
    assert_eq!(
        strip_verbatim_prefix(Path::new(r"\\?\UNC\server\share\loam-desktop.exe")),
        PathBuf::from(r"\\server\share\loam-desktop.exe")
    );

    let default_val = format_windows_run_value(
        Path::new(r"\\?\C:\Program Files\Loam\loam-desktop.exe"),
        "mail",
        None,
    )
    .unwrap();
    assert_eq!(
        default_val,
        r#""C:\Program Files\Loam\loam-desktop.exe" engine-run mail"#
    );

    let scoped_val = format_windows_run_value(
        Path::new(r"\\?\C:\Loam\loam-desktop.exe"),
        "mail",
        Some(Path::new(r"\\?\C:\Users\alice\loam-p2")),
    )
    .unwrap();
    assert_eq!(
        scoped_val,
        r#""C:\Loam\loam-desktop.exe" engine-run mail --data-dir "C:\Users\alice\loam-p2""#
    );

    let too_long_exe = PathBuf::from(format!(r"C:\{}\loam-desktop.exe", "a".repeat(250)));
    let err = format_windows_run_value(&too_long_exe, "mail", None).unwrap_err();
    assert_eq!(err.code, PLUGIN_SERVICE_FAILED);
}

#[test]
fn p5_s9_4_linux_systemd_unit_and_xdg_desktop_match_exact_rules() {
    let unit = render_systemd_unit(
        "Mail\nInjected",
        Path::new(
            "/home/alice/.local/share/dev.lushly.loam/plugins/mail/abc/engines/linux-x64/loam-mail",
        ),
        17402,
        &[
            ("HOME", Some("/home/alice")),
            ("XDG_DATA_HOME", None),
            ("XDG_CONFIG_HOME", Some("")),
            ("XDG_RUNTIME_DIR", Some("/run/user/1000/$literal")),
            ("TMPDIR", None),
            ("LANG", Some("C.UTF-8")),
        ],
    );
    assert!(unit.contains("Description=Loam plugin engine (MailInjected)"));
    assert!(unit.contains("ExecStart=/usr/bin/env -i"));
    assert!(unit.contains("\"HOME=/home/alice\""));
    assert!(unit.contains("\"XDG_RUNTIME_DIR=/run/user/1000/$$literal\""));
    assert!(unit.contains("PATH=/usr/bin:/bin"));
    // Absent or empty optional env vars must never be emitted as empty strings.
    assert!(!unit.contains("XDG_DATA_HOME="));
    assert!(!unit.contains("XDG_CONFIG_HOME="));
    assert!(!unit.contains("TMPDIR="));
    assert!(unit.contains("Restart=on-failure"));
    assert!(unit.contains("RestartSec=5"));
    assert!(unit.contains("StandardOutput=null"));
    assert!(unit.contains("StandardError=journal"));
    assert!(unit.contains("WantedBy=default.target"));

    let desktop = render_xdg_desktop(
        "Mail",
        Path::new("/usr/bin/loam-desktop"),
        "mail",
        Some(Path::new("/tmp/loam profile")),
    );
    assert!(desktop.contains("Type=Application"));
    assert!(desktop.contains("NoDisplay=true"));
    assert!(desktop.contains("X-GNOME-Autostart-enabled=true"));
    assert!(desktop.contains(
        r#"Exec="/usr/bin/loam-desktop" engine-run mail --data-dir "/tmp/loam profile""#
    ));
}

#[test]
fn p5_s9_4_profile_scoped_service_ids_differ_from_default() {
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    assert_eq!(service_id("mail", None).unwrap(), "mail");
    let a = service_id("mail", Some(dir_a.path())).unwrap();
    let b = service_id("mail", Some(dir_b.path())).unwrap();
    assert!(a.starts_with("mail-"));
    assert_eq!(a.len(), "mail-".len() + 8);
    assert_ne!(a, b);
    assert!(service_id("../evil", None).is_err());
}

#[test]
fn p5_s9_4_launch_descriptor_validates_owner_only_and_containment() {
    let data = tempfile::tempdir().unwrap();
    let sha = "a".repeat(64);
    let plugin_dir = data.path().join("plugins/mail");
    ensure_dir_owner_only(&plugin_dir).unwrap();
    let bin_dir = plugin_dir.join(&sha).join("engines/target");
    std::fs::create_dir_all(&bin_dir).unwrap();
    let bin_name = if cfg!(windows) {
        "loam-mail.exe"
    } else {
        "loam-mail"
    };
    let bin = bin_dir.join(bin_name);
    std::fs::write(&bin, b"binary").unwrap();

    let desc = LaunchDescriptor {
        plugin_id: "mail".into(),
        bundle_sha256: sha.clone(),
        binary_path: bin.clone(),
        port: 17400,
    };
    write_launch_descriptor(data.path(), &desc, true).unwrap();
    let read_back = read_launch_descriptor(data.path(), "mail", true).unwrap();
    assert_eq!(read_back, desc);

    // Binary outside `<data>/plugins/mail/<bundleSha256>/` is refused.
    let outside = data.path().join(bin_name);
    std::fs::write(&outside, b"evil").unwrap();
    let bad = LaunchDescriptor {
        binary_path: outside,
        ..desc
    };
    assert_eq!(
        bad.validate_under(data.path(), "mail"),
        Err(DESKTOP_STATE_INVALID)
    );
}

#[test]
fn p5_s9_4_stderr_log_rotation_caps_at_1_mib_max_2_files() {
    let dir = tempfile::tempdir().unwrap();
    let log = stderr_log_path(dir.path(), "mail");
    std::fs::create_dir_all(log.parent().unwrap()).unwrap();
    // Write 1.5 MiB through `pump_rotated_stderr`: must rotate into `.1` and keep active <= 1 MiB.
    let payload = vec![b'x'; 1_500_000];
    pump_rotated_stderr(&payload[..], &log);
    let active_len = std::fs::metadata(&log).unwrap().len();
    let backup_len = std::fs::metadata(log.with_file_name("plugin-mail.stderr.log.1"))
        .unwrap()
        .len();
    assert!(active_len <= STDERR_LOG_MAX_BYTES, "active={active_len}");
    assert!(backup_len <= STDERR_LOG_MAX_BYTES, "backup={backup_len}");
    assert_eq!(active_len + backup_len, 1_500_000);
}

#[test]
fn p5_s9_4_systemd_live_state_parser_distinguishes_offline_from_running() {
    assert!(is_live_systemd_state("running\n"));
    assert!(is_live_systemd_state("degraded\n"));
    assert!(is_live_systemd_state("starting\n"));
    assert!(!is_live_systemd_state("offline\n"));
    assert!(!is_live_systemd_state(""));
    assert!(!is_live_systemd_state("Failed to connect to bus\n"));
}
