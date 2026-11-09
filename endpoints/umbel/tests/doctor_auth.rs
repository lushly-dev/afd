//! The doctor's hosted profile (phase 5 specification, section 6.1; step 2c): every `auth.*`
//! check, run by `umbel workspace doctor` against `umbel-testkit-idp`, with each way it fails or
//! warns, and that no check ever prints a secret, a token or a private key. Also that the doctor
//! is the operator's in a hosted mode: MCP neither lists nor serves it, and the library is
//! refused.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;

use afd::{Actor, ActorKind};
use serde_json::{Value, json};
use support::hosted::PUBLIC_URL;
use support::oauth::{Running, Setup, modern};
use support::{Run, Scripted, cli_with};
use umbel::HostBuilder;
use umbel_testkit_idp::{Client, Endpoint, Fault, TestCa, TestIdp};

/// The person login's secret, as the test seam gives it: never printed.
const PERSON_SECRET: &str = "person-secret-canary-6f1c2e";
/// The introspection client's secret: never printed.
const INTROSPECTION_SECRET: &str = "introspection-secret-canary-9b3d7a";
const DAY: i64 = 24 * 60 * 60;

fn now() -> i64 {
    support::oauth::now_ms().div_euclid(1000)
}

/// What varies between the tests' hosted workspaces.
struct Config<'a> {
    /// Extra keys of the authorization server's issuer table `as`.
    issuer: &'a str,
    /// Extra keys of the identity provider's issuer table `idp`.
    idp: &'a str,
    /// The `[mcp]` table's body.
    mcp: &'a str,
    /// Extra `[http]` keys.
    http: &'a str,
    /// Appended at the end.
    rest: &'a str,
    /// The `[principal]` table's body.
    principal: &'a str,
    /// The auth mode.
    mode: &'a str,
}

impl Default for Config<'_> {
    fn default() -> Self {
        Self {
            issuer: "algorithms = [\"ES256\", \"RS256\"]\nservices = { clients = [\"build-bot\"] }",
            idp: "",
            mcp: "confirmations = \"require-human\"",
            http: "",
            rest: "",
            principal: "local_id = \"corp/ada\"",
            mode: "oauth",
        }
    }
}

/// An `oauth` workspace over the kit: namespace `corp` with its person login at the identity
/// provider `idp` (login only), the authorization server as token issuer `as`, and space `main`
/// read by the operator.
fn config(kit: &TestIdp, config: &Config<'_>) -> String {
    format!(
        r#"config_version = 5
default_space = "main"

[principal]
{principal}

[mcp]
{mcp}

[http]
public_url = "{PUBLIC_URL}"
allowed_hosts = ["127.0.0.1"]
{http}

[auth]
mode = "{mode}"

[auth.namespaces.corp]
person = {{ issuer = "idp", client_id = "umbel-person-page", client_secret_env = "UMBEL_TEST_PERSON_SECRET", acr_values = ["phr"], uv_amr = ["pin"] }}

[auth.issuers.idp]
issuer = "{idp}"
namespace = "corp"
access_tokens = false
{idp_keys}

[auth.issuers.as]
issuer = "{as_issuer}"
namespace = "corp"
{issuer}

[spaces.main]
readers = ["human:corp/ada"]

{rest}
"#,
        principal = config.principal,
        mcp = config.mcp,
        http = config.http,
        mode = config.mode,
        idp = kit.identity_provider().issuer(),
        idp_keys = config.idp,
        as_issuer = kit.authorization_server().issuer(),
        issuer = config.issuer,
        rest = config.rest,
    )
}

/// A kit whose authorization server's RFC 8414 document also says its subjects are public, as an
/// enterprise resource server may; the tests that need otherwise patch it again.
async fn kit() -> TestIdp {
    let kit = TestIdp::start().await.unwrap();
    kit.authorization_server()
        .set_metadata_patch(Some(json!({ "subject_types_supported": ["public"] })));
    kit
}

/// The doctor's report, from `umbel workspace doctor` at the CLI of `dir`, with the kit's CA
/// standing in for the platform's roots and the person login's secret set, then `configure`.
async fn doctor_with(
    dir: &Path,
    kit: &TestIdp,
    configure: impl FnOnce(HostBuilder) -> HostBuilder,
) -> Report {
    let ca = kit.ca().certificate_pem().as_bytes().to_vec();
    let run = cli_with(
        dir,
        &["workspace", "doctor"],
        Scripted::no_terminal(),
        move |builder| {
            configure(
                builder
                    .with_auth_root_certificate(ca)
                    .with_auth_secret("UMBEL_TEST_PERSON_SECRET", PERSON_SECRET),
            )
        },
    )
    .await;
    Report::new(run)
}

async fn doctor(dir: &Path, kit: &TestIdp) -> Report {
    doctor_with(dir, kit, |builder| builder).await
}

/// One run of the doctor.
struct Report {
    run: Run,
    value: Value,
}

impl Report {
    fn new(run: Run) -> Self {
        let value = run.json();
        Self { run, value }
    }

    fn checks(&self) -> &Vec<Value> {
        let data = if self.value["success"] == json!(true) {
            &self.value["data"]
        } else {
            &self.value["error"]["details"]
        };
        data["checks"]
            .as_array()
            .unwrap_or_else(|| panic!("no checks in {}", self.run.stdout))
    }

    fn check(&self, id: &str) -> (String, String) {
        let check = self
            .checks()
            .iter()
            .find(|check| check["id"] == id)
            .unwrap_or_else(|| panic!("no check {id} in {}", self.run.stdout));
        (
            check["status"].as_str().unwrap().to_owned(),
            check["message"].as_str().unwrap().to_owned(),
        )
    }

    fn status(&self, id: &str) -> String {
        self.check(id).0
    }

    fn message(&self, id: &str) -> String {
        self.check(id).1
    }

    /// Asserts that `id` has `status`, showing its message otherwise; returns the message.
    fn expect(&self, id: &str, status: &str) -> String {
        let (found, message) = self.check(id);
        assert_eq!(found, status, "{id}: {message}");
        message
    }

    fn ids(&self) -> Vec<String> {
        self.checks()
            .iter()
            .map(|check| check["id"].as_str().unwrap().to_owned())
            .collect()
    }
}

fn workspace(text: &str) -> tempfile::TempDir {
    support::workspace(text)
}

#[cfg(unix)]
fn chmod(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
}

/// A certificate for `127.0.0.1` from `ca` and its key, written under `<dir>/tls/` with the key
/// readable by its owner only; returns the key's PEM.
fn write_tls(dir: &Path, ca: &TestCa) -> String {
    let tls = dir.join("tls");
    std::fs::create_dir_all(&tls).unwrap();
    let server = ca.server_certificate(&["127.0.0.1"]).unwrap();
    std::fs::write(tls.join("cert.pem"), server.certificate_pem()).unwrap();
    std::fs::write(tls.join("key.pem"), server.private_key_pem()).unwrap();
    #[cfg(unix)]
    chmod(&tls.join("key.pem"), 0o600);
    std::fs::write(tls.join("ca.pem"), ca.certificate_pem()).unwrap();
    server.private_key_pem().to_owned()
}

const TLS: &str = "[http.tls]\ncert = \"tls/cert.pem\"\nkey = \"tls/key.pem\"\n";

fn year_ca() -> TestCa {
    TestCa::valid_between(now() - 3600, now() + 365 * DAY).unwrap()
}

fn expired_ca() -> TestCa {
    TestCa::valid_between(now() - 30 * DAY, now() - DAY).unwrap()
}

// ─── The report ──────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_hosted_workspace_reports_every_auth_check_in_order_after_http_config() {
    let kit = kit().await;
    let dir = workspace(&config(&kit, &Config::default()));
    let report = doctor(dir.path(), &kit).await;
    let ids = report.ids();
    let at = ids.iter().position(|id| id == "http.config").unwrap();
    let end = at + 1 + umbel::doctor::AUTH_CHECKS.len();
    assert_eq!(&ids[at + 1..end], umbel::doctor::AUTH_CHECKS, "{ids:?}");
    // A shipped build serves oauth since phase 5 step 7: no warning, as for every other check.
    let mode = report.expect("auth.mode", "pass");
    assert!(!mode.contains("does not serve"), "{mode}");
    for id in &umbel::doctor::AUTH_CHECKS[1..] {
        report.expect(id, "pass");
    }
    assert_eq!(report.value["data"]["healthy"], json!(true));
    assert_eq!(report.run.code, 0, "{}", report.run.stdout);
}

#[tokio::test]
async fn mode_none_has_no_hosted_checks_but_still_checks_its_tls_files() {
    let kit = kit().await;
    let dir = workspace("config_version = 5\n");
    let report = doctor(dir.path(), &kit).await;
    assert!(
        !report.ids().iter().any(|id| id.starts_with("auth.")),
        "{:?}",
        report.ids()
    );
    // Mode none with [http.tls]: auth.tls alone, and a key others can read fails it.
    let dir = workspace(&format!("config_version = 5\n{TLS}"));
    let key = write_tls(dir.path(), &year_ca());
    #[cfg(unix)]
    chmod(&dir.path().join("tls/key.pem"), 0o644);
    let report = doctor(dir.path(), &kit).await;
    let auth: Vec<String> = report
        .ids()
        .into_iter()
        .filter(|id| id.starts_with("auth."))
        .collect();
    assert_eq!(auth, ["auth.tls"]);
    #[cfg(unix)]
    {
        let message = report.expect("auth.tls", "fail");
        assert!(message.contains("http.tls.key"), "{message}");
        assert!(
            message.contains("readable or writable by group or other"),
            "{message}"
        );
    }
    assert_no_key(&report, &key);
}

fn assert_no_key(report: &Report, key_pem: &str) {
    assert!(
        !report.run.stdout.contains("PRIVATE KEY"),
        "{}",
        report.run.stdout
    );
    for line in key_pem.lines().filter(|line| !line.starts_with("-----")) {
        assert!(
            !report.run.stdout.contains(line),
            "a line of the key was printed"
        );
    }
}

// ─── auth.mode ───────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn gateway_mode_is_served_and_its_pinned_key_set_checked_as_the_gateway_layer_loads_it() {
    let kit = kit().await;
    let gateway = kit.gateway();
    let dir = tempfile::tempdir().unwrap();
    let keys = dir.path().join("gw/jwks.json");
    std::fs::create_dir_all(dir.path().join("gw")).unwrap();
    let pinned = support::gateway::pinned_jwks(&kit);
    std::fs::write(&keys, pinned.to_string()).unwrap();
    let text = format!(
        r#"config_version = 5
[principal]
local_id = "corp/ada"
[mcp]
confirmations = "require-human"
[http]
public_url = "{PUBLIC_URL}"
allowed_hosts = ["127.0.0.1"]
[auth]
mode = "gateway"
[auth.namespaces.corp]
person = {{ issuer = "idp", client_id = "umbel-person-page", client_secret_env = "UMBEL_TEST_PERSON_SECRET", acr_values = ["phr"], uv_amr = ["pin"] }}
[auth.issuers.idp]
issuer = "{idp}"
namespace = "corp"
access_tokens = false
[auth.gateway]
alias = "edge"
namespace = "corp"
issuer = "https://gateway.example.com"
keys = "gw/jwks.json"
client_cert_sha256 = []
max_scopes = ["umbel:read"]
"#,
        idp = kit.identity_provider().issuer(),
    );
    std::fs::write(dir.path().join("umbel.toml"), text).unwrap();
    let report = doctor(dir.path(), &kit).await;
    // Served since step 4: no warning, the gateway named.
    let mode = report.expect("auth.mode", "pass");
    assert!(mode.contains("gateway edge"), "{mode}");
    assert!(mode.contains("no protected-resource metadata"), "{mode}");
    let tls = report.expect("auth.tls", "pass");
    assert!(tls.contains("pinned key set holds 4 key(s)"), "{tls}");
    assert!(tls.contains("over loopback"), "{tls}");
    // The gateway joins its namespace's subjects as an issuer does: the deployer's assertion.
    let subjects = report.check("auth.subjects").1;
    assert!(
        subjects.contains("namespace corp joins idp (sub) and the gateway edge"),
        "{subjects}"
    );

    // The pinned key set is read as the gateway layer reads it: every key usable, each naming
    // its alg, public keys only, writable by no one else.
    let mut without_alg = pinned.clone();
    without_alg["keys"][1]
        .as_object_mut()
        .unwrap()
        .remove("alg");
    let mut private = pinned.clone();
    private["keys"][0]["d"] = json!("AAAA");
    for (label, document, needle) in [
        ("empty", json!({ "keys": [] }).to_string(), "pins no key"),
        ("no alg", without_alg.to_string(), "key 2 names no alg"),
        (
            "private material",
            private.to_string(),
            "private or symmetric member",
        ),
        ("not a key set", "[]".to_owned(), "not a JSON object"),
        (
            "a repeated member",
            format!("{{\"keys\":[],\"keys\":{}}}", pinned["keys"]),
            "unique member names",
        ),
        (
            "unpublished alg-less kit set",
            gateway.jwks().to_string(),
            "names no alg",
        ),
    ] {
        std::fs::write(&keys, document).unwrap();
        let report = doctor(dir.path(), &kit).await;
        let tls = report.expect("auth.tls", "fail");
        assert!(tls.contains("auth.gateway.keys"), "{label}: {tls}");
        assert!(tls.contains(needle), "{label}: {tls}");
        assert!(!tls.contains("AAAA"), "{label}: {tls}");
    }
    #[cfg(unix)]
    {
        std::fs::write(&keys, pinned.to_string()).unwrap();
        chmod(&keys, 0o666);
        let report = doctor(dir.path(), &kit).await;
        let tls = report.expect("auth.tls", "fail");
        assert!(tls.contains("writable by group or other"), "{tls}");
        chmod(&keys, 0o644);
    }

    // The pinned channel is reported as such.
    std::fs::write(&keys, pinned.to_string()).unwrap();
    write_tls(dir.path(), &year_ca());
    let text = std::fs::read_to_string(dir.path().join("umbel.toml"))
        .unwrap()
        .replace(
            "client_cert_sha256 = []",
            &format!(
                "client_cert_sha256 = [\"{}\"]",
                gateway.certificate().sha256_hex()
            ),
        )
        .replace(
            "allowed_hosts = [\"127.0.0.1\"]",
            &format!(
                "allowed_hosts = [\"127.0.0.1\"]\n{TLS}client_auth = \"ca\"\nclient_ca = \"tls/ca.pem\"\n"
            ),
        );
    std::fs::write(dir.path().join("umbel.toml"), text).unwrap();
    let report = doctor(dir.path(), &kit).await;
    let tls = report.expect("auth.tls", "pass");
    assert!(
        tls.contains("one of 1 pinned certificate(s) chaining to http.tls.client_ca"),
        "{tls}"
    );
}

// ─── auth.public_url ─────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_public_url_is_reported() {
    let kit = kit().await;
    let dir = workspace(&config(&kit, &Config::default()));
    let report = doctor(dir.path(), &kit).await;
    let message = report.expect("auth.public_url", "pass");
    assert!(message.contains(PUBLIC_URL), "{message}");
}

// ─── auth.tls ────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn tls_checks_the_certificate_the_key_and_the_client_ca() {
    let kit = kit().await;
    let with_tls = |extra: &str| {
        config(
            &kit,
            &Config {
                rest: &format!("{TLS}{extra}"),
                ..Config::default()
            },
        )
    };
    // A loopback bind without TLS passes, saying what a proxy needs.
    let dir = workspace(&config(&kit, &Config::default()));
    let message = doctor(dir.path(), &kit).await.expect("auth.tls", "pass");
    assert!(message.contains("loopback"), "{message}");

    // A certificate valid for a year, a key its owner alone reads: pass.
    let dir = workspace(&with_tls(""));
    let key = write_tls(dir.path(), &year_ca());
    let report = doctor(dir.path(), &kit).await;
    report.expect("auth.tls", "pass");

    // A key readable by others fails, and the key is never printed.
    #[cfg(unix)]
    {
        chmod(&dir.path().join("tls/key.pem"), 0o640);
        let report = doctor(dir.path(), &kit).await;
        let message = report.expect("auth.tls", "fail");
        assert!(message.contains("http.tls.key"), "{message}");
        assert_no_key(&report, &key);
        chmod(&dir.path().join("tls/key.pem"), 0o600);
        // A certificate others may write fails.
        chmod(&dir.path().join("tls/cert.pem"), 0o666);
        let message = doctor(dir.path(), &kit).await.expect("auth.tls", "fail");
        assert!(message.contains("http.tls.cert"), "{message}");
        chmod(&dir.path().join("tls/cert.pem"), 0o644);
    }

    // Within 14 days of expiry: a warning naming the date.
    let soon = TestCa::valid_between(now() - 3600, now() + 7 * DAY).unwrap();
    write_tls(dir.path(), &soon);
    let message = doctor(dir.path(), &kit).await.expect("auth.tls", "warn");
    assert!(message.contains("within 14 days"), "{message}");

    // Expired, and not yet valid: failures.
    write_tls(dir.path(), &expired_ca());
    let message = doctor(dir.path(), &kit).await.expect("auth.tls", "fail");
    assert!(message.contains("expired"), "{message}");
    let future = TestCa::valid_between(now() + DAY, now() + 30 * DAY).unwrap();
    write_tls(dir.path(), &future);
    let message = doctor(dir.path(), &kit).await.expect("auth.tls", "fail");
    assert!(message.contains("not valid yet"), "{message}");

    // A key that is not the certificate's: the listener's own loading refuses it.
    let key = write_tls(dir.path(), &year_ca());
    let other = year_ca().server_certificate(&["127.0.0.1"]).unwrap();
    std::fs::write(dir.path().join("tls/cert.pem"), other.certificate_pem()).unwrap();
    let report = doctor(dir.path(), &kit).await;
    let message = report.expect("auth.tls", "fail");
    assert!(message.contains("http.tls.key"), "{message}");
    assert_no_key(&report, &key);

    // A missing key, and a key file that holds no key.
    write_tls(dir.path(), &year_ca());
    std::fs::remove_file(dir.path().join("tls/key.pem")).unwrap();
    let message = doctor(dir.path(), &kit).await.expect("auth.tls", "fail");
    assert!(message.contains("cannot be read"), "{message}");
    std::fs::write(dir.path().join("tls/key.pem"), "not a key\n").unwrap();
    #[cfg(unix)]
    chmod(&dir.path().join("tls/key.pem"), 0o600);
    let message = doctor(dir.path(), &kit).await.expect("auth.tls", "fail");
    assert!(message.contains("not a PEM private key"), "{message}");

    // client_auth = "ca": the client CA is checked like a certificate.
    let dir = workspace(&with_tls(
        "client_auth = \"ca\"\nclient_ca = \"tls/ca.pem\"\n",
    ));
    write_tls(dir.path(), &year_ca());
    doctor(dir.path(), &kit).await.expect("auth.tls", "pass");
    std::fs::write(
        dir.path().join("tls/ca.pem"),
        expired_ca().certificate_pem(),
    )
    .unwrap();
    let message = doctor(dir.path(), &kit).await.expect("auth.tls", "fail");
    assert!(message.contains("http.tls.client_ca"), "{message}");
}

// ─── auth.ca_files ───────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ca_files_check_each_issuers_roots() {
    let kit = kit().await;
    let dir = workspace(&config(&kit, &Config::default()));
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.ca_files", "pass");
    assert!(message.contains("platform's roots"), "{message}");

    let with_ca = Config {
        issuer: "algorithms = [\"ES256\", \"RS256\"]\nservices = { clients = [\"build-bot\"] }\nca_file = \"trust/as.pem\"",
        ..Config::default()
    };
    let dir = workspace(&config(&kit, &with_ca));
    std::fs::create_dir_all(dir.path().join("trust")).unwrap();
    let ca_file = dir.path().join("trust/as.pem");

    // Missing.
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.ca_files", "fail");
    assert!(message.contains("auth.issuers.as.ca_file"), "{message}");

    // Not a certificate.
    std::fs::write(&ca_file, "not pem\n").unwrap();
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.ca_files", "fail");
    assert!(message.contains("holds no PEM certificate"), "{message}");

    // A year's root: pass, naming the issuer it alone serves.
    std::fs::write(&ca_file, year_ca().certificate_pem()).unwrap();
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.ca_files", "pass");
    assert!(message.contains("as trusts only"), "{message}");

    // The kit's own seven-day root: it works, and warns.
    std::fs::write(&ca_file, kit.ca().certificate_pem()).unwrap();
    let report = doctor(dir.path(), &kit).await;
    let message = report.expect("auth.ca_files", "warn");
    assert!(message.contains("within 14 days"), "{message}");
    report.expect("auth.issuers", "pass");

    // Expired.
    std::fs::write(&ca_file, expired_ca().certificate_pem()).unwrap();
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.ca_files", "fail");
    assert!(message.contains("expired"), "{message}");

    // Writable by others: whoever can write it chooses whom the host trusts.
    #[cfg(unix)]
    {
        std::fs::write(&ca_file, year_ca().certificate_pem()).unwrap();
        chmod(&ca_file, 0o666);
        let message = doctor(dir.path(), &kit)
            .await
            .expect("auth.ca_files", "fail");
        assert!(message.contains("writable by group or other"), "{message}");
    }
}

// ─── auth.issuers ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn issuers_must_be_reachable_and_name_themselves() {
    let kit = kit().await;
    let dir = workspace(&config(&kit, &Config::default()));
    doctor(dir.path(), &kit)
        .await
        .expect("auth.issuers", "pass");

    // Metadata naming another issuer.
    kit.authorization_server().set_metadata_patch(Some(json!({
        "issuer": "https://elsewhere.example.com/as",
        "subject_types_supported": ["public"],
    })));
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.issuers", "fail");
    assert!(message.contains("as: its metadata"), "{message}");
    assert!(message.contains("issuer-mismatch"), "{message}");
    assert!(
        !message.contains("elsewhere"),
        "no remote value is echoed: {message}"
    );
    kit.authorization_server()
        .set_metadata_patch(Some(json!({ "subject_types_supported": ["public"] })));

    // A key set the verifier cannot use, and a key set that fits none of the algorithms.
    kit.authorization_server()
        .set_fault(Endpoint::Jwks, Fault::Status(500));
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.issuers", "fail");
    assert!(message.contains("as: its key set"), "{message}");
    kit.authorization_server().clear_fault(Endpoint::Jwks);
    let keys = kit.authorization_server().keys();
    let rsa = keys
        .public_jwk(&keys.current_kid(umbel_testkit_idp::KeyKind::Rsa))
        .unwrap();
    keys.set_jwks_override(Some(json!({ "keys": [rsa] })));
    let es_only = Config {
        issuer: "algorithms = [\"ES256\"]\nservices = { clients = [\"build-bot\"] }",
        ..Config::default()
    };
    std::fs::write(dir.path().join("umbel.toml"), config(&kit, &es_only)).unwrap();
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.issuers", "fail");
    assert!(message.contains("no key of its key set fits"), "{message}");
    // One algorithm in two fits: a warning naming the other.
    std::fs::write(
        dir.path().join("umbel.toml"),
        config(&kit, &Config::default()),
    )
    .unwrap();
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.issuers", "warn");
    assert!(message.contains("fits ES256"), "{message}");
    keys.set_jwks_override(None);
}

#[tokio::test]
async fn an_unreachable_issuer_and_an_expired_certificate_fail() {
    // An issuer nothing listens for.
    let kit = kit().await;
    let text = config(&kit, &Config::default()).replace(
        &format!("issuer = \"{}\"", kit.authorization_server().issuer()),
        "issuer = \"https://127.0.0.1:9/as\"",
    );
    let dir = workspace(&text);
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.issuers", "fail");
    assert!(
        message.contains("as: its metadata cannot be reached"),
        "{message}"
    );

    // A kit whose own certificate expired: the handshake fails, so nothing of it is trusted.
    let expired = TestIdp::start_with_ca(expired_ca()).await.unwrap();
    let dir = workspace(&config(&expired, &Config::default()));
    let report = doctor(dir.path(), &expired).await;
    let message = report.expect("auth.issuers", "fail");
    assert!(message.contains("unreachable"), "{message}");
    // So the person login cannot be confirmed either.
    report.expect("auth.person", "fail");
}

#[tokio::test]
async fn the_introspection_issuer_is_asked_with_umbels_credentials_and_a_made_up_token() {
    let kit = kit().await;
    let server = kit.authorization_server();
    server.register_client(
        Client::confidential("umbel-resource", INTROSPECTION_SECRET).introspection(),
    );
    let introspected = Config {
        issuer: "verify = \"introspection\"\nintrospection = { client_id = \"umbel-resource\", client_secret_env = \"UMBEL_TEST_INTROSPECTION_SECRET\" }\nservices = { clients = [\"build-bot\"] }",
        ..Config::default()
    };
    let dir = workspace(&config(&kit, &introspected));
    let with_secret = |secret: &'static str| {
        move |builder: HostBuilder| {
            builder.with_auth_secret("UMBEL_TEST_INTROSPECTION_SECRET", secret)
        }
    };
    let before = server.hits(Endpoint::Introspection);
    let report = doctor_with(dir.path(), &kit, with_secret(INTROSPECTION_SECRET)).await;
    report.expect("auth.issuers", "pass");
    report.expect("auth.secrets", "pass");
    assert_eq!(server.hits(Endpoint::Introspection), before + 1);
    assert!(!report.run.stdout.contains(INTROSPECTION_SECRET));

    // The wrong secret: the endpoint refuses Umbel, and the secret is not printed.
    let report = doctor_with(dir.path(), &kit, with_secret("wrong-secret-canary-41d0")).await;
    let message = report.expect("auth.issuers", "fail");
    assert!(
        message.contains("refused Umbel's client credentials"),
        "{message}"
    );
    assert!(!report.run.stdout.contains("wrong-secret-canary-41d0"));

    // No secret: the endpoint is not called at all, and auth.secrets names the variable.
    let before = server.hits(Endpoint::Introspection);
    let report = doctor(dir.path(), &kit).await;
    let message = report.expect("auth.issuers", "fail");
    assert!(message.contains("was not called"), "{message}");
    assert_eq!(server.hits(Endpoint::Introspection), before);
    let message = report.expect("auth.secrets", "fail");
    assert!(
        message.contains("UMBEL_TEST_INTROSPECTION_SECRET"),
        "{message}"
    );

    // An endpoint that calls any token active cannot be trusted to introspect.
    let all_active = TestIdp::start().await.unwrap();
    all_active
        .authorization_server()
        .set_metadata_patch(Some(json!({ "subject_types_supported": ["public"] })));
    all_active.authorization_server().register_client(
        Client::confidential("umbel-resource", INTROSPECTION_SECRET).introspection(),
    );
    all_active.authorization_server().set_fault(
        Endpoint::Introspection,
        Fault::Body(r#"{"active":true}"#.into()),
    );
    let dir = workspace(&config(&all_active, &introspected));
    let message = doctor_with(dir.path(), &all_active, with_secret(INTROSPECTION_SECRET))
        .await
        .expect("auth.issuers", "fail");
    assert!(message.contains("made up active"), "{message}");
}

// ─── ca_file reaches the issuer, and only its issuer ─────────────────────────────────────────

#[tokio::test]
async fn an_issuer_with_a_ca_file_is_reached_through_its_roots_alone() {
    let kit = kit().await;
    // The kit's CA is the issuer's ca_file, and is not among the "platform's" roots: reached.
    let with_ca = Config {
        issuer: "algorithms = [\"ES256\", \"RS256\"]\nservices = { clients = [\"build-bot\"] }\nca_file = \"trust/as.pem\"",
        ..Config::default()
    };
    let dir = workspace(&config(&kit, &with_ca));
    std::fs::create_dir_all(dir.path().join("trust")).unwrap();
    std::fs::write(dir.path().join("trust/as.pem"), kit.ca().certificate_pem()).unwrap();
    let run = cli_with(
        dir.path(),
        &["workspace", "doctor"],
        Scripted::no_terminal(),
        |builder| builder.with_auth_secret("UMBEL_TEST_PERSON_SECRET", PERSON_SECRET),
    )
    .await;
    let report = Report::new(run);
    let issuers = report.expect("auth.issuers", "fail");
    // `as` is reached through its own root; `idp`, with no ca_file, is not (its CA is no
    // platform root here), so only `idp` fails.
    assert!(!issuers.contains("as:"), "{issuers}");
    assert!(
        issuers.contains("idp: its metadata cannot be reached"),
        "{issuers}"
    );

    // Another CA as the issuer's ca_file, with the kit's CA among the platform's roots: refused,
    // since a ca_file replaces the platform's roots for its issuer; idp is unaffected.
    std::fs::write(dir.path().join("trust/as.pem"), year_ca().certificate_pem()).unwrap();
    let report = doctor(dir.path(), &kit).await;
    let issuers = report.expect("auth.issuers", "fail");
    assert!(
        issuers.contains("as: its metadata cannot be reached"),
        "{issuers}"
    );
    assert!(!issuers.contains("idp:"), "{issuers}");
}

// ─── auth.subjects ───────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn subjects_must_be_public_where_sub_names_people() {
    let kit = kit().await;
    let dir = workspace(&config(&kit, &Config::default()));
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.subjects", "pass");
    // Two issuers in one namespace: the deployer's assertion is printed.
    assert!(
        message.contains("namespace corp joins idp (sub) and as (sub)"),
        "{message}"
    );
    assert!(message.contains("Umbel cannot verify"), "{message}");

    // Pairwise only: fail.
    kit.authorization_server()
        .set_metadata_patch(Some(json!({ "subject_types_supported": ["pairwise"] })));
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.subjects", "fail");
    assert!(
        message.contains("as: its subject_types_supported lacks public"),
        "{message}"
    );

    // The OpenID Connect document is read when there is one: a provider whose RFC 8414 document
    // says public while its OpenID Connect document says pairwise fails.
    let server = kit.authorization_server();
    server.set_metadata_patch(Some(json!({ "subject_types_supported": ["public"] })));
    let mut oidc = server.metadata();
    oidc["subject_types_supported"] = json!(["pairwise"]);
    server.set_fault(Endpoint::OpenidMetadata, Fault::Body(oidc.to_string()));
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.subjects", "fail");
    assert!(
        message.contains("as: its subject_types_supported lacks public"),
        "{message}"
    );
    server.clear_fault(Endpoint::OpenidMetadata);

    // An OpenID Connect document must publish the member: without it, a failure.
    server.set_metadata_patch(None);
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.subjects", "fail");
    assert!(
        message
            .contains("its OpenID Connect discovery document publishes no subject_types_supported"),
        "{message}"
    );

    // No OpenID Connect document at all, and an RFC 8414 one without it: cannot be confirmed, a
    // warning.
    server.set_fault(Endpoint::OpenidMetadata, Fault::Status(404));
    server.set_fault(Endpoint::OpenidMetadataAppended, Fault::Status(404));
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.subjects", "warn");
    assert!(
        message.contains("as: it publishes no OpenID Connect discovery document"),
        "{message}"
    );
    server.clear_fault(Endpoint::OpenidMetadata);
    server.clear_fault(Endpoint::OpenidMetadataAppended);

    // A subject claim other than sub needs no metadata.
    let oid = Config {
        issuer: "algorithms = [\"ES256\", \"RS256\"]\nservices = { clients = [\"build-bot\"] }\nsubject_claim = \"oid\"",
        ..Config::default()
    };
    std::fs::write(dir.path().join("umbel.toml"), config(&kit, &oid)).unwrap();
    doctor(dir.path(), &kit)
        .await
        .expect("auth.subjects", "pass");
}

// ─── auth.services ───────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn services_warn_when_an_issuer_marks_no_service_token() {
    let kit = kit().await;
    let without = Config {
        issuer: "algorithms = [\"ES256\", \"RS256\"]",
        ..Config::default()
    };
    let dir = workspace(&config(&kit, &without));
    let report = doctor(dir.path(), &kit).await;
    let message = report.expect("auth.services", "warn");
    assert!(message.starts_with("as set(s) neither"), "{message}");
    // The login-only issuer issues no access token, so it is not named.
    assert!(!message.contains("idp"), "{message}");
}

// ─── auth.principals ─────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn principals_fail_on_an_entry_no_namespace_or_equivalent_produces() {
    let kit = kit().await;
    let orphan = Config {
        rest: "[spaces.team]\nreaders = [\"human:ada\", \"group:eng\"]\n\n[access.groups.eng]\nmembers = [\"agent:elsewhere/bot\", \"*\"]\n",
        ..Config::default()
    };
    let dir = workspace(&config(&kit, &orphan));
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.principals", "fail");
    assert!(
        message.contains("`human:ada` in spaces.team.readers"),
        "{message}"
    );
    assert!(
        message.contains("`agent:elsewhere/bot` in access.groups.eng.members"),
        "{message}"
    );

    // Mapped one way to a namespaced principal, the legacy entry grants that person again.
    let mapped = Config {
        principal: "local_id = \"corp/ada\"\n\n[principal.equivalents]\n\"human:ada\" = \"human:corp/ada\"",
        rest: "[spaces.team]\nreaders = [\"human:ada\", \"group:eng\"]\n\n[access.groups.eng]\nmembers = [\"agent:corp/bot\"]\n",
        ..Config::default()
    };
    std::fs::write(dir.path().join("umbel.toml"), config(&kit, &mapped)).unwrap();
    doctor(dir.path(), &kit)
        .await
        .expect("auth.principals", "pass");
}

// ─── auth.person ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_person_login_must_be_user_verified_at_its_provider() {
    let kit = kit().await;
    let idp = kit.identity_provider();
    let dir = workspace(&config(&kit, &Config::default()));
    let message = doctor(dir.path(), &kit).await.expect("auth.person", "pass");
    assert!(message.contains("corp"), "{message}");

    // The provider does not list the configured class.
    idp.set_metadata_patch(Some(json!({ "acr_values_supported": ["phrh"] })));
    let message = doctor(dir.path(), &kit).await.expect("auth.person", "fail");
    assert!(
        message.contains("acr_values_supported lacks phr"),
        "{message}"
    );

    // Its ID tokens do not carry amr.
    idp.set_metadata_patch(Some(json!({
        "claims_supported": ["iss", "sub", "aud", "exp", "iat", "acr"],
    })));
    let message = doctor(dir.path(), &kit).await.expect("auth.person", "fail");
    assert!(message.contains("claims_supported lacks amr"), "{message}");

    // Neither is published: cannot be confirmed before a login, a warning each.
    idp.set_metadata_patch(Some(json!({
        "acr_values_supported": null,
        "claims_supported": null,
    })));
    let message = doctor(dir.path(), &kit).await.expect("auth.person", "warn");
    assert!(
        message.contains("publishes no acr_values_supported"),
        "{message}"
    );
    assert!(
        message.contains("publishes no claims_supported"),
        "{message}"
    );
    idp.set_metadata_patch(None);

    // The provider unreachable: the login cannot be confirmed, a failure.
    idp.set_fault(Endpoint::OauthMetadata, Fault::Status(500));
    let message = doctor(dir.path(), &kit).await.expect("auth.person", "fail");
    assert!(message.contains("cannot be confirmed"), "{message}");
}

// ─── auth.secrets ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn secrets_are_named_by_variable_and_never_printed() {
    let kit = kit().await;
    let dir = workspace(&config(&kit, &Config::default()));
    let report = doctor(dir.path(), &kit).await;
    let message = report.expect("auth.secrets", "pass");
    assert!(message.contains("UMBEL_TEST_PERSON_SECRET"), "{message}");
    assert!(!report.run.stdout.contains(PERSON_SECRET));

    // Unset (without the seam, and not in this process's environment): a failure naming the
    // variable and its key, never a value.
    let run = cli_with(
        dir.path(),
        &["workspace", "doctor"],
        Scripted::no_terminal(),
        |builder| {
            builder.with_auth_root_certificate(kit.ca().certificate_pem().as_bytes().to_vec())
        },
    )
    .await;
    let report = Report::new(run);
    let message = report.expect("auth.secrets", "fail");
    assert!(
        message.contains(
            "UMBEL_TEST_PERSON_SECRET (auth.namespaces.corp.person.client_secret_env) is unset or empty"
        ),
        "{message}"
    );
    // An empty value is no secret either.
    let report = doctor_with(dir.path(), &kit, |builder| {
        builder.with_auth_secret("UMBEL_TEST_PERSON_SECRET", "")
    })
    .await;
    report.expect("auth.secrets", "fail");
}

// ─── auth.shared ─────────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
#[tokio::test]
async fn shared_state_must_be_writable() {
    let kit = kit().await;
    let dir = workspace(&config(&kit, &Config::default()));
    doctor(dir.path(), &kit).await.expect("auth.shared", "pass");
    let shared = dir.path().join("state/shared");
    std::fs::create_dir_all(&shared).unwrap();
    chmod(&shared, 0o500);
    let message = doctor(dir.path(), &kit).await.expect("auth.shared", "fail");
    chmod(&shared, 0o700);
    assert!(message.contains("state/shared/"), "{message}");
}

// ─── auth.confirmations ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn confirmations_must_not_be_enforce_in_a_hosted_mode() {
    let kit = kit().await;
    let enforce = Config {
        mcp: "",
        ..Config::default()
    };
    let dir = workspace(&config(&kit, &enforce));
    let report = doctor(dir.path(), &kit).await;
    let message = report.expect("auth.confirmations", "fail");
    assert!(message.contains("\"enforce\""), "{message}");
    assert_eq!(report.value["error"]["code"], json!("WORKSPACE_UNHEALTHY"));
    assert_eq!(report.run.code, 1);
    std::fs::write(
        dir.path().join("umbel.toml"),
        config(&kit, &Config::default()),
    )
    .unwrap();
    doctor(dir.path(), &kit)
        .await
        .expect("auth.confirmations", "pass");
}

// ─── A configuration that does not open ──────────────────────────────────────────────────────

#[tokio::test]
async fn a_hosted_workspace_that_does_not_open_skips_the_hosted_checks() {
    let kit = kit().await;
    // A rule across tables fails at open: the hosted checks are skipped, not guessed at.
    let text =
        config(&kit, &Config::default()).replace("local_id = \"corp/ada\"", "local_id = \"ada\"");
    let dir = workspace(&text);
    let report = doctor(dir.path(), &kit).await;
    report.expect("config.parse", "fail");
    for id in umbel::doctor::AUTH_CHECKS {
        assert_eq!(report.status(id), "skip", "{id}: {}", report.message(id));
    }
}

// ─── The doctor is the operator's in a hosted mode ───────────────────────────────────────────

#[tokio::test]
async fn in_a_hosted_mode_the_doctor_is_the_operators_alone() {
    let running = Running::start(Setup::default()).await;
    let token = running.token().sign();
    // MCP lists it nowhere: neither in tools/list nor in afd-discover.
    let listed = modern(&running.client, "tools/list", json!({}), Some(&token)).await;
    assert_eq!(listed.status, 200, "{}", listed.text);
    assert!(!listed.text.contains("workspace-doctor"), "{}", listed.text);
    let discovered = running
        .result(&token, "afd-discover", json!({ "limit": 200 }))
        .await;
    assert!(
        !discovered.to_string().contains("workspace-doctor"),
        "{discovered}"
    );
    // Nor serves it.
    let called = running
        .result(
            &token,
            "afd-call",
            json!({ "command": "workspace-doctor", "input": {} }),
        )
        .await;
    assert_eq!(called["success"], json!(false), "{called}");
    assert!(!called.to_string().contains("auth.issuers"), "{called}");
    assert!(
        !called
            .to_string()
            .contains(&running.dir.path().display().to_string()),
        "{called}"
    );

    // The library is refused whatever route reached the handler.
    let host = &running.host;
    let context = host.context(Actor::new(ActorKind::Human).with_id("corp/ada"));
    let result = host
        .registry()
        .execute("workspace-doctor", json!({}), Some(context))
        .await;
    let error = result.error.expect("refused");
    assert_eq!(error.code, "COMMAND_NOT_EXPOSED");

    // The operator, at the CLI, gets the report.
    let run = cli_with(
        running.dir.path(),
        &["workspace", "doctor"],
        Scripted::no_terminal(),
        |builder| {
            builder
                .with_auth_root_certificate(running.kit.ca().certificate_pem().as_bytes().to_vec())
                .register(support::oauth::whoami())
                .register(support::oauth::touch())
        },
    )
    .await;
    let report = Report::new(run);
    report.check("auth.issuers");
}

// ─── Regressions from the step's security review ─────────────────────────────────────────────

#[tokio::test]
async fn the_person_login_is_judged_by_the_providers_openid_connect_document() {
    // The RFC 8414 document lists acr and amr; the OpenID Connect one, which the person page reads,
    // does not list amr: a failure.
    let kit = kit().await;
    let idp = kit.identity_provider();
    let mut oidc = idp.metadata();
    oidc["claims_supported"] = json!(["iss", "sub", "aud", "exp", "iat", "acr"]);
    idp.set_fault(Endpoint::OpenidMetadata, Fault::Body(oidc.to_string()));
    let dir = workspace(&config(&kit, &Config::default()));
    let message = doctor(dir.path(), &kit).await.expect("auth.person", "fail");
    assert!(message.contains("claims_supported lacks amr"), "{message}");
}

#[tokio::test]
async fn the_metadata_and_the_key_set_share_one_time_limit_as_the_verifiers_fetch_does() {
    // Each answer alone fits the limit; together they do not, so the verifier would refuse the
    // issuer, and the doctor must say so.
    let kit = kit().await;
    let server = kit.authorization_server();
    server.set_fault(
        Endpoint::OauthMetadata,
        Fault::Delay(std::time::Duration::from_millis(700)),
    );
    server.set_fault(
        Endpoint::Jwks,
        Fault::Delay(std::time::Duration::from_millis(700)),
    );
    let dir = workspace(&config(&kit, &Config::default()));
    let report = doctor_with(dir.path(), &kit, |builder| {
        builder.with_auth_fetch_timeout(std::time::Duration::from_millis(1_000))
    })
    .await;
    let message = report.expect("auth.issuers", "fail");
    assert!(
        message.contains("as: its key set did not answer within the time limit"),
        "{message}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn trust_files_are_read_only_when_they_are_small_regular_files_no_one_else_can_replace() {
    let kit = kit().await;
    let with_ca = Config {
        issuer: "algorithms = [\"ES256\", \"RS256\"]\nservices = { clients = [\"build-bot\"] }\nca_file = \"trust/as.pem\"",
        ..Config::default()
    };
    let dir = workspace(&config(&kit, &with_ca));
    let trust = dir.path().join("trust");
    std::fs::create_dir_all(&trust).unwrap();
    // A directory: refused before any read.
    std::fs::create_dir_all(trust.join("as.pem")).unwrap();
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.ca_files", "fail");
    assert!(message.contains("is not a regular file"), "{message}");
    std::fs::remove_dir(trust.join("as.pem")).unwrap();
    // A FIFO: refused at once, never waited on.
    let made = std::process::Command::new("mkfifo")
        .arg(trust.join("as.pem"))
        .status()
        .unwrap();
    assert!(made.success());
    let started = std::time::Instant::now();
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.ca_files", "fail");
    assert!(message.contains("is not a regular file"), "{message}");
    assert!(started.elapsed() < std::time::Duration::from_secs(20));
    std::fs::remove_file(trust.join("as.pem")).unwrap();
    // A good root in a directory anyone may write, without the sticky bit: refused, since anyone
    // could replace it by a rename.
    std::fs::write(trust.join("as.pem"), kit.ca().certificate_pem()).unwrap();
    chmod(&trust, 0o777);
    let message = doctor(dir.path(), &kit)
        .await
        .expect("auth.ca_files", "fail");
    assert!(message.contains("without the sticky bit"), "{message}");
    chmod(&trust, 0o1777);
    doctor(dir.path(), &kit)
        .await
        .expect("auth.ca_files", "warn");
    chmod(&trust, 0o755);
}

#[tokio::test]
async fn a_host_sealed_in_mode_none_does_not_report_a_hosted_profile_once_the_file_turns_hosted() {
    let kit = kit().await;
    let dir = workspace("config_version = 5\n");
    let host = umbel::HostBuilder::open(dir.path())
        .unwrap()
        .seal()
        .unwrap();
    let context = host.context(Actor::new(ActorKind::Agent).with_id("anyone"));
    let before = host
        .registry()
        .execute("workspace-doctor", json!({}), Some(context.clone()))
        .await;
    assert!(before.error.is_none_or(|e| e.code != "COMMAND_NOT_EXPOSED"));
    std::fs::write(
        dir.path().join("umbel.toml"),
        config(&kit, &Config::default()),
    )
    .unwrap();
    let after = host
        .registry()
        .execute("workspace-doctor", json!({}), Some(context))
        .await;
    assert_eq!(after.error.expect("refused").code, "COMMAND_NOT_EXPOSED");
}

#[tokio::test]
async fn neither_stdio_nor_a_forged_cli_principal_is_the_operator() {
    let running = Running::start(Setup::default()).await;
    // stdio: MCP does not serve the doctor in a hosted mode.
    let mut stdio = umbel::testkit::mcp::Client::connect(
        &running.host,
        umbel::testkit::mcp::Transport::Stdio,
        umbel::testkit::mcp::Era::Modern,
    )
    .await;
    let result = stdio.afd_call("workspace-doctor", json!({})).await;
    assert_eq!(result["success"], json!(false), "{result}");
    assert!(!result.to_string().contains("auth.issuers"), "{result}");
    // A library context carrying the CLI's principal, but not the CLI's interface, is refused.
    let mut context = afd::CommandContext::new();
    let principal = umbel::principal::Principal::new(
        Actor::new(ActorKind::Human).with_id("corp/ada"),
        umbel::principal::Transport::Cli,
        umbel::principal::Authentication::Process,
    );
    context.actor = Some(principal.actor.clone());
    context.extra.insert(
        umbel::principal::PRINCIPAL_KEY.to_owned(),
        principal.to_value(),
    );
    let result = running
        .host
        .registry()
        .execute("workspace-doctor", json!({}), Some(context))
        .await;
    assert_eq!(result.error.expect("refused").code, "COMMAND_NOT_EXPOSED");
}
