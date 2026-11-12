//! Adding an account (the specification's sections 3.5 and 11): a person's
//! command, held for the person's approval at the terminal, with the sign-in
//! asked for without echo and kept in the keychain, never in the command.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;

use loam_mail::cli::{Caller, EXIT_FAILED, EXIT_OK, Person, run};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::provider::ProviderError;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, ImapConnector};
use loam_mail::secrets::{InMemory, Secrets, SecretsError, account_key};
use support::imap::{PASSWORD, Server, USER, message};

/// A person who answers as scripted, and remembers what was asked.
#[derive(Default)]
struct Scripted {
    approve: bool,
    password: String,
    asked: Vec<String>,
}

impl Person for Scripted {
    fn confirm(&mut self, question: &str) -> std::io::Result<bool> {
        self.asked.push(question.to_string());
        Ok(self.approve)
    }

    fn secret(&mut self, prompt: &str) -> std::io::Result<String> {
        self.asked.push(prompt.to_string());
        Ok(self.password.clone())
    }
}

struct Fixture {
    _directory: tempfile::TempDir,
    server: Server,
    secrets: Arc<InMemory>,
    engine: Arc<Engine>,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let server = Server::start(true, true);
        {
            let mut world = server.world();
            world.mailbox("INBOX", &[]);
            world.add("INBOX", message(1, "Hello", None, "hi"), &[]);
        }
        let secrets = Arc::new(InMemory::default());
        // As the program does: the connector signs in with what the
        // keychain holds for the account.
        let keychain = Arc::clone(&secrets);
        let endpoint = Endpoint {
            host: "127.0.0.1".to_string(),
            port: server.address.port(),
            tls: false,
        };
        let connector = ImapConnector::new(endpoint, ICLOUD_NAMES, move |account| {
            match keychain.get(&account_key(&account.provider, &account.address)) {
                Ok(Some(password)) => Ok(Credentials {
                    user: account.address.clone(),
                    password,
                }),
                Ok(None) => Err(ProviderError::NoCredential),
                Err(_) => Err(ProviderError::Keychain),
            }
        });
        let engine = Engine::new(Some(Home::at(directory.path().join("data"))))
            .with_connector(Arc::new(connector))
            .with_secrets(Arc::clone(&secrets) as Arc<dyn Secrets>);
        Self {
            _directory: directory,
            server,
            secrets,
            engine: Arc::new(engine),
        }
    }

    /// Runs the command line; returns the status, standard output and error.
    fn run(&self, args: &[&str], person: Option<&mut Scripted>) -> (u8, String, String) {
        let registry = loam_mail::registry(&self.engine).unwrap();
        let args: Vec<String> = args.iter().map(ToString::to_string).collect();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let caller = match person {
            Some(person) => Caller::Terminal(person),
            None => Caller::Script,
        };
        let status = run(
            &args,
            &registry,
            caller,
            self.secrets.as_ref(),
            &mut out,
            &mut err,
        )
        .unwrap();
        (
            status,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    fn accounts(&self) -> usize {
        self.engine
            .with_store(|store| store.accounts())
            .unwrap()
            .len()
    }
}

fn add_input() -> String {
    format!(r#"{{"provider": "icloud", "address": "{USER}"}}"#)
}

/// Nothing a person's command prints carries a token or the password.
fn assert_nothing_secret(out: &str, err: &str) {
    for text in [out, err] {
        assert!(!text.contains("afdap1."), "a token was printed: {text}");
        assert!(!text.contains(PASSWORD), "the password was printed");
    }
}

#[test]
fn from_a_script_a_persons_command_fails_with_person_required() {
    let fixture = Fixture::new();
    let (status, out, err) = fixture.run(&["mail-account-add", &add_input()], None);
    assert_eq!(status, EXIT_FAILED);
    let result: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(result["error"]["code"], "PERSON_REQUIRED");
    assert_nothing_secret(&out, &err);
    assert_eq!(fixture.accounts(), 0);
    assert!(
        fixture.server.take_log().is_empty(),
        "nothing was contacted"
    );
}

#[test]
fn declining_at_the_terminal_does_nothing() {
    let fixture = Fixture::new();
    let mut person = Scripted::default();
    let (status, out, err) = fixture.run(&["mail-account-add", &add_input()], Some(&mut person));
    assert_eq!(status, EXIT_FAILED);
    assert!(out.is_empty(), "{out}");
    assert!(err.contains("Nothing was done"), "{err}");
    assert_eq!(
        person.asked,
        vec!["Go ahead? [y/N] "],
        "no password is asked"
    );
    assert_eq!(
        fixture.secrets.get(&account_key("icloud", USER)).unwrap(),
        None
    );
    assert_eq!(fixture.accounts(), 0);
}

#[test]
fn approving_keeps_the_sign_in_in_the_keychain_and_adds_the_account() {
    let fixture = Fixture::new();
    let mut person = Scripted {
        approve: true,
        password: PASSWORD.to_string(),
        ..Scripted::default()
    };
    let (status, out, err) = fixture.run(&["mail-account-add", &add_input()], Some(&mut person));
    assert_eq!(status, EXIT_OK, "{out}{err}");
    assert_nothing_secret(&out, &err);
    // The summary names the account, then the question, then the password.
    assert!(
        err.contains(&format!("Add the icloud account {USER}, and sign in")),
        "{err}"
    );
    assert_eq!(person.asked.len(), 2);
    assert!(person.asked[1].starts_with("App-specific password for"));
    let result: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(result["data"]["added"], true);
    assert_eq!(
        fixture.secrets.get(&account_key("icloud", USER)).unwrap(),
        Some(PASSWORD.to_string())
    );
    // The sign-in was checked: the server saw a sign-in and nothing else of
    // note.
    let log = fixture.server.take_log();
    assert!(log.iter().any(|command| command == "LOGIN"), "{log:?}");
    assert!(!log.iter().any(|command| command.starts_with("EXAMINE")));

    // The account is listed, and syncs with the kept sign-in.
    let (status, out, _) = fixture.run(&["mail-account-list"], None);
    assert_eq!(status, EXIT_OK);
    let listed: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(listed["data"]["accounts"][0]["provider"], "icloud");
    let (status, out, _) = fixture.run(&["mail-sync"], None);
    assert_eq!(status, EXIT_OK, "{out}");

    // Adding it again changes nothing and says so.
    let mut again = Scripted {
        approve: true,
        password: PASSWORD.to_string(),
        ..Scripted::default()
    };
    let (status, out, _) = fixture.run(&["mail-account-add", &add_input()], Some(&mut again));
    assert_eq!(status, EXIT_OK);
    let result: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(result["data"]["added"], false);
    assert_eq!(fixture.accounts(), 1);
}

#[test]
fn a_sign_in_the_provider_refuses_adds_nothing() {
    let fixture = Fixture::new();
    let mut person = Scripted {
        approve: true,
        password: "not-the-password".to_string(),
        ..Scripted::default()
    };
    let (status, out, err) = fixture.run(&["mail-account-add", &add_input()], Some(&mut person));
    assert_eq!(status, EXIT_FAILED);
    let result: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(result["error"]["code"], "SIGN_IN_REQUIRED");
    assert!(!out.contains("not-the-password") && !err.contains("not-the-password"));
    assert_eq!(fixture.accounts(), 0);
    assert_eq!(
        fixture.secrets.get(&account_key("icloud", USER)).unwrap(),
        None,
        "the refused password is not kept"
    );

    // Nor does a mistyped one replace one that works.
    fixture
        .secrets
        .set(&account_key("icloud", USER), PASSWORD)
        .unwrap();
    let mut typo = Scripted {
        approve: true,
        password: "typo".to_string(),
        ..Scripted::default()
    };
    let (status, _, _) = fixture.run(&["mail-account-add", &add_input()], Some(&mut typo));
    assert_eq!(status, EXIT_FAILED);
    assert_eq!(
        fixture.secrets.get(&account_key("icloud", USER)).unwrap(),
        Some(PASSWORD.to_string())
    );
}

#[test]
fn input_that_cannot_be_added_is_refused_without_asking() {
    let fixture = Fixture::new();
    let mut person = Scripted {
        approve: true,
        ..Scripted::default()
    };
    let (status, out, _) = fixture.run(
        &[
            "mail-account-add",
            r#"{"provider": "icloud", "address": "not an address"}"#,
        ],
        Some(&mut person),
    );
    assert_eq!(status, EXIT_FAILED);
    let result: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(result["error"]["code"], "INVALID_INPUT");
    assert!(person.asked.is_empty(), "{:?}", person.asked);

    // A provider this build cannot add is refused by the input's own schema.
    let (status, out, _) = fixture.run(
        &[
            "mail-account-add",
            r#"{"provider": "gmail", "address": "a@example.com"}"#,
        ],
        Some(&mut person),
    );
    assert_eq!(status, EXIT_FAILED);
    assert!(person.asked.is_empty());
    let result: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_ne!(result["success"], true);
}

#[test]
fn a_persons_command_is_not_offered_over_mcp() {
    let fixture = Fixture::new();
    let registry = loam_mail::registry(&fixture.engine).unwrap();
    let add = registry
        .list()
        .into_iter()
        .find(|command| command.name == "mail-account-add")
        .unwrap();
    assert!(add.expose.cli);
    assert!(!add.expose.mcp && !add.expose.agent && !add.expose.palette);
    assert!(add.approval.is_some());
}

#[test]
fn an_address_differing_only_in_the_case_of_its_domain_is_one_account() {
    let fixture = Fixture::new();
    let mut person = Scripted {
        approve: true,
        password: PASSWORD.to_string(),
        ..Scripted::default()
    };
    let (status, _, _) = fixture.run(&["mail-account-add", &add_input()], Some(&mut person));
    assert_eq!(status, EXIT_OK);
    let (local, domain) = USER.split_once('@').unwrap();
    let shouted = format!(
        r#"{{"provider": "icloud", "address": "{local}@{}"}}"#,
        domain.to_ascii_uppercase()
    );
    let mut again = Scripted {
        approve: true,
        password: PASSWORD.to_string(),
        ..Scripted::default()
    };
    let (status, out, _) = fixture.run(&["mail-account-add", &shouted], Some(&mut again));
    assert_eq!(status, EXIT_OK, "{out}");
    let result: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(result["data"]["added"], false);
    assert_eq!(fixture.accounts(), 1);
}

#[test]
fn an_empty_password_does_nothing() {
    let fixture = Fixture::new();
    let mut person = Scripted {
        approve: true,
        ..Scripted::default()
    };
    let (status, out, err) = fixture.run(&["mail-account-add", &add_input()], Some(&mut person));
    assert_eq!(status, EXIT_FAILED);
    assert!(out.is_empty());
    assert!(err.contains("No password was given"), "{err}");
    assert_eq!(fixture.accounts(), 0);
    assert!(fixture.server.take_log().is_empty());
}

/// A keychain that refuses, as a locked one does.
struct Locked;

impl Secrets for Locked {
    fn get(&self, _key: &str) -> Result<Option<String>, SecretsError> {
        Err(SecretsError::Refused)
    }
    fn set(&self, _key: &str, _secret: &str) -> Result<(), SecretsError> {
        Err(SecretsError::Refused)
    }
    fn delete(&self, _key: &str) -> Result<(), SecretsError> {
        Err(SecretsError::Refused)
    }
}

#[test]
fn a_locked_keychain_is_known_before_a_password_is_typed() {
    let fixture = Fixture::new();
    let registry = loam_mail::registry(&fixture.engine).unwrap();
    let args: Vec<String> = ["mail-account-add".to_string(), add_input()].to_vec();
    let mut person = Scripted {
        approve: true,
        password: PASSWORD.to_string(),
        ..Scripted::default()
    };
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let status = run(
        &args,
        &registry,
        Caller::Terminal(&mut person),
        &Locked,
        &mut out,
        &mut err,
    )
    .unwrap();
    assert_eq!(status, EXIT_FAILED);
    let err = String::from_utf8(err).unwrap();
    assert!(err.contains("the keychain refused"), "{err}");
    assert_eq!(
        person.asked,
        vec!["Go ahead? [y/N] "],
        "no password was asked"
    );
    assert_eq!(fixture.accounts(), 0);
}
