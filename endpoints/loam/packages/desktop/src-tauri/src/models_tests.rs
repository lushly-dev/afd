use super::*;

fn anthropic() -> Value {
    // As TanStack's Anthropic adapter sent it, captured for step 2: cache hints, a custom tool, a tool round.
    json!({
        "model": "m-1",
        "max_tokens": 100,
        "messages": [
            { "role": "user", "content": "earlier" },
            { "role": "assistant", "content": [{ "type": "text", "text": "ok" }] },
            { "role": "user", "content": "hi" },
            { "role": "assistant", "content": [{ "type": "tool_use", "id": "tu1", "name": "note-list", "input": { "limit": 2 } }] },
            { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "tu1", "content": "two notes", "cache_control": { "type": "ephemeral" } }] }
        ],
        "system": [{ "type": "text", "text": "SYS", "cache_control": { "type": "ephemeral" } }],
        "tools": [{
            "name": "note-list", "type": "custom", "description": "Lists",
            "input_schema": { "type": "object", "properties": { "limit": { "type": "number" } }, "required": null },
            "cache_control": { "type": "ephemeral" }
        }],
        "stream": true
    })
}

fn openai() -> Value {
    // As TanStack's Chat Completions adapter sent it, captured for step 2.
    json!({
        "prompt_cache_key": "cps_0123456789abcdef",
        "max_tokens": 100,
        "model": "m-1",
        "messages": [
            { "role": "system", "content": "SYS" },
            { "role": "user", "content": "hi" },
            { "role": "assistant", "content": null, "tool_calls": [{ "id": "call1", "type": "function", "function": { "name": "note-list", "arguments": "{\"limit\":2}" } }] },
            { "role": "tool", "tool_call_id": "call1", "content": "two notes" }
        ],
        "tools": [{ "type": "function", "function": {
            "name": "note-list", "description": "Lists",
            "parameters": { "type": "object", "properties": { "limit": { "type": ["number", "null"] } }, "required": ["limit"], "additionalProperties": false },
            "strict": true
        } }],
        "stream": true,
        "stream_options": { "include_usage": true }
    })
}

fn sent(kind: Kind, body: Value) -> Result<Value, &'static str> {
    checked_body(kind, "configured-model", body)
        .map(|bytes| serde_json::from_slice(&bytes).unwrap())
}

#[test]
fn p5_a3_the_adapters_bodies_pass_with_the_configured_model_set() {
    let body = sent(Kind::Anthropic, anthropic()).unwrap();
    assert_eq!(body["model"], "configured-model");
    assert_eq!(body["messages"], anthropic()["messages"]);
    for kind in [Kind::Openai, Kind::OpenaiCompatible] {
        assert_eq!(sent(kind, openai()).unwrap()["model"], "configured-model");
    }
    // A body naming another model, or none, gets the configured one.
    let mut other = anthropic();
    other.as_object_mut().unwrap().remove("model");
    assert_eq!(
        sent(Kind::Anthropic, other).unwrap()["model"],
        "configured-model"
    );
}

fn with(mut body: Value, pointer: &str, value: Value) -> Value {
    let (parent, key) = pointer.rsplit_once('/').unwrap();
    let target = if parent.is_empty() {
        &mut body
    } else {
        body.pointer_mut(parent).unwrap()
    };
    match target {
        Value::Object(map) => {
            map.insert(key.to_owned(), value);
        }
        Value::Array(items) => items.push(value),
        _ => panic!("{pointer}"),
    }
    body
}

#[test]
fn p5_a3_anthropic_refuses_provider_tools_mcp_servers_urls_unlisted_keys_and_other_cache_control() {
    let refused = [
        with(
            anthropic(),
            "/tools/x",
            json!({ "type": "web_search_20250305", "name": "web_search" }),
        ),
        with(
            anthropic(),
            "/tools/x",
            json!({ "type": "code_execution_20250522", "name": "code_execution" }),
        ),
        with(
            anthropic(),
            "/tools/x",
            json!({ "type": "computer_20250124", "name": "computer", "display_width_px": 1, "display_height_px": 1 }),
        ),
        with(
            anthropic(),
            "/mcp_servers",
            json!([{ "type": "url", "url": "https://evil.example/mcp", "name": "x" }]),
        ),
        with(anthropic(), "/container", json!("container_1")),
        with(anthropic(), "/metadata", json!({ "user_id": "x" })),
        with(
            anthropic(),
            "/thinking",
            json!({ "type": "enabled", "budget_tokens": 1024 }),
        ),
        with(anthropic(), "/top_k", json!(5)),
        with(
            anthropic(),
            "/system/0/cache_control",
            json!({ "type": "ephemeral", "ttl": "1h" }),
        ),
        with(
            anthropic(),
            "/tools/0/cache_control",
            json!({ "type": "persistent" }),
        ),
        with(
            anthropic(),
            "/messages/1/content/x",
            json!({ "type": "image", "source": { "type": "url", "url": "https://evil.example/a.png" } }),
        ),
        with(
            anthropic(),
            "/messages/1/content/x",
            json!({ "type": "document", "source": { "type": "url", "url": "https://evil.example/a.pdf" } }),
        ),
        with(
            anthropic(),
            "/messages/1/content/x",
            json!({ "type": "container_upload", "file_id": "f" }),
        ),
        with(anthropic(), "/messages/0/role", json!("system")),
        with(anthropic(), "/tools/0/type", json!("bash_20250124")),
        with(anthropic(), "/max_tokens", json!(OUTPUT_TOKENS_MAX + 1)),
        with(anthropic(), "/max_tokens", json!("100")),
        with(
            anthropic(),
            "/tool_choice",
            json!({ "type": "auto", "name": "x" }),
        ),
    ];
    for body in refused {
        assert_eq!(
            sent(Kind::Anthropic, body.clone()).err(),
            Some(BODY_REFUSED),
            "{body}"
        );
    }
    let mut missing = anthropic();
    missing.as_object_mut().unwrap().remove("max_tokens");
    assert_eq!(sent(Kind::Anthropic, missing).err(), Some(BODY_REFUSED));
    // `type: "custom"` and a tool with no type at all are function tools, allowed.
    let mut untyped = anthropic();
    untyped["tools"][0].as_object_mut().unwrap().remove("type");
    assert!(sent(Kind::Anthropic, untyped).is_ok());
    assert!(sent(Kind::Anthropic, json!([anthropic()])).is_err());
}

#[test]
fn p5_a3_chat_completions_refuses_web_search_audio_files_and_unlisted_keys() {
    let refused = [
        with(openai(), "/web_search_options", json!({})),
        with(
            openai(),
            "/audio",
            json!({ "voice": "alloy", "format": "wav" }),
        ),
        with(openai(), "/modalities", json!(["text", "audio"])),
        with(
            openai(),
            "/response_format",
            json!({ "type": "json_object" }),
        ),
        with(openai(), "/user", json!("someone")),
        with(openai(), "/store", json!(true)),
        with(openai(), "/n", json!(2)),
        with(openai(), "/prompt_cache_key", json!("x".repeat(65))),
        with(
            openai(),
            "/messages/x",
            json!({ "role": "user", "content": [{ "type": "image_url", "image_url": { "url": "https://evil.example/a.png" } }] }),
        ),
        with(
            openai(),
            "/messages/x",
            json!({ "role": "user", "content": [{ "type": "file", "file": { "file_id": "f" } }] }),
        ),
        with(
            openai(),
            "/tools/x",
            json!({ "type": "web_search_preview" }),
        ),
        with(openai(), "/tools/0/function/x", json!("unlisted")),
        with(openai(), "/messages/0/role", json!("function")),
        with(openai(), "/max_completion_tokens", json!(10)),
    ];
    for body in refused {
        assert_eq!(
            sent(Kind::Openai, body.clone()).err(),
            Some(BODY_REFUSED),
            "{body}"
        );
    }
}

#[test]
fn p5_a3_each_kind_builds_its_own_request_with_its_key_header_alone() {
    let provider = |kind, endpoint: Option<&str>| Provider {
        id: "p".into(),
        kind,
        model: "m".into(),
        endpoint: endpoint.map(str::to_owned),
        key: None,
    };
    let (url, headers) = request_parts(&provider(Kind::Anthropic, None), Some("k")).unwrap();
    assert_eq!(url, ANTHROPIC_URL);
    assert_eq!(
        headers,
        vec![
            ("x-api-key", "k".to_owned()),
            ("anthropic-version", ANTHROPIC_VERSION.to_owned())
        ]
    );
    let (url, headers) = request_parts(&provider(Kind::Openai, None), Some("k")).unwrap();
    assert_eq!(url, OPENAI_URL);
    assert_eq!(headers, vec![("authorization", "Bearer k".to_owned())]);
    let local = provider(Kind::OpenaiCompatible, Some("http://127.0.0.1:11434/v1/"));
    let (url, headers) = request_parts(&local, None).unwrap();
    assert_eq!(url, "http://127.0.0.1:11434/v1/chat/completions");
    assert!(headers.is_empty());
    assert_eq!(
        request_parts(&provider(Kind::Anthropic, None), None).err(),
        Some(KEY_MISSING)
    );
    let elsewhere = provider(Kind::OpenaiCompatible, Some("http://10.0.0.1/v1"));
    assert_eq!(request_parts(&elsewhere, None).err(), Some(MODELS_INVALID));
}

#[test]
fn an_endpoint_is_https_or_loopback_http() {
    for allowed in [
        "https://models.example.com/v1",
        "http://127.0.0.1:11434/v1",
        "http://[::1]:8080/v1",
    ] {
        assert!(endpoint_allowed(allowed), "{allowed}");
    }
    for refused in [
        "http://localhost:11434/v1",
        "http://10.0.0.1/v1",
        "https://user:pass@example.com/v1",
        "https://example.com/v1?x=1",
        "https://example.com/v1#x",
        "file:///etc/passwd",
        "ftp://127.0.0.1/",
    ] {
        assert!(!endpoint_allowed(refused), "{refused}");
    }
}

#[test]
fn text_is_split_on_character_boundaries_and_an_incomplete_one_waits() {
    let mut bytes = "héllo".as_bytes().to_vec();
    let tail = bytes.split_off(2);
    let mut pending = bytes;
    assert_eq!(take_text(&mut pending), "h");
    pending.extend_from_slice(&tail);
    assert_eq!(take_text(&mut pending), "éllo");
    assert!(pending.is_empty());
}

#[test]
fn a_key_is_shaped_as_one() {
    assert!(key_shaped("sk-ant-api03-abcdefgh"));
    for refused in [
        "short",
        "has space here",
        "quote\"inside",
        "back\\slash1",
        "new\nline12",
    ] {
        assert!(!key_shaped(refused), "{refused:?}");
    }
}

#[cfg(unix)]
fn restrict(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
}

#[cfg(windows)]
fn restrict(path: &Path) {
    let system = Path::new(&std::env::var_os("SystemRoot").unwrap()).join("System32");
    let user = std::process::Command::new(system.join("whoami.exe"))
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .unwrap();
    let sid = String::from_utf8(user.stdout)
        .unwrap()
        .trim()
        .rsplit(',')
        .next()
        .unwrap()
        .trim_matches('"')
        .to_owned();
    let icacls = system.join("icacls.exe");
    let reset = std::process::Command::new(&icacls)
        .arg(path)
        .arg("/reset")
        .stdout(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(reset.success());
    let status = std::process::Command::new(&icacls)
        .arg(path)
        .args(["/inheritance:r", "/grant:r"])
        .arg(format!("*{sid}:F"))
        .stdout(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());
    let owner = std::process::Command::new(&icacls)
        .arg(path)
        .args(["/setowner", &format!("*{sid}")])
        .stdout(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(owner.success());
}

#[test]
fn p5_a3_models_json_is_read_strictly_and_refused_unless_owner_only() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("models.json");
    assert!(read(&path).unwrap().is_empty());
    let file = |text: &str| {
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, text).unwrap();
        restrict(&path);
        read(&path)
    };
    let good = r#"{"providers":[
        {"id":"claude","kind":"anthropic","model":"claude-sonnet-4-5","key":{"keychain":"loam-copilot","account":"claude"}},
        {"id":"local","kind":"openai-compatible","model":"llama3.1:8b","endpoint":"http://127.0.0.1:11434/v1"}
    ]}"#;
    assert_eq!(file(good).unwrap().len(), 2);
    for bad in [
        r#"{"providers":[{"id":"x","kind":"anthropic","model":"m"}]}"#,
        r#"{"providers":[{"id":"x","kind":"anthropic","model":"m","key":{"keychain":"a","account":"b"},"endpoint":"https://e.example"}]}"#,
        r#"{"providers":[{"id":"x","kind":"openai-compatible","model":"m","endpoint":"http://10.0.0.1/v1"}]}"#,
        r#"{"providers":[{"id":"x","kind":"openai","model":"m","key":{"file":"relative.key"}}]}"#,
        r#"{"providers":[{"id":"x","kind":"openai","model":"m","key":"sk-the-key-itself"}]}"#,
        r#"{"providers":[{"id":"x","kind":"test","model":"m"}]}"#,
        r#"{"providers":[],"extra":1}"#,
    ] {
        assert_eq!(file(bad).err(), Some(MODELS_INVALID), "{bad}");
    }
    // Readable by others: refused.
    let _ = std::fs::remove_file(&path);
    std::fs::write(&path, good).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    }
    assert_eq!(read(&path).err(), Some(PERMISSIONS));
}

#[test]
fn p5_a3_a_key_file_must_be_owner_only_and_hold_a_key() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("k.key");
    std::fs::write(&path, "sk-a-file-key-0123\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    }
    let reference = KeyRef::File(FileRef { file: path.clone() });
    assert_eq!(resolve_key(&reference).err(), Some(PERMISSIONS));
    restrict(&path);
    assert_eq!(resolve_key(&reference).unwrap(), "sk-a-file-key-0123");
    let _ = std::fs::remove_file(&path);
    std::fs::write(&path, "two words").unwrap();
    restrict(&path);
    assert_eq!(resolve_key(&reference).err(), Some(KEY_MISSING));
    let absent = KeyRef::Keychain(KeychainRef {
        keychain: "loam-copilot-test-absent".into(),
        account: "nobody-0000".into(),
    });
    assert_eq!(resolve_key(&absent).err(), Some(KEY_MISSING));
}

#[tokio::test]
async fn p5_a3_an_unknown_provider_a_refused_file_and_a_refused_body_send_nothing() {
    let sent = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = sent.clone();
    let emit: Emit = Arc::new(move |event| seen.lock().unwrap().push(event));
    let none = Models::new(Ok(Vec::new()));
    assert_eq!(
        none.send("claude", anthropic(), 7, emit.clone())
            .await
            .err(),
        Some(PROVIDER_UNKNOWN)
    );
    let refused = Models::new(Err(PERMISSIONS));
    assert_eq!(
        refused
            .send("claude", anthropic(), 7, emit.clone())
            .await
            .err(),
        Some(PERMISSIONS)
    );
    let keyless = Models::new(Ok(vec![Provider {
        id: "claude".into(),
        kind: Kind::Anthropic,
        model: "m".into(),
        endpoint: None,
        key: Some(KeyRef::Keychain(KeychainRef {
            keychain: "loam-copilot-test-absent".into(),
            account: "nobody-0000".into(),
        })),
    }]));
    assert_eq!(
        keyless
            .send(
                "claude",
                with(anthropic(), "/mcp_servers", json!([])),
                7,
                emit.clone()
            )
            .await
            .err(),
        Some(BODY_REFUSED)
    );
    assert_eq!(
        keyless
            .send("claude", anthropic(), 7, emit.clone())
            .await
            .err(),
        Some(KEY_MISSING)
    );
    // The slot held through the key's lookup was released: the id can be named again.
    assert_eq!(
        keyless.send("claude", anthropic(), 7, emit).await.err(),
        Some(KEY_MISSING)
    );
    assert!(sent.lock().unwrap().is_empty());
}

/// A provider on 127.0.0.1 that answers every request with `response`, raw.
async fn provider_answering(response: &'static str) -> u16 {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let mut buffer = vec![0u8; 65536];
            let _ = socket.read(&mut buffer).await;
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.shutdown().await;
        }
    });
    port
}

#[tokio::test]
async fn p5_a3_a_refusal_passes_no_body_on_since_it_can_quote_the_key() {
    let port = provider_answering(
        "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: 64\r\n\r\n{\"error\":\"Incorrect API key provided: sk-ab****************wxyz\"}",
    )
    .await;
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = events.clone();
    let emit: Emit = Arc::new(move |event| seen.lock().unwrap().push(event));
    let models = Models::new(Ok(vec![Provider {
        id: "local".into(),
        kind: Kind::OpenaiCompatible,
        model: "m".into(),
        endpoint: Some(format!("http://127.0.0.1:{port}/v1")),
        key: None,
    }]));
    let stream = models.send("local", openai(), 41, emit).await.unwrap();
    for _ in 0..200 {
        if events
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["done"] == true)
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            json!({ "stream": stream, "status": 401 }),
            json!({ "stream": stream, "done": true, "status": 401, "code": REFUSED }),
        ]
    );
}

#[test]
fn p5_a3_two_tools_from_the_anthropic_adapter_pass_its_null_cache_markers_dropped() {
    // As TanStack's adapter sends two tools: only the last is marked, the first carries `cache_control: null`.
    let mut body = anthropic();
    let first = json!({
        "name": "note-get", "type": "custom", "description": "Gets",
        "input_schema": { "type": "object", "properties": {} },
        "cache_control": null
    });
    body["tools"].as_array_mut().unwrap().insert(0, first);
    body["system"][0]["cache_control"] = Value::Null;
    body["messages"][1]["content"][0]["cache_control"] = Value::Null;
    let sent = sent(Kind::Anthropic, body).unwrap();
    assert!(sent["tools"][0].get("cache_control").is_none());
    assert_eq!(
        sent["tools"][1]["cache_control"],
        json!({ "type": "ephemeral" })
    );
    assert!(sent["system"][0].get("cache_control").is_none());
    // Any other value is still the allow-list's to refuse.
    assert_eq!(
        sent_err(with(
            anthropic(),
            "/tools/0/cache_control",
            json!({ "type": "other" })
        )),
        Some(BODY_REFUSED)
    );
}

fn sent_err(body: Value) -> Option<&'static str> {
    checked_body(Kind::Anthropic, "m", body).err()
}

#[test]
fn p5_a3_every_request_streams_and_a_chat_completion_reports_its_usage() {
    let mut quiet = openai();
    quiet["stream"] = json!(false);
    quiet["stream_options"] = json!({ "include_usage": false });
    let sent = sent(Kind::OpenaiCompatible, quiet).unwrap();
    assert_eq!(sent["stream"], true);
    assert_eq!(sent["stream_options"], json!({ "include_usage": true }));
    let mut anthropic_quiet = anthropic();
    anthropic_quiet.as_object_mut().unwrap().remove("stream");
    let sent = super::checked_body(Kind::Anthropic, "m", anthropic_quiet)
        .map(|bytes| serde_json::from_slice::<Value>(&bytes).unwrap())
        .unwrap();
    assert_eq!(sent["stream"], true);
    assert!(sent.get("stream_options").is_none());
}

#[test]
fn p5_a3_a_key_quoted_in_an_accepted_stream_is_removed_across_chunks() {
    let key = "sk-test-0123456789abcdef";
    let mut redactor = Redactor::new(Some(key));
    let mut out = String::new();
    // The key split across three chunks, and quoted twice.
    for part in [
        "data: {\"error\":\"bad sk-test-01",
        "23456789ab",
        "cdef\"} and sk-test-0123456789abcdef é",
    ] {
        out.push_str(&redactor.take(part));
    }
    out.push_str(&redactor.finish(""));
    assert!(!out.contains(key), "{out}");
    assert!(!out.contains("0123456789"), "{out}");
    assert_eq!(out.matches(KEY_REMOVED).count(), 2);
    assert!(out.ends_with(" é"));
    let mut plain = Redactor::new(None);
    let mut both = plain.take("as ");
    both.push_str(&plain.take("is"));
    both.push_str(&plain.finish(""));
    assert_eq!(both, "as is");
}

#[test]
fn p5_a3_a_key_is_removed_as_json_may_escape_it_and_no_chunk_measures_it() {
    let key = "sk/test&0123456789<x>";
    let mut redactor = Redactor::new(Some(key));
    let mut chunks = Vec::new();
    for part in [
        "quoted sk\\/test\\u00260123456789\\u003cx\\u003e and ",
        "sk/test&0123456789<x>",
        " and sk\\/test&0123456789<x> done, with more text after it",
    ] {
        chunks.push(redactor.take(part));
    }
    // As `run` ends: `finish` with the stream's last undecoded bytes, which are none here.
    chunks.push(redactor.finish(""));
    let out = chunks.concat();
    assert!(!out.contains("0123456789"), "{out}");
    assert_eq!(out.matches(KEY_REMOVED).count(), 3);
    // The last chunk is the last clean piece and the tail together, not a tail the key's length long.
    assert_ne!(chunks.last().map(String::len), Some(key.len() - 1));
}

#[tokio::test]
async fn p5_a3_a_page_names_its_stream_and_a_page_load_silences_it() {
    let port = provider_answering(
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\ncontent-length: 14\r\n\r\ndata: [DONE]\n\n",
    )
    .await;
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = events.clone();
    let emit: Emit = Arc::new(move |event| seen.lock().unwrap().push(event));
    let local = |port: u16| Provider {
        id: "local".into(),
        kind: Kind::OpenaiCompatible,
        model: "m".into(),
        endpoint: Some(format!("http://127.0.0.1:{port}/v1")),
        key: None,
    };
    let models = Models::new(Ok(vec![local(port)]));
    // Ids out of JavaScript's safe integers, and zero, are refused.
    for id in [0, STREAM_ID_MAX + 1] {
        assert_eq!(
            models.send("local", openai(), id, emit.clone()).await.err(),
            Some(BODY_REFUSED)
        );
    }
    assert_eq!(
        models.send("local", openai(), 900, emit.clone()).await,
        Ok(900)
    );
    for _ in 0..200 {
        if events
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["done"] == true)
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(
        events
            .lock()
            .unwrap()
            .iter()
            .all(|event| event["stream"] == 900)
    );
    assert!(
        events
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["done"] == true)
    );
    // A stream of the page that left emits nothing more.
    let silent = Models::new(Ok(vec![local(port)]));
    events.lock().unwrap().clear();
    silent
        .send("local", openai(), 901, emit.clone())
        .await
        .unwrap();
    silent.leave_page();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        events.lock().unwrap().is_empty(),
        "{:?}",
        events.lock().unwrap()
    );
}

#[tokio::test]
async fn p5_a3_an_id_in_use_is_refused_and_the_bound_counts_held_slots() {
    let models = Models::new(Ok(Vec::new()));
    models.streams.lock().await.insert(5, Slot::Reserved);
    let emit: Emit = Arc::new(|_| {});
    // An unknown provider is refused first; a known one meets the slot.
    let local = Models::new(Ok(vec![Provider {
        id: "local".into(),
        kind: Kind::OpenaiCompatible,
        model: "m".into(),
        endpoint: Some("http://127.0.0.1:9/v1".into()),
        key: None,
    }]));
    local.streams.lock().await.insert(5, Slot::Reserved);
    assert_eq!(
        local.send("local", openai(), 5, emit.clone()).await.err(),
        Some(STREAM_LIMIT)
    );
    for id in 100..(100 + STREAMS_MAX as u64) {
        local.streams.lock().await.insert(id, Slot::Reserved);
    }
    assert_eq!(
        local.send("local", openai(), 6, emit).await.err(),
        Some(STREAM_LIMIT)
    );
    assert!(models.streams.lock().await.contains_key(&5));
}

#[test]
fn p5_a3_an_empty_last_chunk_keeps_the_stream_from_ending_on_the_tail_alone() {
    // HTTP/2 commonly closes a stream with an empty DATA frame: \`run\` then takes "" before it finishes.
    let key = "sk-ant-api03-abcdefghijklmnop";
    let mut redactor = Redactor::new(Some(key));
    let mut chunks = vec![
        redactor.take("data: {\"text\":\"a long enough answer, well past the key\"}\n\n"),
        redactor.take(""),
    ];
    chunks.push(redactor.finish(""));
    assert_eq!(
        chunks.concat(),
        "data: {\"text\":\"a long enough answer, well past the key\"}\n\n"
    );
    assert_ne!(chunks.last().map(String::len), Some(key.len() - 1));
}

#[tokio::test]
async fn p5_a3_run_removes_a_quoted_key_and_ends_on_no_chunk_the_tail_alone() {
    // A provider that accepts the request, quotes the key, and ends; as `run` streams it, not the redactor alone.
    let key = "sk-ant-api03-abcdefghijklmnop";
    let body = "data: {\"type\":\"error\",\"message\":\"key sk-ant-api03-abcdefghijklmnop refused\"}\n\ndata: [DONE]\n\n";
    let response: &'static str = Box::leak(
        format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\ncontent-length: {}\r\n\r\n{body}",
            body.len()
        )
        .into_boxed_str(),
    );
    let port = provider_answering(response).await;
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = events.clone();
    let emit: Emit = Arc::new(move |event| seen.lock().unwrap().push(event));
    let request =
        reqwest::Client::new().post(format!("http://127.0.0.1:{port}/v1/chat/completions"));
    run(3, request, &emit, Some(key)).await;
    let events = events.lock().unwrap();
    let chunks: Vec<&str> = events
        .iter()
        .filter_map(|event| event["chunk"].as_str())
        .collect();
    let text = chunks.concat();
    assert_eq!(text, body.replace(key, KEY_REMOVED));
    assert_ne!(chunks.last().map(|chunk| chunk.len()), Some(key.len() - 1));
    assert_eq!(events.last().unwrap()["done"], true);
}

#[test]
fn p5_a3_a_missing_key_file_is_a_missing_key() {
    let dir = tempfile::tempdir().unwrap();
    let reference = KeyRef::File(FileRef {
        file: dir.path().join("absent.key"),
    });
    assert_eq!(resolve_key(&reference).err(), Some(KEY_MISSING));
}

#[cfg(unix)]
#[test]
fn p5_a3_a_key_file_reached_through_a_link_is_refused() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let real = dir.path().join("real.key");
    std::fs::write(&real, "sk-a-file-key-0123").unwrap();
    std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o600)).unwrap();
    let link = dir.path().join("link.key");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let reference = KeyRef::File(FileRef { file: link });
    assert_eq!(resolve_key(&reference).err(), Some(PERMISSIONS));
}

#[test]
fn an_event_is_one_inert_statement() {
    let script = event_script(&json!({ "stream": 1, "chunk": "</script><b>\u{2028}" }));
    assert!(script.starts_with("window.dispatchEvent(new CustomEvent('loam:model',{detail:"));
    for forbidden in ['<', '>', '\u{2028}'] {
        assert!(!script.contains(forbidden), "{forbidden:?}");
    }
}

#[tokio::test]
async fn p5_s9_6_singleton_models_config_swap_preserves_active_cancelable_streams() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // Start a loopback HTTP server whose first stream stays open until cancelled, and whose
    // second connection completes immediately.
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let (first_connected_tx, first_connected_rx) = tokio::sync::oneshot::channel::<()>();
    let (disconnected_tx, disconnected_rx) = tokio::sync::oneshot::channel::<()>();
    let (hold_tx, hold_rx) = tokio::sync::oneshot::channel::<()>();

    let server = tokio::spawn(async move {
        // Connection 1: send headers + one chunk, then observe client disconnect when cancelled.
        let (mut s1, _) = listener.accept().await.unwrap();
        let mut buf = vec![0u8; 4096];
        let _ = s1.read(&mut buf).await;
        let _ = s1
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n12\r\ndata: {\"ok\":true}\n\r\n",
            )
            .await;
        let _ = s1.flush().await;
        let _ = first_connected_tx.send(());

        // Connection 2 (while connection 1 is still open): answer immediately for the new provider.
        let s2_task = tokio::spawn(async move {
            let (mut s2, _) = listener.accept().await.unwrap();
            let mut buf2 = vec![0u8; 4096];
            let _ = s2.read(&mut buf2).await;
            let body = "data: [DONE]\n\n";
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            );
            let _ = s2.write_all(resp.as_bytes()).await;
        });

        // Wait until the client closes connection 1 (proving `cancel` actually aborted the task).
        let mut eof_buf = [0u8; 16];
        tokio::select! {
            res = s1.read(&mut eof_buf) => {
                if matches!(res, Ok(0) | Err(_)) {
                    let _ = disconnected_tx.send(());
                }
            }
            _ = hold_rx => {}
        }
        drop(s1);
        let _ = s2_task.await;
    });

    let provider_a = Provider {
        id: "local-a".into(),
        kind: Kind::OpenaiCompatible,
        model: "model-a".into(),
        endpoint: Some(format!("http://127.0.0.1:{port}/v1")),
        key: None,
    };
    let provider_b = Provider {
        id: "local-b".into(),
        kind: Kind::OpenaiCompatible,
        model: "model-b".into(),
        endpoint: Some(format!("http://127.0.0.1:{port}/v1")),
        key: None,
    };
    let models = Arc::new(Models::new(Ok(vec![provider_a])));

    let events = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let seen = events.clone();
    let emit: Emit = Arc::new(move |event| seen.lock().unwrap().push(event));

    // Start active stream 1 on `local-a`.
    assert_eq!(
        models.send("local-a", openai(), 1, emit.clone()).await,
        Ok(1)
    );
    tokio::time::timeout(Duration::from_secs(5), first_connected_rx)
        .await
        .expect("first stream connects")
        .unwrap();
    assert!(models.streams.lock().await.contains_key(&1));

    // Hot-swap provider configuration on the singleton `Models`: remove `local-a`, add `local-b`.
    models.update_providers(Ok(vec![provider_b]));

    // Stream 1 is STILL active and tracked on the singleton after the config swap.
    assert!(models.streams.lock().await.contains_key(&1));

    // New requests see the updated config: `local-a` is gone, `local-b` works.
    assert_eq!(
        models
            .send("local-a", openai(), 2, emit.clone())
            .await
            .err(),
        Some(PROVIDER_UNKNOWN)
    );
    assert_eq!(models.send("local-b", openai(), 2, emit).await, Ok(2));

    // Wait for stream 2 to finish while stream 1 is still active.
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if events
                .lock()
                .unwrap()
                .iter()
                .any(|ev| ev["stream"] == 2 && ev["done"] == true)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("stream 2 completes");
    assert!(models.streams.lock().await.contains_key(&1));

    // Cancelling stream 1 after the config swap aborts the underlying HTTP task (observed by
    // the server as a socket disconnect BEFORE releasing `hold_tx`) and removes the slot.
    models.cancel(1).await;
    assert!(!models.streams.lock().await.contains_key(&1));
    tokio::time::timeout(Duration::from_secs(5), disconnected_rx)
        .await
        .expect("server observes client disconnect on cancel")
        .unwrap();

    let _ = hold_tx.send(());
    server.await.unwrap();
}
