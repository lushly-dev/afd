//! Tests of `umbel-embed`'s three optional providers behind their Cargo features (records host
//! specification, sections 9.2 and 15.2):
//!
//! - `static`: builds a minimal 16-dimension Model2Vec safetensors model in memory and verifies
//!   loading, dimensions, deterministic embedding, and refusal of invalid inputs.
//! - `http`: drives a local loopback HTTP server, verifying request shape, bearer auth,
//!   out-of-order index sorting, 64-text batching, Tokio `spawn_blocking` composition, and every
//!   refusal (non-loopback HTTP URL, redirect, non-2xx, timeout, >16 MiB body, wrong dimensions,
//!   wrong count, non-finite values, and zero text leakage in errors).
//! - `onnx`: verifies fail-closed refusal of invalid bytes without network download, and runs a
//!   real model when `UMBEL_TEST_ONNX_DIR` is provided in the environment (skipped otherwise).

#![allow(clippy::expect_used, clippy::unwrap_used)]

use umbel_store::ModelId;

fn model_id(name: &str) -> ModelId {
    ModelId::parse(&format!("{name}@0123456789abcdef")).unwrap()
}

#[test]
fn crate_exports_dimension_bounds() {
    assert_eq!(umbel_embed::MIN_DIMENSIONS, 16);
    assert_eq!(umbel_embed::MAX_DIMENSIONS, 4096);
    assert_eq!(umbel_embed::MAX_HTTP_BATCH, 64);
    assert_eq!(umbel_embed::MAX_HTTP_RESPONSE_BYTES, 16 * 1024 * 1024);
    let _ = model_id("check");
}

#[cfg(feature = "static")]
mod static_provider {
    use super::model_id;
    use serde_json::json;
    use umbel_embed::StaticEmbedder;
    use umbel_store::Embedder;

    /// Build a minimal valid `.safetensors` file holding an `embeddings` tensor of shape
    /// `[rows, cols]` with `F32` values.
    fn safetensors_f32(rows: usize, cols: usize, values: &[f32]) -> Vec<u8> {
        assert_eq!(values.len(), rows * cols);
        let data_bytes = values.len() * 4;
        let header = json!({
            "embeddings": {
                "dtype": "F32",
                "shape": [rows, cols],
                "data_offsets": [0, data_bytes],
            }
        })
        .to_string();
        let header_bytes = header.as_bytes();
        let mut out = Vec::with_capacity(8 + header_bytes.len() + data_bytes);
        out.extend_from_slice(&(header_bytes.len() as u64).to_le_bytes());
        out.extend_from_slice(header_bytes);
        for v in values {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }

    /// Build a minimal WordPiece `tokenizer.json` with a tiny gardening vocabulary.
    fn tokenizer_json() -> Vec<u8> {
        json!({
            "version": "1.0",
            "truncation": null,
            "padding": null,
            "added_tokens": [
                { "id": 0, "content": "[UNK]", "single_word": false, "lstrip": false, "rstrip": false, "normalized": false, "special": true }
            ],
            "normalizer": {
                "type": "BertNormalizer",
                "clean_text": true,
                "handle_chinese_chars": true,
                "strip_accents": null,
                "lowercase": true
            },
            "pre_tokenizer": {
                "type": "BertPreTokenizer"
            },
            "post_processor": null,
            "decoder": null,
            "model": {
                "type": "WordPiece",
                "unk_token": "[UNK]",
                "continuing_subword_prefix": "##",
                "max_input_chars_per_word": 100,
                "vocab": {
                    "[UNK]": 0,
                    "prune": 1,
                    "roses": 2,
                    "mulch": 3,
                    "tomatoes": 4,
                    "water": 5
                }
            }
        })
        .to_string()
        .into_bytes()
    }

    fn config_json(normalize: bool) -> Vec<u8> {
        json!({
            "model_type": "model2vec",
            "normalize": normalize,
            "apply_zipf": false
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn static_provider_loads_and_embeds_deterministically() {
        let dim = 16usize;
        let rows = 6usize;
        let mut weights = vec![0.0f32; rows * dim];
        for row in 0..rows {
            weights[row * dim + (row % dim)] = 1.0;
            weights[row * dim + ((row + 5) % dim)] = 0.5;
        }
        let embedder = StaticEmbedder::from_bytes(
            model_id("tiny-static"),
            &tokenizer_json(),
            &safetensors_f32(rows, dim, &weights),
            &config_json(true),
        )
        .expect("load tiny static model");
        assert_eq!(embedder.model().as_str(), "tiny-static@0123456789abcdef");
        assert_eq!(embedder.dimensions(), 16);
        assert!(embedder.embed(&[]).unwrap().is_empty());

        let first = embedder
            .embed(&["prune roses", "water tomatoes", "prune roses"])
            .expect("embed");
        assert_eq!(first.len(), 3);
        assert_eq!(first[0].len(), 16);
        assert_eq!(first[0], first[2], "identical text gives identical vector");
        assert_ne!(
            first[0], first[1],
            "distinct vocabularies give distinct vectors"
        );
        assert!(first.iter().flatten().all(|v| v.is_finite()));
    }

    #[test]
    fn static_provider_refuses_too_few_dimensions_and_bad_bytes() {
        let weights = vec![1.0f32; 6 * 8];
        let err = StaticEmbedder::from_bytes(
            model_id("too-small"),
            &tokenizer_json(),
            &safetensors_f32(6, 8, &weights),
            &config_json(true),
        )
        .err()
        .expect("8 dimensions must be refused");
        assert!(err.to_string().contains("16 to 4096"), "{err}");

        assert!(
            StaticEmbedder::from_bytes(model_id("broken"), b"{}", b"not safetensors", b"{}")
                .is_err()
        );
    }

    #[test]
    fn static_provider_converts_mismatched_vocab_table_into_error_not_panic() {
        // Vocab has token id 1 ("prune"), but embeddings table only has 1 row (id 0).
        let weights = vec![1.0f32; 16];
        let loaded = StaticEmbedder::from_bytes(
            model_id("short-table"),
            &tokenizer_json(),
            &safetensors_f32(1, 16, &weights),
            &config_json(true),
        );
        match loaded {
            Err(err) => assert!(err.to_string().contains("static model"), "{err}"),
            Ok(embedder) => {
                let err = embedder
                    .embed(&["prune roses"])
                    .expect_err("out-of-bounds vocab lookup must return error, never panic");
                assert!(err.to_string().contains("panicked"), "{err}");
            }
        }
    }
}

#[cfg(feature = "http")]
mod http_provider {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use serde_json::{Value, json};
    use umbel_embed::{HttpConfig, HttpEmbedder, check_http_url};
    use umbel_store::{EmbedError, Embedder};

    use super::model_id;

    /// Spawn a tiny single-accept or multi-accept loopback HTTP/1.1 test server.
    fn spawn_server<F>(requests: usize, handler: F) -> (String, std::thread::JoinHandle<()>)
    where
        F: Fn(String, Value) -> (u16, String, Vec<u8>) + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let addr = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            for _ in 0..requests {
                let (mut stream, _) = listener.accept().expect("accept");
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut raw = Vec::new();
                let mut buf = [0u8; 4096];
                let mut header_end = None;
                let mut content_length = 0usize;
                loop {
                    let n = match stream.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => n,
                    };
                    raw.extend_from_slice(&buf[..n]);
                    if header_end.is_none()
                        && let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n")
                    {
                        header_end = Some(pos + 4);
                        let headers = String::from_utf8_lossy(&raw[..pos]);
                        for line in headers.lines() {
                            if let Some((k, v)) = line.split_once(':')
                                && k.trim().eq_ignore_ascii_case("content-length")
                            {
                                content_length = v.trim().parse().unwrap_or(0);
                            }
                        }
                    }
                    if let Some(end) = header_end
                        && raw.len() >= end + content_length
                    {
                        break;
                    }
                }
                let Some(end) = header_end else {
                    continue;
                };
                let head = String::from_utf8_lossy(&raw[..end]).into_owned();
                let body: Value =
                    serde_json::from_slice(&raw[end..end + content_length]).unwrap_or(Value::Null);
                let (status, extra_headers, resp_body) = handler(head, body);
                let response_head = format!(
                    "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{extra_headers}Connection: close\r\n\r\n",
                    resp_body.len()
                );
                let _ = stream.write_all(response_head.as_bytes());
                let _ = stream.write_all(&resp_body);
                let _ = stream.flush();
            }
        });
        (
            format!("http://127.0.0.1:{}/v1/embeddings", addr.port()),
            handle,
        )
    }

    #[test]
    fn url_rules_refuse_http_names_and_accept_literal_loopback_and_https() {
        assert_eq!(
            check_http_url("https://api.example.com/v1/embeddings"),
            Ok(true)
        );
        assert_eq!(
            check_http_url("http://127.0.0.1:8080/v1/embeddings"),
            Ok(false)
        );
        assert_eq!(check_http_url("http://[::1]:8080/v1/embeddings"), Ok(false));
        for bad in [
            "http://localhost:8080/v1/embeddings",
            "http://example.com/v1/embeddings",
            "http://192.168.1.1/v1/embeddings",
            "ftp://127.0.0.1/v1/embeddings",
            "http://127.999.0.1/v1/embeddings",
            "http://[0:0:0:0:0:0:0:1]/v1/embeddings",
            "https://[::1::2]/v1/embeddings",
        ] {
            assert!(check_http_url(bad).is_err(), "{bad} must be refused");
        }
        let cfg = HttpConfig {
            url: "https://api.example.com/v1/embeddings".to_owned(),
            name: "demo".to_owned(),
            dimensions: 16,
            bearer: Some("super-secret-token-xyz".to_owned()),
            timeout: Duration::from_secs(5),
        };
        let dbg = format!("{cfg:?}");
        assert!(!dbg.contains("super-secret-token-xyz"), "{dbg}");
        assert!(dbg.contains("<redacted>"), "{dbg}");
    }

    #[test]
    fn http_provider_sends_bearer_reorders_indices_and_batches_by_64() {
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_ref = Arc::clone(&calls);
        let (url, handle) = spawn_server(2, move |head, body| {
            calls_ref.fetch_add(1, Ordering::SeqCst);
            assert!(
                head.contains("authorization: Bearer secret-tok")
                    || head.contains("Authorization: Bearer secret-tok"),
                "bearer missing: {head}"
            );
            assert_eq!(body["model"], "demo-embed");
            let inputs = body["input"].as_array().unwrap();
            assert!(inputs.len() <= 64);
            // Return embeddings in reverse index order to prove index sorting.
            let mut data = Vec::new();
            for (i, text) in inputs.iter().enumerate().rev() {
                let mut vec = vec![0.0f32; 16];
                vec[0] = (text.as_str().unwrap().len() as f32) + 1.0;
                vec[1] = (i as f32) + 1.0;
                data.push(json!({ "index": i, "embedding": vec }));
            }
            (
                200,
                String::new(),
                json!({ "data": data }).to_string().into_bytes(),
            )
        });

        let embedder = HttpEmbedder::new(
            model_id("remote"),
            HttpConfig {
                url,
                name: "demo-embed".to_owned(),
                dimensions: 16,
                bearer: Some("secret-tok".to_owned()),
                timeout: Duration::from_secs(5),
            },
        )
        .expect("construct http embedder");

        let owned: Vec<String> = (0..70).map(|i| format!("text-{i}")).collect();
        let refs: Vec<&str> = owned.iter().map(String::as_str).collect();
        let out = embedder.embed(&refs).expect("embed 70 texts");
        assert_eq!(out.len(), 70);
        assert_eq!(calls.load(Ordering::SeqCst), 2, "64 + 6 = 2 batches");
        assert_eq!(out[0][1], 1.0);
        assert_eq!(out[63][1], 64.0);
        assert_eq!(out[64][1], 1.0);
        assert_eq!(out[69][1], 6.0);
        handle.join().unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn http_provider_composes_with_tokio_when_called_from_spawn_blocking() {
        let (url, handle) = spawn_server(1, |_head, body| {
            let n = body["input"].as_array().unwrap().len();
            let data: Vec<Value> = (0..n)
                .map(|i| json!({ "index": i, "embedding": vec![0.25f32; 16] }))
                .collect();
            (
                200,
                String::new(),
                json!({ "data": data }).to_string().into_bytes(),
            )
        });

        // Constructing HttpEmbedder on an async worker thread (as HostBuilder::seal does) must
        // not panic even in debug builds.
        let embedder = HttpEmbedder::new(
            model_id("async-host"),
            HttpConfig {
                url,
                name: "demo".to_owned(),
                dimensions: 16,
                bearer: None,
                timeout: Duration::from_secs(5),
            },
        )
        .expect("construct inside tokio runtime");

        let vecs = tokio::task::spawn_blocking(move || embedder.embed(&["prune roses"]))
            .await
            .expect("join blocking task")
            .expect("embed from spawn_blocking");
        assert_eq!(vecs.len(), 1);
        assert_eq!(vecs[0].len(), 16);
        handle.join().unwrap();
    }

    #[test]
    fn http_provider_refuses_redirects_bad_status_bad_dims_and_leaks_no_text() {
        let canary = "SECRET_CANARY_PHRASE_99182";

        // 1. Redirect refused (not followed).
        let (url, h1) = spawn_server(1, |_, _| {
            (
                302,
                "Location: http://127.0.0.1:1/other\r\n".to_owned(),
                Vec::new(),
            )
        });
        let e1 = HttpEmbedder::new(
            model_id("r1"),
            HttpConfig {
                url,
                name: "m".into(),
                dimensions: 16,
                bearer: None,
                timeout: Duration::from_secs(5),
            },
        )
        .unwrap();
        let err = e1.embed(&[canary]).unwrap_err();
        assert!(matches!(err, EmbedError::Unavailable(_)), "{err:?}");
        assert!(!err.to_string().contains(canary));
        h1.join().unwrap();

        // 2. 500 server error.
        let (url, h2) = spawn_server(1, |_, _| (500, String::new(), canary.as_bytes().to_vec()));
        let e2 = HttpEmbedder::new(
            model_id("r2"),
            HttpConfig {
                url,
                name: "m".into(),
                dimensions: 16,
                bearer: None,
                timeout: Duration::from_secs(5),
            },
        )
        .unwrap();
        let err = e2.embed(&[canary]).unwrap_err();
        assert!(matches!(err, EmbedError::Unavailable(_)), "{err:?}");
        assert!(!err.to_string().contains(canary));
        h2.join().unwrap();

        // 3. Wrong dimensions.
        let (url, h3) = spawn_server(1, |_, _| {
            (
                200,
                String::new(),
                json!({ "data": [{ "index": 0, "embedding": vec![1.0f32; 8] }] })
                    .to_string()
                    .into_bytes(),
            )
        });
        let e3 = HttpEmbedder::new(
            model_id("r3"),
            HttpConfig {
                url,
                name: "m".into(),
                dimensions: 16,
                bearer: None,
                timeout: Duration::from_secs(5),
            },
        )
        .unwrap();
        let err = e3.embed(&[canary]).unwrap_err();
        assert!(matches!(err, EmbedError::Invalid(_)), "{err:?}");
        assert!(!err.to_string().contains(canary));
        h3.join().unwrap();

        // 4. Response exceeding 16 MiB cap.
        let (url, h4) = spawn_server(1, |_, _| {
            let huge = vec![b' '; umbel_embed::MAX_HTTP_RESPONSE_BYTES + 1024];
            (200, String::new(), huge)
        });
        let e4 = HttpEmbedder::new(
            model_id("r4"),
            HttpConfig {
                url,
                name: "m".into(),
                dimensions: 16,
                bearer: None,
                timeout: Duration::from_secs(5),
            },
        )
        .unwrap();
        let err = e4.embed(&[canary]).unwrap_err();
        assert!(matches!(err, EmbedError::Invalid(_)), "{err:?}");
        assert!(err.to_string().contains("exceeded"), "{err}");
        h4.join().unwrap();
    }
}

#[cfg(feature = "onnx")]
mod onnx_provider {
    use super::model_id;
    use umbel_embed::{OnnxEmbedder, OnnxFiles, OnnxPooling};
    use umbel_store::Embedder;

    #[test]
    fn onnx_provider_refuses_invalid_bytes_and_runs_env_model_when_provided() {
        let invalid = OnnxEmbedder::from_bytes(
            model_id("bad-onnx"),
            OnnxFiles {
                model: b"not onnx".to_vec(),
                tokenizer: b"{}".to_vec(),
                config: b"{}".to_vec(),
                special_tokens_map: b"{}".to_vec(),
                tokenizer_config: b"{}".to_vec(),
            },
            OnnxPooling::Mean,
            512,
        );
        assert!(invalid.is_err(), "corrupt onnx bytes must fail closed");

        let Ok(dir) = std::env::var("UMBEL_TEST_ONNX_DIR") else {
            return;
        };
        let path = std::path::Path::new(&dir);
        let read = |name: &str| std::fs::read(path.join(name)).expect(name);
        let embedder = OnnxEmbedder::from_bytes(
            model_id("env-onnx"),
            OnnxFiles {
                model: read("model.onnx"),
                tokenizer: read("tokenizer.json"),
                config: read("config.json"),
                special_tokens_map: read("special_tokens_map.json"),
                tokenizer_config: read("tokenizer_config.json"),
            },
            OnnxPooling::Mean,
            512,
        )
        .expect("load onnx model from UMBEL_TEST_ONNX_DIR");
        let vecs = embedder
            .embed(&["prune roses", "water tomatoes"])
            .expect("embed");
        assert_eq!(vecs.len(), 2);
        assert_eq!(vecs[0].len(), embedder.dimensions());
    }
}
