//! Person decisions, from begin to the run (phase 5 specification, sections 7.1 to 7.3): the one
//! service the relay, the page and the CLI share, in a hosted mode only.
//!
//! - **Begin** (7.2, step 1): for a `verified` command on the caller's surface, after the call was
//!   validated (AFD's gate, or the CLI) and only when the caller's namespace serves verified
//!   commands, the call's spaces are readable to it (5.4's one answer otherwise, so no person is
//!   asked about a call that would be refused), and `person_pages_per_hour` admits another begin
//!   for its effective principal. A decision keeps only the preview's declared properties, each a
//!   value 2.3's `keep` rule allows (an input it could not keep is refused rather than cut).
//! - **Spend** (7.2, step 5): once, as `person:<id>` in the shared nonce store, by the relay's
//!   `resume` or the CLI, kept for the relay's 24 hours.
//! - **Run**: the context fields of [`super::PERSON_DECISION_KEY`] and `humanPresent`, which the
//!   plugin gate checks against the decision read back and spends again, as `person-run:<id>`.
//! - **Journal**: each decision, when the person makes it, as a host `person-decide` entry under
//!   the trace of the call that began it, keeping `id`, `level` and `decision` alone.

use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Mutex, PoisonError};

use afd::{Clock, CommandContext, CommandError, CommandRegistry, error_codes};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use super::oidc::Provider;
use super::{DecisionFor, PersonMark, Surface, unavailable};
use crate::access::{Caller, reader_filter};
use crate::auth::fetch::{AuthEnvironment, Fetcher, for_issuer};
use crate::plugins::Assurance;
use crate::principal::{HumanPresent, PRINCIPAL_KEY, Principal};
use crate::shared::SharedError;
use crate::shared::limits::{Admission, LimitStore};
use crate::shared::nonces::NonceStore;
use crate::shared::person::{Decision, NewDecision, PersonStore};
use crate::workspace::Workspace;

/// How long a spent decision's key is kept: the relay's 24 hours (step 0d's amendment).
const SPENT_KEEP_MS: i64 = 24 * 3_600_000;
/// The window of `person_pages_per_hour`.
const PAGE_WINDOW_MS: i64 = 3_600_000;
/// Most properties a decision keeps, and the longest string (`person-decision.v1`).
const MAX_PROPERTIES: usize = 16;
const MAX_PROPERTY_CHARS: usize = 512;
const MAX_PROPERTY_ITEMS: usize = 100;

/// A command whose `person` names `verified` on some surface: what its decisions need.
#[derive(Debug, Clone)]
pub(crate) struct PersonCommand {
    /// Its `confirm_preview`.
    pub(crate) preview: String,
    /// The preview's declared input properties.
    pub(crate) properties: Vec<String>,
    pub(crate) cli: Assurance,
    pub(crate) mcp: Option<Assurance>,
    /// Whether its spaces come from its input (else the default space).
    pub(crate) spaced: bool,
}

impl PersonCommand {
    fn verified_on(&self, surface: Surface) -> bool {
        match surface {
            Surface::Cli => self.cli == Assurance::Verified,
            Surface::Mcp => self.mcp == Some(Assurance::Verified),
        }
    }
}

/// What a begin is asked about.
pub(crate) struct BeginRequest<'a> {
    pub(crate) who: DecisionFor,
    pub(crate) command: &'a str,
    /// The validated input.
    pub(crate) input: &'a Value,
    pub(crate) input_digest: &'a str,
    /// The context the call would run with.
    pub(crate) context: &'a CommandContext,
    pub(crate) surface: Surface,
}

/// The person decisions of one hosted workspace.
pub(crate) struct PersonService {
    workspace: Arc<Workspace>,
    registry: Arc<CommandRegistry>,
    pub(crate) store: Arc<dyn PersonStore>,
    nonces: Arc<dyn NonceStore>,
    limits: Mutex<Option<Arc<dyn LimitStore>>>,
    providers: BTreeMap<String, Arc<Provider>>,
    commands: BTreeMap<String, PersonCommand>,
    mcp: HashSet<String>,
    pub(crate) clock: Arc<dyn Clock>,
    projector: Arc<crate::events::Projector>,
    pub(crate) person_key: Vec<u8>,
    relay_key: Vec<u8>,
    /// The base of the page's URLs: `http.public_url` in mode `oauth`, `http.person.public_url`
    /// (an origin) in mode `gateway`.
    page_url: String,
}

impl std::fmt::Debug for PersonService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PersonService")
            .field("providers", &self.providers.len())
            .field("commands", &self.commands.len())
            .finish_non_exhaustive()
    }
}

/// A shared store's failure as a call's answer.
pub(crate) fn store_failure(error: &SharedError) -> CommandError {
    match error {
        SharedError::Timeout { store } => crate::shared::read_limit::shared_timeout(store),
        SharedError::Failed { store, message } => {
            tracing::error!(target: "umbel::person", store, %message, "a shared store failed; the person decision is refused");
            crate::shared::read_limit::store_failed()
        }
    }
}

/// 16 random bytes, unpadded lowercase base32: 26 characters (a decision's or a login's id).
pub(crate) fn random_id() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(crate::auth::caller::base32(&bytes))
}

/// Whether `text` is a 26-character id of [`random_id`]'s form.
pub(crate) fn is_id(text: &str) -> bool {
    text.len() == 26
        && text
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || (b'2'..=b'7').contains(&byte))
}

/// 32 random bytes, unpadded base64url: a PKCE verifier, a `nonce`, a browser value.
pub(crate) fn random_secret() -> Option<String> {
    use base64::Engine;
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).ok()?;
    Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

/// The lowercase hex SHA-256 of `text`.
pub(crate) fn sha256_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Whether `value` is a property a decision may keep (`journal.keep`'s rule, `person-decision.v1`).
fn keepable(value: &Value) -> bool {
    let text = |text: &str| {
        text.chars().count() <= MAX_PROPERTY_CHARS && !text.chars().any(char::is_control)
    };
    match value {
        Value::String(value) => text(value),
        Value::Number(_) | Value::Bool(_) => true,
        Value::Array(items) => {
            items.len() <= MAX_PROPERTY_ITEMS
                && items.iter().all(|item| item.as_str().is_some_and(text))
        }
        _ => false,
    }
}

impl PersonService {
    /// The service of a workspace that serves its person page (`loader::person_page_served`: mode
    /// `oauth`, or mode `gateway` with `[http.person]`, with `auth.filter_tools_by_scope`), else
    /// `None`. `commands` are the gated commands with a `verified` surface.
    ///
    /// # Errors
    /// `WORKSPACE_KEY_INVALID` or `WORKSPACE_STATE_UNWRITABLE` for `person.key` or `relay.key`.
    pub(crate) fn build(
        workspace: &Arc<Workspace>,
        registry: &Arc<CommandRegistry>,
        projector: &Arc<crate::events::Projector>,
        commands: BTreeMap<String, PersonCommand>,
        environment: &AuthEnvironment,
    ) -> Result<Option<Arc<Self>>, crate::host::HostError> {
        let config = workspace.config();
        if !crate::plugins::loader::person_page_served(config) {
            return Ok(None);
        }
        // Where the page is served: beside the MCP path in mode `oauth`; on its own origin in mode
        // `gateway` (step 5b), so every link and the redirect URI name a host the gateway never
        // serves.
        let page_url = match (config.auth.mode, &config.http.person) {
            (crate::workspace::AuthMode::Gateway, Some(person)) => person.public_url.clone(),
            (crate::workspace::AuthMode::Oauth, _) => match config.http.public_url.clone() {
                Some(url) => url,
                None => return Ok(None),
            },
            _ => return Ok(None),
        };
        let platform = Fetcher::new(environment);
        let mut providers = BTreeMap::new();
        for namespace in &config.auth.namespaces {
            let Some(login) = &namespace.person else {
                continue;
            };
            let Some(issuer) = config
                .auth
                .issuers
                .iter()
                .find(|issuer| issuer.alias == login.issuer)
            else {
                continue;
            };
            // The login issuer's own client: its `ca_file`'s roots alone when it has one, as
            // for every issuer (step 2c's follow-up); a file that cannot be used serves nothing.
            let fetcher = match &platform {
                Ok(platform) => for_issuer(issuer, workspace.root(), environment, platform),
                Err(problem) => Err(problem.clone()),
            };
            let fetcher = match fetcher {
                Ok(fetcher) => fetcher,
                Err(problem) => {
                    tracing::warn!(target: "umbel::person", namespace = namespace.id.as_str(), %problem, "a person login's issuer cannot be reached; its verified commands are not served");
                    continue;
                }
            };
            let secret = environment
                .secrets
                .get(&login.client_secret_env)
                .cloned()
                .or_else(|| std::env::var(&login.client_secret_env).ok())
                .filter(|value| !value.is_empty());
            providers.insert(
                namespace.id.clone(),
                Arc::new(
                    Provider::new(
                        &namespace.id,
                        &issuer.alias,
                        &issuer.issuer,
                        issuer.algorithms.clone(),
                        login.clone(),
                        fetcher,
                        environment,
                        config.auth.clock_skew_s,
                        secret,
                    )
                    .with_phishing_resistance(
                        config.auth.mode == crate::workspace::AuthMode::Gateway,
                    ),
                ),
            );
        }
        let layout = workspace.layout();
        let mcp = commands
            .iter()
            .filter(|(_, command)| command.verified_on(Surface::Mcp))
            .map(|(name, _)| name.clone())
            .collect();
        Ok(Some(Arc::new(Self {
            workspace: Arc::clone(workspace),
            registry: Arc::clone(registry),
            store: Arc::new(crate::shared::person::SqlitePerson::new(
                &layout.person_store(),
                config.store.lock_timeout_ms,
            )),
            nonces: Arc::new(crate::shared::nonces::SqliteNonces::new(
                &layout.nonces_store(),
                config.store.lock_timeout_ms,
            )),
            limits: Mutex::new(None),
            providers,
            commands,
            mcp,
            clock: Arc::clone(&environment.clock),
            projector: Arc::clone(projector),
            person_key: workspace.person_key()?,
            relay_key: workspace.relay_key()?,
            page_url,
        })))
    }

    pub(crate) fn now(&self) -> i64 {
        self.clock.now()
    }

    /// The commands served over MCP to verified persons.
    pub(crate) fn mcp_commands(&self) -> &HashSet<String> {
        &self.mcp
    }

    /// Whether `namespace`'s verified commands are served now (7.1): its login's provider passed
    /// `auth.person` within its cache's life. Never waits.
    pub(crate) fn served(&self, namespace: &str) -> bool {
        self.providers.get(namespace).is_some_and(Provider::served)
    }

    /// Check every person login now, as the server does at start.
    pub(crate) async fn check_logins(&self) {
        for provider in self.providers.values() {
            let _ = provider.ensure().await;
        }
    }

    pub(crate) fn provider(&self, namespace: &str) -> Option<&Arc<Provider>> {
        self.providers.get(namespace)
    }

    /// The person page's URL of decision `id` (7.2, step 1): `<http.public_url>/d/<id>` in mode
    /// `oauth`, `<http.person.public_url>/d/<id>` in mode `gateway`.
    pub(crate) fn url(&self, id: &str) -> String {
        format!("{}/d/{id}", self.page_url)
    }

    /// The URL the provider sends a login back to: the page's base, then `/d/return`.
    pub(crate) fn redirect_uri(&self) -> String {
        format!("{}/d/return", self.page_url)
    }

    /// The base of the page's URLs ([`Self::url`]).
    pub(crate) fn page_url(&self) -> &str {
        &self.page_url
    }

    fn limits(&self) -> Result<Arc<dyn LimitStore>, CommandError> {
        let mut held = self.limits.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(limits) = held.as_ref() {
            return Ok(Arc::clone(limits));
        }
        let config = self.workspace.config();
        let opened: Arc<dyn LimitStore> = Arc::new(
            crate::shared::limits::SqliteLimits::open(
                &self.workspace.layout().limits_store(),
                config.store.lock_timeout_ms,
            )
            .map_err(|_| crate::shared::read_limit::store_failed())?,
        );
        *held = Some(Arc::clone(&opened));
        Ok(opened)
    }

    /// Begin a decision (7.2, step 1). See the module's rules.
    ///
    /// # Errors
    /// `PERSON_VERIFICATION_UNAVAILABLE`, 5.4's one answer, `RATE_LIMITED`, `VALIDATION_ERROR` for
    /// a property the decision may not keep, or a shared store's failure.
    pub(crate) async fn begin(&self, request: BeginRequest<'_>) -> Result<Decision, CommandError> {
        let command = request.command;
        let Some(spec) = self
            .commands
            .get(command)
            .filter(|spec| spec.verified_on(request.surface))
        else {
            return Err(unavailable(command, "this command is not decided there"));
        };
        let Some(provider) = self.providers.get(&request.who.namespace) else {
            return Err(unavailable(
                command,
                "the caller's namespace has no usable person login",
            ));
        };
        if provider.ensure().await.is_err() {
            return Err(unavailable(
                command,
                "the caller's namespace's person login cannot be used now",
            ));
        }
        // Readability before anyone is asked (5.4): a call the registry would refuse is never
        // put to a person, and the refusal is the one answer.
        let config = self.workspace.config();
        let caller = Caller::of(config, request.context);
        let spaces = if spec.spaced {
            match self
                .workspace
                .resolve_spaces(request.input, request.context)
            {
                Ok(spaces) => spaces.into_iter().map(|space| space.to_string()).collect(),
                Err(error) => {
                    return Err(
                        if caller.gets_one_answer() && error.code == crate::host::SPACE_NOT_FOUND {
                            crate::access::space_unavailable()
                        } else {
                            error
                        },
                    );
                }
            }
        } else {
            vec![self.workspace.default_space().to_string()]
        };
        for space in &spaces {
            reader_filter(config, space, &caller)?;
        }
        // Only the preview's declared properties, each one a decision may keep.
        let mut properties = Map::new();
        if let Some(input) = request.input.as_object() {
            for name in &spec.properties {
                if let Some(value) = input.get(name) {
                    if value.is_null() {
                        continue;
                    }
                    if !keepable(value) {
                        return Err(CommandError::new(
                            error_codes::VALIDATION_ERROR,
                            format!(
                                "'{command}' cannot be decided on the person page: its input `{name}` is not an id the page may keep"
                            ),
                        )
                        .with_suggestion(
                            "Pass ids only (strings of at most 512 characters, numbers, booleans or lists of at most 100 such strings) in the inputs its preview reads.",
                        )
                        .with_retryable(false));
                    }
                    properties.insert(name.clone(), value.clone());
                }
            }
        }
        if properties.len() > MAX_PROPERTIES {
            return Err(CommandError::new(
                error_codes::VALIDATION_ERROR,
                format!("'{command}' cannot be decided on the person page: its preview reads more than {MAX_PROPERTIES} inputs"),
            )
            .with_retryable(false));
        }
        // `person_pages_per_hour` (11): begins per effective principal, on the shared counters,
        // named by an HMAC so the store holds no identifier.
        let principal = Principal::from_context(request.context)
            .and_then(|principal| crate::provenance::effective_principal(&principal.actor))
            .unwrap_or_else(|| format!("{}/{}", request.who.namespace, request.who.subject));
        let key = crate::shared::keyed_name(
            "person-page",
            &self
                .workspace
                .limits_key()
                .map_err(|_| crate::shared::read_limit::store_failed())?,
            &[&principal],
        );
        let limits = self.limits()?;
        let limit = config.limits.person_pages_per_hour;
        let admitted = tokio::task::spawn_blocking(move || {
            limits.hit(&key, limit, PAGE_WINDOW_MS, crate::shared::nonces::now_ms())
        })
        .await
        .map_err(|_| crate::shared::read_limit::store_failed())?
        .map_err(|error| store_failure(&error))?;
        if let Admission::Refused { retry_after_ms } = admitted {
            let mut details = std::collections::HashMap::new();
            details.insert("retryAfterMs".to_owned(), json!(retry_after_ms));
            return Err(CommandError::new(
                error_codes::RATE_LIMITED,
                "Too many person decisions were begun for this person in the last hour",
            )
            .with_suggestion(
                "Wait, then call it again; the person decides each request on its own page.",
            )
            .with_retryable(true)
            .with_details(details));
        }
        let now = self.clock.now();
        let id = random_id().ok_or_else(crate::shared::read_limit::store_failed)?;
        let new = NewDecision {
            id,
            for_: request.who,
            command: command.to_owned(),
            input_digest: request.input_digest.to_owned(),
            properties,
            spaces: spaces.clone(),
            chain: Principal::from_context(request.context)
                .map(|principal| principal.delegation_chain)
                .unwrap_or_default(),
            trace_id: request.context.trace_id.clone(),
            created_ms: now,
            expires_ms: now.saturating_add(
                i64::try_from(crate::auth::PERSON_DECISION_TTL_S * 1000).unwrap_or(0),
            ),
        };
        let store = Arc::clone(&self.store);
        let created = new.clone();
        tokio::task::spawn_blocking(move || store.create(&created, now))
            .await
            .map_err(|_| crate::shared::read_limit::store_failed())?
            .map_err(|error| store_failure(&error))?;
        Ok(Decision {
            id: new.id,
            for_: new.for_,
            command: new.command,
            input_digest: new.input_digest,
            properties: new.properties,
            spaces: new.spaces,
            chain: new.chain,
            trace_id: new.trace_id,
            created_ms: new.created_ms,
            expires_ms: new.expires_ms,
            status: crate::shared::person::Status::Pending,
            decided_ms: None,
            auth_time_ms: None,
            acr: None,
            preview_hash: None,
        })
    }

    /// The decision `id`, read back.
    pub(crate) async fn decision(&self, id: &str) -> Result<Option<Decision>, SharedError> {
        let store = Arc::clone(&self.store);
        let id = id.to_owned();
        tokio::task::spawn_blocking(move || store.decision(&id))
            .await
            .unwrap_or_else(|_| {
                Err(SharedError::Failed {
                    store: crate::shared::person::STORE,
                    message: "the read did not finish".to_owned(),
                })
            })
    }

    /// Spend a decided decision once for its call (7.2, step 5): `person:<id>`.
    pub(crate) async fn spend(&self, id: &str) -> Result<bool, SharedError> {
        self.consume(format!("person:{id}")).await
    }

    async fn consume(&self, key: String) -> Result<bool, SharedError> {
        let nonces = Arc::clone(&self.nonces);
        tokio::task::spawn_blocking(move || {
            let now = crate::shared::nonces::now_ms();
            nonces.consume(&key, now.saturating_add(SPENT_KEEP_MS), now)
        })
        .await
        .unwrap_or_else(|_| {
            Err(SharedError::Failed {
                store: "nonces",
                message: "the spend did not finish".to_owned(),
            })
        })
    }

    /// The host-owned `extra` fields of a call `decision` covers on `surface` (the module's
    /// "Run"): the mark, and `principal` with `humanPresent` set. `None` for a decision that is
    /// not approved.
    pub(crate) fn run_fields(
        &self,
        decision: &Decision,
        surface: Surface,
        principal: Option<Principal>,
    ) -> Option<Map<String, Value>> {
        if decision.status != crate::shared::person::Status::Approved {
            return None;
        }
        let at = super::iso(decision.decided_ms?);
        let auth_time = super::iso(decision.auth_time_ms?);
        let acr = decision.acr.clone()?;
        let mark = PersonMark {
            id: decision.id.clone(),
            command: decision.command.clone(),
            input_digest: decision.input_digest.clone(),
            surface,
            level: "verified".to_owned(),
            method: "person-page".to_owned(),
            namespace: decision.for_.namespace.clone(),
            auth_time: auth_time.clone(),
            acr: acr.clone(),
            at: at.clone(),
        };
        let mut principal = principal?;
        principal.human_present = Some(HumanPresent {
            level: "verified".to_owned(),
            method: "person-page".to_owned(),
            at,
            auth_time: Some(auth_time),
            acr: Some(acr),
        });
        let mut fields = Map::new();
        fields.insert(
            super::PERSON_DECISION_KEY.to_owned(),
            serde_json::to_value(mark).ok()?,
        );
        fields.insert(PRINCIPAL_KEY.to_owned(), principal.to_value());
        Some(fields)
    }

    /// Journal a decision the person made, as a host `person-decide` entry under the trace of
    /// the call that began it, digest-journaled: `id`, `level` and `decision`, nothing else.
    pub(crate) async fn journal(&self, decision: &Decision) {
        use afd::JournalSink;
        let verdict = match decision.status {
            crate::shared::person::Status::Approved => "approved",
            crate::shared::person::Status::Declined => "declined",
            crate::shared::person::Status::Pending => return,
        };
        let input = json!({ "id": decision.id, "level": "verified", "decision": verdict });
        let record = afd::JournalRecord {
            timestamp: super::iso(decision.decided_ms.unwrap_or_else(|| self.clock.now())),
            trace_id: decision.trace_id.clone(),
            command: "person-decide".to_owned(),
            input: input.clone(),
            actor: None,
            context_digest: afd::JournalContextDigest {
                hash: format!("sha256:{}", sha256_hex(&input.to_string())),
                interface: None,
            },
            context: None,
            context_omitted: None,
            output_budget: None,
            result: afd::success(input),
            duration_ms: 0.0,
            tape: None,
        };
        let sink = crate::events::ProjectingSink::new(Arc::clone(&self.projector));
        if let Err(error) = sink.append(record).await {
            tracing::error!(target: "umbel::person", "journal: {error}");
        }
    }

    /// The preview of `decision`, rendered now under the logged-in person's reader filter (7.2,
    /// step 4; D97's sanitising and caps): its text, and whether it could be shown. Nothing of it
    /// is stored.
    pub(crate) async fn preview(&self, decision: &Decision) -> (String, bool) {
        const UNAVAILABLE: &str =
            "The preview could not be shown, so this request can only be declined.";
        let Some(spec) = self.commands.get(&decision.command) else {
            return (UNAVAILABLE.to_owned(), false);
        };
        let person = format!("{}/{}", decision.for_.namespace, decision.for_.subject);
        let mut context = CommandContext::new();
        // The person alone, as the host vouches for them after the login: no token narrows them,
        // so they read what their own `readers` (and equivalents) admit.
        Principal::new(
            afd::Actor::new(afd::ActorKind::Human).with_id(&person),
            crate::principal::Transport::Library,
            crate::principal::Authentication::Embedder,
        )
        .with_policy_version(self.workspace.config().policy_version.clone())
        .apply(&mut context);
        context
            .extra
            .insert(crate::principal::CLAIM_GROUPS_KEY.to_owned(), json!([]));
        context.trace_id = Some(crate::host::new_trace_id());
        let input = Value::Object(decision.properties.clone());
        let result = self
            .registry
            .execute(&spec.preview, input, Some(context))
            .await;
        let text = result
            .data
            .as_ref()
            .filter(|_| result.success)
            .and_then(Value::as_object)
            .filter(|data| data.len() == 1)
            .and_then(|data| data.get("preview"))
            .and_then(Value::as_str);
        match text {
            Some(text) => (render(text), true),
            None => (UNAVAILABLE.to_owned(), false),
        }
    }

    /// Seal the relay's `requestState` for decision `id` and `call` (7.3): XChaCha20-Poly1305
    /// under a key derived from `relay.key`, a random nonce, the decision id as plaintext, and the
    /// command, the input digest and the principal binding as associated data.
    pub(crate) fn seal_state(&self, id: &str, call: &afd::server::RelayCall) -> Option<String> {
        use base64::Engine;
        use chacha20poly1305::aead::{Aead, Payload};
        use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
        let binding = call.principal_binding().ok()?;
        let aad = relay_aad(&call.command, &call.input_digest, &binding);
        let cipher = XChaCha20Poly1305::new_from_slice(&crate::positions::hmac_sha256(
            &self.relay_key,
            b"umbel/relay/1/cipher",
        ))
        .ok()?;
        let mut nonce = [0u8; 24];
        getrandom::fill(&mut nonce).ok()?;
        let sealed = cipher
            .encrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: id.as_bytes(),
                    aad: &aad,
                },
            )
            .ok()?;
        let mut bytes = nonce.to_vec();
        bytes.extend_from_slice(&sealed);
        Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
    }

    /// The decision id a relay `state` names for `call`, or `None` when it does not open for this
    /// command, input digest and principal.
    pub(crate) fn open_state(&self, state: &str, call: &afd::server::RelayCall) -> Option<String> {
        use base64::Engine;
        use chacha20poly1305::aead::{Aead, Payload};
        use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
        if state.len() > 256 {
            return None;
        }
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(state)
            .ok()?;
        if bytes.len() < 24 + 16 {
            return None;
        }
        let binding = call.principal_binding().ok()?;
        let aad = relay_aad(&call.command, &call.input_digest, &binding);
        let cipher = XChaCha20Poly1305::new_from_slice(&crate::positions::hmac_sha256(
            &self.relay_key,
            b"umbel/relay/1/cipher",
        ))
        .ok()?;
        let nonce = <&XNonce>::try_from(&bytes[..24]).ok()?;
        let opened = cipher
            .decrypt(
                nonce,
                Payload {
                    msg: &bytes[24..],
                    aad: &aad,
                },
            )
            .ok()?;
        let id = String::from_utf8(opened).ok()?;
        is_id(&id).then_some(id)
    }

    /// The MAC under `person.key` of `parts` for `label`, unpadded base64url.
    pub(crate) fn mac(&self, label: &str, parts: &[&str]) -> String {
        use base64::Engine;
        let mut message = label.as_bytes().to_vec();
        for part in parts {
            message.push(0);
            message.extend_from_slice(&(part.len() as u64).to_be_bytes());
            message.extend_from_slice(part.as_bytes());
        }
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(crate::positions::hmac_sha256(&self.person_key, &message))
    }
}

/// The relay state's associated data: a version label, the command, the input digest and the
/// principal binding, each length-prefixed.
fn relay_aad(command: &str, digest: &str, binding: &str) -> Vec<u8> {
    let mut aad = b"umbel.relay.v1".to_vec();
    for part in [command, digest, binding] {
        aad.extend_from_slice(&(part.len() as u64).to_be_bytes());
        aad.extend_from_slice(part.as_bytes());
    }
    aad
}

/// The preview as the page shows it (D97): control characters (but line ends and tabs), the line
/// and paragraph separators and the bidirectional controls removed, at most 6000 characters, then
/// how many lines were not shown.
pub(crate) fn render(text: &str) -> String {
    const MAX: usize = 6000;
    let clean: String = text
        .chars()
        .filter(|c| {
            (*c == '\n' || *c == '\t' || !c.is_control())
                && !matches!(
                    c,
                    '\u{2028}'
                        | '\u{2029}'
                        | '\u{061c}'
                        | '\u{200e}'
                        | '\u{200f}'
                        | '\u{202a}'..='\u{202e}'
                        | '\u{2066}'..='\u{2069}'
                )
        })
        .collect();
    let lines: Vec<&str> = clean.lines().collect();
    let mut out = String::new();
    let mut used = 0usize;
    let mut shown = 0usize;
    for line in &lines {
        let length = line.chars().count();
        if used + length > MAX {
            if shown == 0 {
                out.extend(line.chars().take(MAX));
                out.push('\n');
                shown = 1;
            }
            break;
        }
        out.push_str(line);
        out.push('\n');
        used += length;
        shown += 1;
    }
    match lines.len() - shown {
        0 => {}
        1 => out.push_str("(1 line not shown)\n"),
        hidden => out.push_str(&format!("({hidden} lines not shown)\n")),
    }
    out
}

/// The plugin gate's ledger over the shared stores (`super::DecisionLedger`).
pub(crate) struct Ledger {
    store: Arc<dyn PersonStore>,
    nonces: Arc<dyn NonceStore>,
    clock: Arc<dyn Clock>,
}

impl Ledger {
    /// The ledger of `workspace`, reading decisions' expiry on `clock` (the person page's).
    pub(crate) fn new(workspace: &Workspace, clock: Arc<dyn Clock>) -> Self {
        let config = workspace.config();
        Self {
            clock,
            store: Arc::new(crate::shared::person::SqlitePerson::new(
                &workspace.layout().person_store(),
                config.store.lock_timeout_ms,
            )),
            nonces: Arc::new(crate::shared::nonces::SqliteNonces::new(
                &workspace.layout().nonces_store(),
                config.store.lock_timeout_ms,
            )),
        }
    }
}

impl super::DecisionLedger for Ledger {
    fn admit(
        &self,
        mark: &PersonMark,
        who: &DecisionFor,
        command: &str,
        input_digest: &str,
    ) -> Result<(), CommandError> {
        let refuse = || super::not_decided(command);
        let decision = self
            .store
            .decision(&mark.id)
            .map_err(|error| store_failure(&error))?
            .ok_or_else(refuse)?;
        let covers = decision.status == crate::shared::person::Status::Approved
            && decision.live(self.clock.now())
            && decision.preview_hash.is_some()
            && decision.for_ == *who
            && decision.command == command
            && decision.input_digest == input_digest;
        if !covers {
            return Err(refuse());
        }
        let now = crate::shared::nonces::now_ms();
        let spent = self
            .nonces
            .consume(
                &format!("person-run:{}", mark.id),
                now.saturating_add(SPENT_KEEP_MS),
                now,
            )
            .map_err(|error| store_failure(&error))?;
        if spent { Ok(()) } else { Err(refuse()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_26_base32_characters_and_secrets_43_base64url() {
        let id = random_id().unwrap_or_default();
        assert!(is_id(&id), "{id}");
        assert!(!is_id("ABCDEFGHIJKLMNOPQRSTUVWXYZ"));
        assert!(!is_id("return"));
        assert_eq!(random_secret().unwrap_or_default().len(), 43);
    }

    #[test]
    fn the_ledger_admits_an_approved_decision_for_its_call_once() {
        use crate::person::{ActorRef, DecisionFor, DecisionLedger};
        use crate::shared::person::{NewDecision, NewLogin, PersonStore, SqlitePerson, Verified};
        let dir = tempfile::tempdir().unwrap_or_else(|_| panic!("a temporary directory"));
        let store = Arc::new(SqlitePerson::new(&dir.path().join("person.sqlite3"), 1_000));
        let nonces = Arc::new(crate::shared::nonces::SqliteNonces::new(
            &dir.path().join("nonces.sqlite3"),
            1_000,
        ));
        let who = DecisionFor {
            actor: ActorRef {
                kind: afd::ActorKind::Agent,
                id: Some("corp/client".into()),
                on_behalf_of: Some("corp/ada".into()),
            },
            client_id: Some("client".into()),
            issuer: Some("as".into()),
            namespace: "corp".into(),
            subject: "ada".into(),
        };
        let now = crate::shared::nonces::now_ms();
        let id = random_id().unwrap_or_default();
        let digest = "d".repeat(43);
        fn ok<T>(result: Result<T, SharedError>) -> T {
            result.unwrap_or_else(|_| panic!("the store"))
        }
        ok(store.create(
            &NewDecision {
                id: id.clone(),
                for_: who.clone(),
                command: "gate-approve".into(),
                input_digest: digest.clone(),
                properties: Map::new(),
                spaces: Vec::new(),
                chain: Vec::new(),
                trace_id: None,
                created_ms: now,
                expires_ms: now + 600_000,
            },
            now,
        ));
        let ledger = Ledger {
            store: store.clone(),
            nonces,
            clock: Arc::new(afd::SYSTEM_CLOCK),
        };
        let mark = |id: &str| PersonMark {
            id: id.to_owned(),
            command: "gate-approve".into(),
            input_digest: digest.clone(),
            surface: Surface::Mcp,
            level: "verified".into(),
            method: "person-page".into(),
            namespace: "corp".into(),
            auth_time: String::new(),
            acr: String::new(),
            at: String::new(),
        };
        // Pending: not admitted.
        assert!(
            ledger
                .admit(&mark(&id), &who, "gate-approve", &digest)
                .is_err()
        );
        ok(store.start_login(
            &NewLogin {
                id: "l".repeat(26),
                decision: id.clone(),
                verifier: "v".into(),
                nonce: "n".into(),
                browser_hash: "ab".repeat(32),
                created_ms: now,
                expires_ms: now + 600_000,
            },
            now,
        ));
        ok(store.take_login(&"l".repeat(26), &"ab".repeat(32), now));
        ok(store.finish_login(
            &"l".repeat(26),
            Some(&Verified {
                auth_time_ms: now,
                acr: "phr".into(),
                preview_hash: format!("sha256:{}", "0".repeat(64)),
                preview_ok: true,
            }),
        ));
        ok(store.decide(&id, &"l".repeat(26), &"ab".repeat(32), true, now));
        // Another person, command or input: not admitted, and nothing spent.
        let mut bo = who.clone();
        bo.subject = "bo".into();
        assert!(
            ledger
                .admit(&mark(&id), &bo, "gate-approve", &digest)
                .is_err()
        );
        assert!(
            ledger
                .admit(&mark(&id), &who, "gate-reject", &digest)
                .is_err()
        );
        assert!(
            ledger
                .admit(&mark(&id), &who, "gate-approve", &"e".repeat(43))
                .is_err()
        );
        // The right call: once.
        assert!(
            ledger
                .admit(&mark(&id), &who, "gate-approve", &digest)
                .is_ok()
        );
        assert!(
            ledger
                .admit(&mark(&id), &who, "gate-approve", &digest)
                .is_err()
        );
    }

    #[test]
    fn a_decision_keeps_ids_only() {
        assert!(keepable(&json!("p-1")));
        assert!(keepable(&json!(3)));
        assert!(keepable(&json!(["a", "b"])));
        assert!(!keepable(&json!({ "text": "x" })));
        assert!(!keepable(&json!("x".repeat(513))));
        assert!(!keepable(&json!("line\nbreak")));
        assert!(!keepable(&json!([1, 2])));
    }

    #[test]
    fn the_rendered_preview_drops_controls_and_counts_what_it_cut() {
        assert_eq!(render("a\u{1b}[31mb\u{202e}c\nd\u{2028}e"), "a[31mbc\nde\n");
        let long: String = (0..200).map(|i| format!("{i:049}\n")).collect();
        assert!(render(&long).ends_with("(78 lines not shown)\n"));
    }
}
