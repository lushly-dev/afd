use super::*;
use crate::plugin_validate::{
    bundle_digest, bundle_path_problem, fold_bundle_path, parse_packed_app_manifest,
    says_shell_name, sha256_hex, validate_plugin_apps, validate_plugin_manifest,
};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;

fn cases_json() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../manifest/test/fixtures/loam-plugin-cases.json");
    let text = std::fs::read_to_string(&path).expect("read loam-plugin-cases.json");
    serde_json::from_str(&text).expect("parse loam-plugin-cases.json")
}

/// RFC 7386 JSON Merge Patch matching `read-plugin.test.ts`.
fn merge_patch(target: &Value, patch: &Value) -> Value {
    let Some(patch_obj) = patch.as_object() else {
        return patch.clone();
    };
    let mut out = target.as_object().cloned().unwrap_or_default();
    for (k, v) in patch_obj {
        if v.is_null() {
            out.remove(k);
        } else {
            let prev = out.get(k).cloned().unwrap_or(Value::Null);
            out.insert(k.clone(), merge_patch(&prev, v));
        }
    }
    Value::Object(out)
}

fn sorted_code_keys(refusals: &[ValidationRefusal]) -> Vec<String> {
    let mut out: Vec<String> = refusals
        .iter()
        .map(|r| format!("{} {}", r.code, r.key))
        .collect();
    out.sort();
    out
}

fn expected_code_keys(arr: &[Value]) -> Vec<String> {
    let mut out: Vec<String> = arr
        .iter()
        .map(|r| {
            format!(
                "{} {}",
                r["code"].as_str().unwrap(),
                r["key"].as_str().unwrap()
            )
        })
        .collect();
    out.sort();
    out
}

fn sorted_code_key_reasons(refusals: &[ValidationRefusal]) -> Vec<String> {
    let mut out: Vec<String> = refusals
        .iter()
        .map(|r| format!("{} {} {}", r.code, r.key, r.reason))
        .collect();
    out.sort();
    out
}

fn expected_code_key_reasons(arr: &[Value]) -> Vec<String> {
    let mut out: Vec<String> = arr
        .iter()
        .map(|r| {
            format!(
                "{} {} {}",
                r["code"].as_str().unwrap(),
                r["key"].as_str().unwrap(),
                r["reason"].as_str().unwrap()
            )
        })
        .collect();
    out.sort();
    out
}

fn decode_hex(text: &str) -> Vec<u8> {
    assert_eq!(text.len() % 2, 0, "odd hex length: {text}");
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.as_chunks::<2>().0 {
        let s = std::str::from_utf8(pair).unwrap();
        out.push(u8::from_str_radix(s, 16).unwrap());
    }
    out
}

fn entry_data(entry: &Map<String, Value>) -> Vec<u8> {
    if let Some(zeros) = entry.get("zeros").and_then(Value::as_u64) {
        return vec![0u8; zeros as usize];
    }
    if let Some(hex) = entry.get("hex").and_then(Value::as_str) {
        return decode_hex(hex);
    }
    entry
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .as_bytes()
        .to_vec()
}

fn entry_name(entry: &Map<String, Value>) -> Vec<u8> {
    if let Some(hex) = entry.get("nameHex").and_then(Value::as_str) {
        return decode_hex(hex);
    }
    entry
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or("")
        .as_bytes()
        .to_vec()
}

fn merge_obj(base: &Map<String, Value>, extra: &Map<String, Value>) -> Map<String, Value> {
    let mut out = base.clone();
    for (k, v) in extra {
        out.insert(k.clone(), v.clone());
    }
    out
}

/// Exact Rust port of `endpoints/loam/packages/manifest/scripts/archive-cases.mjs`'s `entriesOf`.
fn archive_entries_of(case: &Value, archives: &Value) -> Vec<Map<String, Value>> {
    let base_key = if case.get("base").and_then(Value::as_str) == Some("engine") {
        "engineBase"
    } else {
        "base"
    };
    let base = archives[base_key].as_array().unwrap();
    let remove: Vec<&str> = case
        .get("remove")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let set = case.get("set").and_then(Value::as_object);

    let mut out: Vec<Map<String, Value>> = Vec::new();
    for item in base {
        let obj = item.as_object().unwrap();
        let path = obj.get("path").and_then(Value::as_str).unwrap_or("");
        if remove.contains(&path) {
            continue;
        }
        let merged = match set.and_then(|s| s.get(path)).and_then(Value::as_object) {
            Some(overrides) => merge_obj(obj, overrides),
            None => obj.clone(),
        };
        out.push(merged);
    }
    if let Some(extra) = case.get("entries").and_then(Value::as_array) {
        for item in extra {
            out.push(item.as_object().unwrap().clone());
        }
    }
    if let Some(repeat) = case.get("repeat").and_then(Value::as_object) {
        let count = repeat.get("count").and_then(Value::as_u64).unwrap_or(0) as usize;
        let path_tpl = repeat.get("path").and_then(Value::as_str).unwrap();
        for n in 0..count {
            let mut item = repeat.clone();
            item.remove("count");
            item.insert(
                "path".to_owned(),
                Value::String(path_tpl.replace("{n}", &n.to_string())),
            );
            out.push(item);
        }
    }
    if let Some(all) = case.get("all").and_then(Value::as_object) {
        for item in &mut out {
            *item = merge_obj(item, all);
        }
    }
    out
}

/// Exact Rust port of `archive-cases.mjs`'s `buildArchive`.
fn build_case_archive(
    given: &[Map<String, Value>],
    archive: Option<&Map<String, Value>>,
) -> Vec<u8> {
    let unsorted = archive
        .and_then(|a| a.get("unsorted"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut entries = given.to_vec();
    if !unsorted {
        entries.sort_by_key(entry_name);
    }
    let mut out = archive
        .and_then(|a| a.get("prefixHex"))
        .and_then(Value::as_str)
        .map(decode_hex)
        .unwrap_or_default();
    let mut centrals: Vec<u8> = Vec::new();
    let mut offset = out.len() as u32;

    for entry in &entries {
        let gap = entry
            .get("gapHex")
            .and_then(Value::as_str)
            .map(decode_hex)
            .unwrap_or_default();
        out.extend_from_slice(&gap);
        offset = offset.wrapping_add(gap.len() as u32);

        let data = entry_data(entry);
        let method = entry.get("method").and_then(Value::as_u64).unwrap_or(8) as u16;
        let body = if method == 8 {
            decode_hex(
                entry
                    .get("bodyHex")
                    .and_then(Value::as_str)
                    .expect("deflated case entry has bodyHex"),
            )
        } else {
            data.clone()
        };
        let name = entry_name(entry);
        let descriptor = entry.get("descriptor");
        let has_descriptor = matches!(descriptor, Some(Value::Bool(true)) | Some(Value::String(_)));
        let unsigned_descriptor = descriptor.and_then(Value::as_str) == Some("unsigned");
        let base_flags = entry.get("flags").and_then(Value::as_u64).unwrap_or(0x0800) as u16;
        let flags = base_flags | if has_descriptor { 0x0008 } else { 0 };
        let crc = entry
            .get("crc")
            .and_then(Value::as_u64)
            .map(|v| v as u32)
            .unwrap_or_else(|| crc32fast::hash(&data));
        let compressed = entry
            .get("compressed")
            .and_then(Value::as_u64)
            .map(|v| v as u32)
            .unwrap_or(body.len() as u32);
        let declared = entry
            .get("declared")
            .and_then(Value::as_u64)
            .map(|v| v as u32)
            .unwrap_or(data.len() as u32);
        let extra = entry
            .get("extraHex")
            .and_then(Value::as_str)
            .map(decode_hex)
            .unwrap_or_default();
        let comment = entry
            .get("commentHex")
            .and_then(Value::as_str)
            .map(decode_hex)
            .unwrap_or_default();
        let local = entry.get("local").and_then(Value::as_object);
        let local_name = local
            .and_then(|l| l.get("path"))
            .and_then(Value::as_str)
            .map(|s| s.as_bytes().to_vec())
            .unwrap_or_else(|| name.clone());
        let local_extra = local
            .and_then(|l| l.get("extraHex"))
            .and_then(Value::as_str)
            .map(decode_hex)
            .unwrap_or_default();
        let default_date = CANONICAL_DATE;
        let entry_vn = entry
            .get("versionNeeded")
            .and_then(Value::as_u64)
            .unwrap_or(20) as u16;
        let entry_time = entry.get("time").and_then(Value::as_u64).unwrap_or(0) as u16;
        let entry_date = entry
            .get("date")
            .and_then(Value::as_u64)
            .map(|v| v as u16)
            .unwrap_or(default_date);

        let l_vn = local
            .and_then(|l| l.get("versionNeeded"))
            .and_then(Value::as_u64)
            .map(|v| v as u16)
            .unwrap_or(entry_vn);
        let l_flags = local
            .and_then(|l| l.get("flags"))
            .and_then(Value::as_u64)
            .map(|v| v as u16)
            .unwrap_or(flags);
        let l_method = local
            .and_then(|l| l.get("method"))
            .and_then(Value::as_u64)
            .map(|v| v as u16)
            .unwrap_or(method);
        let l_time = local
            .and_then(|l| l.get("time"))
            .and_then(Value::as_u64)
            .map(|v| v as u16)
            .unwrap_or(entry_time);
        let l_date = local
            .and_then(|l| l.get("date"))
            .and_then(Value::as_u64)
            .map(|v| v as u16)
            .unwrap_or(entry_date);
        let l_crc = local
            .and_then(|l| l.get("crc"))
            .and_then(Value::as_u64)
            .map(|v| v as u32)
            .unwrap_or(if has_descriptor { 0 } else { crc });
        let l_comp = local
            .and_then(|l| l.get("compressed"))
            .and_then(Value::as_u64)
            .map(|v| v as u32)
            .unwrap_or(if has_descriptor { 0 } else { compressed });
        let l_decl = local
            .and_then(|l| l.get("declared"))
            .and_then(Value::as_u64)
            .map(|v| v as u32)
            .unwrap_or(if has_descriptor { 0 } else { declared });

        let local_start = out.len();
        out.extend_from_slice(&LOCAL_SIG.to_le_bytes());
        out.extend_from_slice(&l_vn.to_le_bytes());
        out.extend_from_slice(&l_flags.to_le_bytes());
        out.extend_from_slice(&l_method.to_le_bytes());
        out.extend_from_slice(&l_time.to_le_bytes());
        out.extend_from_slice(&l_date.to_le_bytes());
        out.extend_from_slice(&l_crc.to_le_bytes());
        out.extend_from_slice(&l_comp.to_le_bytes());
        out.extend_from_slice(&l_decl.to_le_bytes());
        out.extend_from_slice(&(local_name.len() as u16).to_le_bytes());
        out.extend_from_slice(&(local_extra.len() as u16).to_le_bytes());
        out.extend_from_slice(&local_name);
        out.extend_from_slice(&local_extra);
        out.extend_from_slice(&body);
        if has_descriptor {
            if !unsigned_descriptor {
                out.extend_from_slice(&0x0807_4b50u32.to_le_bytes());
            }
            let d_crc = entry
                .get("descriptorCrc")
                .and_then(Value::as_u64)
                .map(|v| v as u32)
                .unwrap_or(crc);
            out.extend_from_slice(&d_crc.to_le_bytes());
            out.extend_from_slice(&compressed.to_le_bytes());
            out.extend_from_slice(&declared.to_le_bytes());
        }
        let record_len = (out.len() - local_start) as u32;

        let made_by = ((entry.get("madeBy").and_then(Value::as_u64).unwrap_or(3) as u16) << 8)
            | (entry
                .get("madeByVersion")
                .and_then(Value::as_u64)
                .unwrap_or(20) as u16);
        let default_mode = if entry
            .get("executable")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            "100755"
        } else {
            "100644"
        };
        let mode_str = entry
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or(default_mode);
        let mode = u32::from_str_radix(mode_str, 8).unwrap();
        let dos_attr = entry
            .get("dosAttributes")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32;
        let external = (mode << 16).wrapping_add(dos_attr);
        let local_offset = entry
            .get("localOffset")
            .and_then(Value::as_u64)
            .map(|v| v as u32)
            .unwrap_or(offset);
        let disk = entry.get("disk").and_then(Value::as_u64).unwrap_or(0) as u16;
        let internal = entry.get("internal").and_then(Value::as_u64).unwrap_or(0) as u16;

        centrals.extend_from_slice(&CENTRAL_SIG.to_le_bytes());
        centrals.extend_from_slice(&made_by.to_le_bytes());
        centrals.extend_from_slice(&entry_vn.to_le_bytes());
        centrals.extend_from_slice(&flags.to_le_bytes());
        centrals.extend_from_slice(&method.to_le_bytes());
        centrals.extend_from_slice(&entry_time.to_le_bytes());
        centrals.extend_from_slice(&entry_date.to_le_bytes());
        centrals.extend_from_slice(&crc.to_le_bytes());
        centrals.extend_from_slice(&compressed.to_le_bytes());
        centrals.extend_from_slice(&declared.to_le_bytes());
        centrals.extend_from_slice(&(name.len() as u16).to_le_bytes());
        centrals.extend_from_slice(&(extra.len() as u16).to_le_bytes());
        centrals.extend_from_slice(&(comment.len() as u16).to_le_bytes());
        centrals.extend_from_slice(&disk.to_le_bytes());
        centrals.extend_from_slice(&internal.to_le_bytes());
        centrals.extend_from_slice(&external.to_le_bytes());
        centrals.extend_from_slice(&local_offset.to_le_bytes());
        centrals.extend_from_slice(&name);
        centrals.extend_from_slice(&extra);
        centrals.extend_from_slice(&comment);

        offset = offset.wrapping_add(record_len);
    }

    let before_dir = archive
        .and_then(|a| a.get("beforeDirectoryHex"))
        .and_then(Value::as_str)
        .map(decode_hex)
        .unwrap_or_default();
    out.extend_from_slice(&before_dir);
    offset = offset.wrapping_add(before_dir.len() as u32);

    let mut comment = archive
        .and_then(|a| a.get("commentHex"))
        .and_then(Value::as_str)
        .map(decode_hex)
        .unwrap_or_default();
    let comment_zeros = archive
        .and_then(|a| a.get("commentZeros"))
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    comment.extend(std::iter::repeat_n(0u8, comment_zeros));

    let count = archive
        .and_then(|a| a.get("count"))
        .and_then(Value::as_u64)
        .map(|v| v as u16)
        .unwrap_or(entries.len() as u16);
    let count_here = archive
        .and_then(|a| a.get("countHere"))
        .and_then(Value::as_u64)
        .map(|v| v as u16)
        .unwrap_or(count);
    let disk = archive
        .and_then(|a| a.get("disk"))
        .and_then(Value::as_u64)
        .unwrap_or(0) as u16;
    let dir_disk = archive
        .and_then(|a| a.get("directoryDisk"))
        .and_then(Value::as_u64)
        .unwrap_or(0) as u16;
    let size_delta = archive
        .and_then(|a| a.get("sizeDelta"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let dir_size = (centrals.len() as i64 + size_delta) as u32;
    let dir_offset = archive
        .and_then(|a| a.get("offset"))
        .and_then(Value::as_u64)
        .map(|v| v as u32)
        .unwrap_or(offset);

    out.extend_from_slice(&centrals);
    out.extend_from_slice(&EOCD_SIG.to_le_bytes());
    out.extend_from_slice(&disk.to_le_bytes());
    out.extend_from_slice(&dir_disk.to_le_bytes());
    out.extend_from_slice(&count_here.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&dir_size.to_le_bytes());
    out.extend_from_slice(&dir_offset.to_le_bytes());
    out.extend_from_slice(&(comment.len() as u16).to_le_bytes());
    out.extend_from_slice(&comment);
    if let Some(trailing) = archive
        .and_then(|a| a.get("trailingHex"))
        .and_then(Value::as_str)
    {
        out.extend_from_slice(&decode_hex(trailing));
    }
    out
}

#[test]
fn p5_s9_2_unicode_version_and_archive_allowance_match_amendment() {
    // Amendment 4.4 rule 3: pin the exact Unicode version Rust 1.100.0's case mappings follow.
    assert_eq!(char::UNICODE_VERSION, (18, 0, 0));
    assert_eq!(archive_allowance(BundleLimits::default()), 3_319_950);
    assert_eq!(
        fold_bundle_path("apps/sketch/ẞ.js"),
        fold_bundle_path("apps/sketch/ß.js")
    );
    assert_eq!(
        fold_bundle_path("apps/sketch/ſ.js"),
        fold_bundle_path("apps/sketch/s.js")
    );
    assert_eq!(
        fold_bundle_path("apps/sketch/aΣ.js"),
        fold_bundle_path("apps/sketch/aσ.js")
    );
    assert!(says_shell_name("Loam Mail"));
    assert!(says_shell_name("Lo\u{200B}am"));
    assert!(says_shell_name("Loam_Notes"));
    assert!(!says_shell_name("Loamy"));
    assert!(!says_shell_name("Loam2"));
    assert!(bundle_path_problem("apps/mail").is_none());
    assert!(bundle_path_problem("apps/con .txt").is_some());
    assert!(bundle_path_problem("apps/COM\u{00b9}").is_some());
}

#[test]
fn p5_s9_2_shared_manifest_cases_valid_refused_app_cases_and_bundle_digest() {
    let cases = cases_json();
    let base = &cases["base"];

    // 1. All valid manifest cases.
    let valid = cases["valid"].as_array().unwrap();
    assert!(!valid.is_empty());
    for entry in valid {
        let name = entry["name"].as_str().unwrap();
        let doc = merge_patch(base, &entry["patch"]);
        let bytes = serde_json::to_vec(&doc).unwrap();
        let res = validate_plugin_manifest(&bytes);
        assert!(
            res.is_ok(),
            "expected valid manifest `{name}`, got: {res:?}"
        );
    }

    // 2. All 60 refused manifest cases with exact (code, key) parity.
    let refused = cases["refused"].as_array().unwrap();
    assert!(refused.len() >= 60);
    for entry in refused {
        let name = entry["name"].as_str().unwrap();
        let doc = merge_patch(base, &entry["patch"]);
        let bytes = serde_json::to_vec(&doc).unwrap();
        let err = validate_plugin_manifest(&bytes)
            .expect_err(&format!("expected refused manifest `{name}`"));
        assert_eq!(
            sorted_code_keys(&err),
            expected_code_keys(entry["refusals"].as_array().unwrap()),
            "manifest case `{name}`"
        );
    }

    // 3. All 9 appCases with exact (code, key) parity.
    let app_cases = cases["appCases"].as_array().unwrap();
    assert!(app_cases.len() >= 9);
    for entry in app_cases {
        let name = entry["name"].as_str().unwrap();
        let doc = merge_patch(base, &entry["patch"]);
        let bytes = serde_json::to_vec(&doc).unwrap();
        let (manifest, _) = validate_plugin_manifest(&bytes)
            .unwrap_or_else(|e| panic!("appCase `{name}` manifest failed: {e:?}"));
        let mut apps = HashMap::new();
        for (app_id, app_val) in entry["apps"].as_object().unwrap() {
            let plugin = &app_val["plugin"];
            let mount = app_val.get("mount");
            let id = plugin["id"].as_str().unwrap().to_owned();
            let kind = plugin["kind"].as_str().unwrap().to_owned();
            let mount_prefix = mount
                .and_then(|m| m.get("prefix"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            let full = serde_json::json!({
                "manifest_version": 1,
                "protocol": 1,
                "plugin": {
                    "id": id,
                    "title": "App",
                    "version": "0.1.0",
                    "description": "App.",
                    "kind": kind,
                    "domains": [mount_prefix.clone().unwrap_or_else(|| id.clone())],
                },
                "mount": mount,
            });
            let mut full_map = full.as_object().unwrap().clone();
            if mount.is_none() {
                full_map.remove("mount");
            }
            if kind == "native" {
                full_map.insert(
                    "native".to_owned(),
                    serde_json::json!({ "entry": "dist/entry.js" }),
                );
            }
            let parsed =
                parse_packed_app_manifest(&serde_json::to_vec(&full_map).unwrap()).unwrap();
            apps.insert(app_id.clone(), parsed);
        }
        let got = validate_plugin_apps(&manifest, &apps);
        assert_eq!(
            sorted_code_keys(&got),
            expected_code_keys(entry["refusals"].as_array().unwrap()),
            "appCase `{name}`"
        );
    }

    // 4. Shared bundleDigest vector (amendment 7.1).
    let bd = &cases["bundleDigest"];
    let files: Vec<(String, String)> = bd["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| {
            (
                f["path"].as_str().unwrap().to_owned(),
                f["sha256"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(bundle_digest(&files), bd["digest"].as_str().unwrap());
}

#[test]
fn p5_s9_2_all_shared_archive_cases_valid_and_refused_match_sha256_code_key_and_reason() {
    let cases = cases_json();
    let archives = &cases["archives"];
    let tmp = tempfile::tempdir().unwrap();

    // All 5 valid archives.
    let valid = archives["valid"].as_array().unwrap();
    assert_eq!(valid.len(), 5);
    for (idx, entry) in valid.iter().enumerate() {
        let name = entry["name"].as_str().unwrap();
        let entries = archive_entries_of(entry, archives);
        let bytes = build_case_archive(&entries, entry.get("archive").and_then(Value::as_object));
        assert_eq!(
            sha256_hex(&bytes),
            entry["sha256"].as_str().unwrap(),
            "valid archive `{name}` SHA-256 mismatch"
        );
        let archive_path = tmp.path().join(format!("valid-{idx}.loam-plugin"));
        std::fs::write(&archive_path, &bytes).unwrap();
        let staging = tmp.path().join(format!("stage-valid-{idx}"));
        let staged = stage_and_validate_archive(&archive_path, &staging, BundleLimits::default())
            .unwrap_or_else(|e| panic!("valid archive `{name}` refused: {e:?}"));
        assert_eq!(staged.bundle_sha256.len(), 64);
    }

    // All 109 refused archives: exact (code, key, reason) parity!
    let refused = archives["refused"].as_array().unwrap();
    assert!(refused.len() >= 108);
    for (idx, entry) in refused.iter().enumerate() {
        let name = entry["name"].as_str().unwrap();
        let entries = archive_entries_of(entry, archives);
        let bytes = build_case_archive(&entries, entry.get("archive").and_then(Value::as_object));
        assert_eq!(
            sha256_hex(&bytes),
            entry["sha256"].as_str().unwrap(),
            "refused archive `{name}` SHA-256 mismatch"
        );
        let archive_path = tmp.path().join(format!("refused-{idx}.loam-plugin"));
        std::fs::write(&archive_path, &bytes).unwrap();
        let staging = tmp.path().join(format!("stage-refused-{idx}"));
        let err = stage_and_validate_archive(&archive_path, &staging, BundleLimits::default())
            .expect_err(&format!("refused archive `{name}` unexpectedly passed"));
        assert_eq!(
            sorted_code_key_reasons(&err),
            expected_code_key_reasons(entry["refusals"].as_array().unwrap()),
            "refused archive `{name}`"
        );
    }
}

#[cfg(unix)]
#[test]
fn p5_s9_2_directory_staging_refuses_symlinks_and_strips_exec_bits() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let src = tmp.path().join("bundle");
    std::fs::create_dir_all(src.join("apps/sketch")).unwrap();
    std::fs::write(
        src.join("plugin-manifest.json"),
        br#"{"plugin_manifest_version":1,"plugin":{"id":"sketch","title":"Sketch","version":"1.0.0","description":"Draw."},"apps":[{"id":"sketch","path":"apps/sketch"}]}"#,
    )
    .unwrap();
    std::fs::write(
        src.join("apps/sketch/app-manifest.json"),
        br#"{"manifest_version":1,"protocol":1,"plugin":{"id":"sketch","title":"Sketch","version":"1.0.0","description":"Draw.","kind":"view","domains":["sketch"]},"view":{}}"#,
    )
    .unwrap();
    let app_file = src.join("apps/sketch/index.html");
    std::fs::write(&app_file, b"<!doctype html>").unwrap();
    std::fs::set_permissions(&app_file, std::fs::Permissions::from_mode(0o755)).unwrap();

    // Valid directory stages cleanly and strips world/group/exec bits down to 0600.
    let staging = tmp.path().join("stage-ok");
    let staged = stage_and_validate_directory(&src, &staging, BundleLimits::default()).unwrap();
    assert_eq!(staged.manifest.plugin.id, "sketch");
    let staged_mode = std::fs::metadata(staging.join("apps/sketch/index.html"))
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(staged_mode, 0o600);

    // Planting a symlink inside the directory bundle is refused with PLUGIN_PATH_ESCAPE.
    std::os::unix::fs::symlink(tmp.path(), src.join("apps/sketch/escape")).unwrap();
    let staging2 = tmp.path().join("stage-sym");
    let err = stage_and_validate_directory(&src, &staging2, BundleLimits::default()).unwrap_err();
    assert_eq!(err[0].code, PLUGIN_PATH_ESCAPE);
    assert_eq!(err[0].reason, "not-regular");
}
