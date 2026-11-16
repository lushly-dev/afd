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
//!
//! **The local page** (the Ideas host-review specification, section 6). In mode `none` with
//! `[person.local]` enabled, the service is built with no identity provider and no login: its
//! decisions are the local person's ([`super::for_of_local`]), begun by the plugin gate's local
//! arm ([`super::LocalGate`], implemented here) for a stdio caller, decided on the loopback page
//! that `umbel person page-serve` serves, and spent by the same call sent again. They share
//! `state/shared/person.sqlite3` with every process of the workspace, so the stdio server that
//! began a decision and the process serving the page need not be one.

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
/// The longest text a `journal.show` property may hold (a rejection's reason, step 6).
const MAX_SHOWN_CHARS: usize = 2000;
/// The most pages a paged preview may answer (the Ideas host-review specification, section 2).
pub(crate) const MAX_PREVIEW_PAGES: u32 = 200;
/// The most items one page of a preview may answer.
pub(crate) const MAX_PREVIEW_ITEMS: usize = 100;
/// The most characters a page shows, its heading and every item's text together (D97's cap):
/// a page that needs more cannot be shown, and is never cut.
pub(crate) const MAX_PAGE_CHARS: usize = 6000;
/// What a page shows when the preview cannot be shown.
const UNAVAILABLE: &str = "The preview could not be shown, so this request can only be declined.";

/// One page of a decision's preview as the page shows it (the Ideas host-review specification,
/// section 2): its heading and items, sanitised, never cut. Nothing of it is stored but its hash
/// and its items' ids.
#[derive(Clone, Debug)]
pub(crate) struct PreviewPage {
    pub(crate) page: u32,
    pub(crate) pages: u32,
    pub(crate) heading: String,
    /// Each item's id and text.
    pub(crate) items: Vec<(String, String)>,
    /// Whether the page could be shown: only a shown page counts toward Approve.
    pub(crate) ok: bool,
    /// `sha256:<hex>` of what it shows.
    pub(crate) hash: String,
}

impl PreviewPage {
    pub(crate) fn unavailable(page: u32) -> Self {
        Self::shown(page, page, UNAVAILABLE.to_owned(), Vec::new(), false)
    }

    fn shown(
        page: u32,
        pages: u32,
        heading: String,
        items: Vec<(String, String)>,
        ok: bool,
    ) -> Self {
        let hash = format!(
            "sha256:{}",
            sha256_hex(
                &json!({ "page": page, "pages": pages, "heading": heading, "items": items })
                    .to_string()
            )
        );
        Self {
            page,
            pages,
            heading,
            items,
            ok,
            hash,
        }
    }
}

/// Whether `id` is an item id: 1 to 64 letters, digits, `.`, `_` and `-`.
fn is_item_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

/// Page `asked` of a preview's answer `data` (section 2), sanitised: `None` when it is not
/// exactly `{ preview }` or a paged answer for that page by the section's rules, or when it would
/// not fit on the page uncut.
pub(crate) fn preview_page_of(data: &Value, asked: u32) -> Option<PreviewPage> {
    let data = data.as_object()?;
    if data
        .keys()
        .any(|key| !matches!(key.as_str(), "preview" | "page" | "pages" | "items"))
    {
        return None;
    }
    let heading = clean(data.get("preview")?.as_str()?);
    let number = |name: &str| -> Option<Option<u32>> {
        match data.get(name) {
            None => Some(None),
            Some(value) => u32::try_from(value.as_u64()?).ok().map(Some),
        }
    };
    let (page, pages) = match (number("page")?, number("pages")?) {
        (Some(page), Some(pages)) => (page, pages),
        (None, None) => (1, 1),
        _ => return None,
    };
    if page < 1 || page > pages || pages > MAX_PREVIEW_PAGES || page != asked {
        return None;
    }
    let mut items = Vec::new();
    if let Some(listed) = data.get("items") {
        let listed = listed.as_array()?;
        if listed.len() > MAX_PREVIEW_ITEMS {
            return None;
        }
        for item in listed {
            let item = item.as_object()?;
            if item.len() != 2 {
                return None;
            }
            let id = item.get("id")?.as_str()?;
            let text = item.get("text")?.as_str()?;
            if !is_item_id(id) || items.iter().any(|(seen, _): &(String, String)| seen == id) {
                return None;
            }
            items.push((id.to_owned(), clean(text)));
        }
    }
    // The page is cut nowhere: what would not fit cannot be shown.
    let shown = |text: &str| text.chars().filter(|c| *c != '\n').count();
    let total = shown(&heading) + items.iter().map(|(_, text)| shown(text)).sum::<usize>();
    (total <= MAX_PAGE_CHARS).then(|| PreviewPage::shown(page, pages, heading, items, true))
}

/// A command whose `person` names `verified` on some surface: what its decisions need.
#[derive(Debug, Clone)]
pub(crate) struct PersonCommand {
    /// Its `confirm_preview`.
    pub(crate) preview: String,
    /// The preview's declared input properties.
    pub(crate) properties: Vec<String>,
    /// Those of them the command's `journal.show` names: text the person reads as written (a
    /// rejection's reason), held in the decision for its life, never journaled nor named in the
    /// relay's message (step 6). The others are ids.
    pub(crate) shown: Vec<String>,
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
    /// (an origin) in mode `gateway`, `http://<person.local.bind>` on the local page.
    page_url: String,
    /// On the local page, `person.local.public_origin` when set: the origin a proxy on this
    /// machine serves the page at, which the links handed out name (A48). `None` otherwise.
    public_origin: Option<String>,
    /// Whether this is the local page's service: no provider, no login, decisions for the local
    /// person only.
    local: bool,
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

/// Whether `value` is text a decision may hold for the page to show (`journal.show`, step 6): a
/// string of at most 2000 characters with no control character but line ends and tabs.
fn showable(value: &Value) -> bool {
    value.as_str().is_some_and(|text| {
        text.chars().count() <= MAX_SHOWN_CHARS
            && !text
                .chars()
                .any(|c| c.is_control() && c != '\n' && c != '\t')
    })
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
        let local = crate::plugins::loader::local_page_served(config);
        if !crate::plugins::loader::person_page_served(config) && !local {
            return Ok(None);
        }
        // Where the page is served: beside the MCP path in mode `oauth`; on its own origin in mode
        // `gateway` (step 5b), so every link and the redirect URI name a host the gateway never
        // serves; on the loopback bind of `[person.local]`, over plain HTTP.
        let page_url = match (config.auth.mode, &config.http.person) {
            _ if local => format!("http://{}", config.person.local.bind),
            (crate::workspace::AuthMode::Gateway, Some(person)) => person.public_url.clone(),
            (crate::workspace::AuthMode::Oauth, _) => match config.http.public_url.clone() {
                Some(url) => url,
                None => return Ok(None),
            },
            _ => return Ok(None),
        };
        let platform = Fetcher::new(environment);
        let mut providers = BTreeMap::new();
        // The local page has no login, so no provider.
        for namespace in config.auth.namespaces.iter().filter(|_| !local) {
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
            public_origin: config.person.local.public_origin.clone().filter(|_| local),
            local,
        })))
    }

    /// Whether this is the local page's service (the Ideas host-review specification, section 6).
    pub(crate) fn is_local(&self) -> bool {
        self.local
    }

    /// The workspace's configuration.
    pub(crate) fn workspace_config(&self) -> &crate::workspace::Config {
        self.workspace.config()
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
    /// `oauth`, `<http.person.public_url>/d/<id>` in mode `gateway`, and on the local page under
    /// [`Self::links`].
    pub(crate) fn url(&self, id: &str) -> String {
        format!("{}/d/{id}", self.links())
    }

    /// The base of the links the host hands out: [`Self::page_url`], or on the local page its
    /// `person.local.public_origin` when set (A48).
    pub(crate) fn links(&self) -> &str {
        self.public_origin.as_deref().unwrap_or(&self.page_url)
    }

    /// The local page's `person.local.public_origin`, when set.
    pub(crate) fn public_origin(&self) -> Option<&str> {
        self.public_origin.as_deref()
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
        if self.local {
            // The local page decides for the local person over MCP alone, with no login.
            if request.surface != Surface::Mcp
                || request.who.namespace != super::LOCAL_NAMESPACE
                || request.who.issuer.is_some()
                || request.who.client_id.is_some()
            {
                return Err(unavailable(
                    command,
                    "the local person page decides only for the workspace's stdio caller",
                ));
            }
        } else {
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
                    let shown = spec.shown.contains(name);
                    if !(if shown {
                        showable(value)
                    } else {
                        keepable(value)
                    }) {
                        let (what, how) = if shown {
                            (
                                "text the page may show",
                                "Pass it as text of at most 2000 characters, with no control character but line ends and tabs.",
                            )
                        } else {
                            (
                                "an id the page may keep",
                                "Pass ids only (strings of at most 512 characters, numbers, booleans or lists of at most 100 such strings) in the inputs its preview reads.",
                            )
                        };
                        return Err(CommandError::new(
                            error_codes::VALIDATION_ERROR,
                            format!(
                                "'{command}' cannot be decided on the person page: its input `{name}` is not {what}"
                            ),
                        )
                        .with_suggestion(how)
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
        // The command's own plugin, before anyone is asked (step 6): its preview, run now as the
        // caller with the decision's properties and the host's check mark, refuses a call the
        // plugin would refuse (an area without `approve_over_mcp`, a proposal the caller may not
        // decide), with the plugin's own answer, and nothing is written. It counts as a begin
        // under `person_pages_per_hour`, so repeated checks are limited as begins are.
        self.check(command, spec, &properties, &request).await?;
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
            expires_ms: now.saturating_add(self.ttl_ms()),
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
            pages_total: None,
            pages: Vec::new(),
            excluded: Vec::new(),
        })
    }

    /// `person.decision_ttl_s`, in milliseconds: a decision's lifetime, from its beginning and
    /// from each page rendered (the Ideas host-review specification, section 4).
    pub(crate) fn ttl_ms(&self) -> i64 {
        i64::try_from(
            self.workspace
                .config()
                .person
                .decision_ttl_s
                .saturating_mul(1000),
        )
        .unwrap_or(i64::MAX)
    }

    /// The namespaces whose person login the page serves, in order.
    pub(crate) fn namespaces(&self) -> Vec<String> {
        self.providers.keys().cloned().collect()
    }

    /// Run `spec`'s preview as the caller of `request`, under the call's own trace id, with
    /// `properties` (the decision's) and [`super::PERSON_CHECK_KEY`] naming `command` and its
    /// surface, before a decision for it is begun (step 6). Over MCP it is the host's own
    /// in-process call, as the page's rendering is (no interface, so a preview kept off MCP
    /// still runs); at the CLI it keeps the CLI's interface, so the operator stays the operator.
    /// It has the caller's principal, credentials and narrowing, and nothing the server set for
    /// the request (its hidden-command filter). Its text is never shown or kept: only whether it
    /// failed matters, and a failure is the begin's answer, as the plugin gave it.
    async fn check(
        &self,
        command: &str,
        spec: &PersonCommand,
        properties: &Map<String, Value>,
        request: &BeginRequest<'_>,
    ) -> Result<(), CommandError> {
        // A context of its own, as the host builds for its own calls: the caller's actor,
        // credentials (so its scopes and narrowing hold) and host-owned fields, a fresh trace id,
        // no interface, and nothing the server set for the request (its hidden-command filter
        // would hide a preview kept off MCP).
        let mut context = CommandContext::new();
        context.actor = request.context.actor.clone();
        context.credentials = request.context.credentials.clone();
        context.extra = request.context.extra.clone();
        context.clock = request.context.clock.clone();
        context.trace_id = request
            .context
            .trace_id
            .clone()
            .or_else(|| Some(crate::host::new_trace_id()));
        let surface = match request.surface {
            Surface::Mcp => "mcp",
            Surface::Cli => {
                context.interface = Some(afd::CommandInterface::Cli);
                "cli"
            }
        };
        context.extra.insert(
            super::PERSON_CHECK_KEY.to_owned(),
            json!({ "command": command, "preview": spec.preview, "surface": surface }),
        );
        let result = self
            .registry
            .execute(
                &spec.preview,
                Value::Object(properties.clone()),
                Some(context),
            )
            .await;
        if result.success {
            return Ok(());
        }
        Err(result.error.unwrap_or_else(|| super::not_decided(command)))
    }

    /// The ids the relay's message may name for `decision` (7.3, 7.4): its kept properties that
    /// are ids, never one its command's `journal.show` names.
    pub(crate) fn message_properties(&self, decision: &Decision) -> Map<String, Value> {
        let shown = self
            .commands
            .get(&decision.command)
            .map(|spec| spec.shown.clone())
            .unwrap_or_default();
        decision
            .properties
            .iter()
            .filter(|(name, _)| !shown.contains(name))
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect()
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
            excluded: decision.excluded.clone(),
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
        let input = json!({ "id": decision.id, "level": decision.level(), "decision": verdict });
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

    /// Page `page` of the preview of `decision`, rendered now under the logged-in person's reader
    /// filter (7.2, step 4; D97's sanitising), with [`super::PREVIEW_PAGE_KEY`] asking for that
    /// page (the Ideas host-review specification, section 2). Nothing of it is stored here.
    pub(crate) async fn preview_page(&self, decision: &Decision, page: u32) -> PreviewPage {
        let Some(spec) = self.commands.get(&decision.command) else {
            return PreviewPage::unavailable(page);
        };
        let mut context = CommandContext::new();
        // The person alone, as the host vouches for them after the login: no token narrows them,
        // so they read what their own `readers` (and equivalents) admit. On the local page, which
        // has no login, the stdio caller the decision is for, as it would read.
        let actor = if decision.is_local() {
            let mut actor = afd::Actor::new(decision.for_.actor.kind);
            if let Some(id) = &decision.for_.actor.id {
                actor = actor.with_id(id);
            }
            if let Some(person) = &decision.for_.actor.on_behalf_of {
                actor = actor.with_on_behalf_of(person);
            }
            actor
        } else {
            let person = format!("{}/{}", decision.for_.namespace, decision.for_.subject);
            afd::Actor::new(afd::ActorKind::Human).with_id(&person)
        };
        Principal::new(
            actor,
            crate::principal::Transport::Library,
            crate::principal::Authentication::Embedder,
        )
        .with_policy_version(self.workspace.config().policy_version.clone())
        .apply(&mut context);
        context
            .extra
            .insert(crate::principal::CLAIM_GROUPS_KEY.to_owned(), json!([]));
        context.extra.insert(
            super::PREVIEW_PAGE_KEY.to_owned(),
            json!({ "preview": spec.preview, "page": page }),
        );
        context.trace_id = Some(crate::host::new_trace_id());
        let input = Value::Object(decision.properties.clone());
        let result = self
            .registry
            .execute(&spec.preview, input, Some(context))
            .await;
        result
            .data
            .as_ref()
            .filter(|_| result.success)
            .and_then(|data| preview_page_of(data, page))
            .unwrap_or_else(|| PreviewPage::unavailable(page))
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

impl PersonService {
    /// The plugin gate's local arm (the Ideas host-review specification, section 6.2); see
    /// [`super::LocalGate::decide`]. A declined decision is answered once, and an expired one
    /// once, each spent as it is answered, so the call sent again begins a new decision.
    async fn decide_local(
        &self,
        command: &str,
        input: &Value,
        context: &CommandContext,
    ) -> Result<PersonMark, CommandError> {
        if !self.local {
            return Err(super::not_decided(command));
        }
        let who = super::for_of_local(self.workspace.config(), context)
            .map_err(|why| unavailable(command, why))?;
        let digest = afd::input_digest(input).map_err(|_| super::not_decided(command))?;
        let found = {
            let store = Arc::clone(&self.store);
            let (command, digest) = (command.to_owned(), digest.clone());
            tokio::task::spawn_blocking(move || store.for_call(&command, &digest))
                .await
                .map_err(|_| crate::shared::read_limit::store_failed())?
                .map_err(|error| store_failure(&error))?
        };
        let now = self.clock.now();
        use crate::shared::person::Status;
        for decision in found
            .into_iter()
            .filter(|decision| decision.is_local() && decision.for_ == who)
        {
            let live = decision.live(now);
            match decision.status {
                Status::Pending if live => {
                    return Err(super::local_required(
                        command,
                        &decision.id,
                        self.links(),
                        self.public_origin(),
                    ));
                }
                Status::Approved if live => {
                    if !self
                        .spend(&decision.id)
                        .await
                        .map_err(|error| store_failure(&error))?
                    {
                        continue;
                    }
                    let run = self
                        .consume(format!("person-run:{}", decision.id))
                        .await
                        .map_err(|error| store_failure(&error))?;
                    if !run {
                        return Err(super::not_decided(command));
                    }
                    let at = super::iso(
                        decision
                            .decided_ms
                            .ok_or_else(|| super::not_decided(command))?,
                    );
                    return Ok(PersonMark {
                        id: decision.id,
                        command: command.to_owned(),
                        input_digest: digest,
                        surface: Surface::Mcp,
                        level: super::LOCAL_LEVEL.to_owned(),
                        method: super::LOCAL_METHOD.to_owned(),
                        namespace: super::LOCAL_NAMESPACE.to_owned(),
                        auth_time: String::new(),
                        acr: String::new(),
                        at,
                        excluded: decision.excluded,
                    });
                }
                Status::Declined => {
                    if self
                        .spend(&decision.id)
                        .await
                        .map_err(|error| store_failure(&error))?
                    {
                        return Err(super::local_declined(command));
                    }
                }
                Status::Pending => {
                    if self
                        .spend(&decision.id)
                        .await
                        .map_err(|error| store_failure(&error))?
                    {
                        return Err(super::local_expired(command));
                    }
                }
                Status::Approved => {}
            }
        }
        let begun = self
            .begin(BeginRequest {
                who,
                command,
                input,
                input_digest: &digest,
                context,
                surface: Surface::Mcp,
            })
            .await?;
        Err(super::local_required(
            command,
            &begun.id,
            self.links(),
            self.public_origin(),
        ))
    }
}

impl super::LocalGate for PersonService {
    fn decide<'a>(
        &'a self,
        command: &'a str,
        input: &'a Value,
        context: &'a CommandContext,
    ) -> afd::BoxFuture<'a, Result<PersonMark, CommandError>> {
        Box::pin(self.decide_local(command, input, context))
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

/// `text` with control characters (but line ends and tabs), the line and paragraph separators
/// and the bidirectional controls removed (D97).
pub(crate) fn clean(text: &str) -> String {
    text.chars()
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
        .collect()
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
        // A decision of the local page is never admitted as `verified` (the Ideas host-review
        // specification, section 6.5): only the local arm spends it, as `local`.
        let covers = decision.status == crate::shared::person::Status::Approved
            && !decision.is_local()
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
            excluded: Vec::new(),
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
        ok(store.render(
            &crate::shared::person::Render {
                decision: id.clone(),
                login: "l".repeat(26),
                page: 1,
                pages: 1,
                hash: format!("sha256:{}", "0".repeat(64)),
                items: Vec::new(),
                ttl_ms: 600_000,
            },
            now,
        ));
        ok(store.decide(
            &id,
            &"l".repeat(26),
            &"ab".repeat(32),
            &crate::shared::person::Choice {
                page: 1,
                action: crate::shared::person::Action::Approve,
                checked: Vec::new(),
                hash: format!("sha256:{}", "0".repeat(64)),
                max_age_ms: i64::MAX,
            },
            now,
        ));
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
    fn a_shown_input_is_text_of_at_most_2000_characters_with_line_ends() {
        assert!(showable(&json!("It is wrong.\nSee the runbook.\tThanks.")));
        assert!(showable(&json!("x".repeat(2000))));
        assert!(!showable(&json!("x".repeat(2001))));
        assert!(!showable(&json!("a\u{1b}[31mred")));
        assert!(!showable(&json!(["a"])));
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
    fn the_shown_preview_drops_controls() {
        assert_eq!(clean("a\u{1b}[31mb\u{202e}c\nd\u{2028}e"), "a[31mbc\nde");
    }

    #[test]
    fn a_preview_answers_one_page_by_section_2s_rules() {
        // Exactly `{ preview }`: one page of one, with no items.
        let one = preview_page_of(&json!({ "preview": "Mulch the beds" }), 1).unwrap();
        assert_eq!((one.page, one.pages, one.items.len()), (1, 1, 0));
        assert!(one.ok);
        assert!(preview_page_of(&json!({ "preview": "Mulch the beds" }), 2).is_none());
        let paged = json!({ "preview": "Review · page 2 of 3", "page": 2, "pages": 3, "items": [
            { "id": "prp-1", "text": "AFFIRM · Mulch beds before the first frost." },
            { "id": "prp-2", "text": "RETIRE · Water at noon." },
        ] });
        let two = preview_page_of(&paged, 2).unwrap();
        assert_eq!(two.items[1].0, "prp-2");
        assert_eq!(two.hash.len(), "sha256:".len() + 64);
        // Another page than asked, or any rule broken: not shown.
        assert!(preview_page_of(&paged, 1).is_none());
        for bad in [
            json!({ "preview": "x", "page": 1 }),
            json!({ "preview": "x", "page": 0, "pages": 1 }),
            json!({ "preview": "x", "page": 2, "pages": 1 }),
            json!({ "preview": "x", "page": 1, "pages": 201 }),
            json!({ "preview": "x", "extra": 1 }),
            json!({ "preview": 3 }),
            json!({ "preview": "x", "items": [{ "id": "a b", "text": "t" }] }),
            json!({ "preview": "x", "items": [{ "id": "", "text": "t" }] }),
            json!({ "preview": "x", "items": [{ "id": "a", "text": "t", "more": 1 }] }),
            json!({ "preview": "x", "items": [{ "id": "a", "text": "t" }, { "id": "a", "text": "u" }] }),
            json!({ "preview": "x", "items": [{ "id": "x".repeat(65), "text": "t" }] }),
            json!({ "preview": "x", "items": (0..101).map(|i| json!({ "id": format!("i{i}"), "text": "t" })).collect::<Vec<_>>() }),
        ] {
            assert!(preview_page_of(&bad, 1).is_none(), "{bad}");
        }
        // The page is cut nowhere: 6000 characters fit, one more does not.
        let full = json!({ "preview": "h", "items": [{ "id": "a", "text": "x".repeat(5999) }] });
        assert!(preview_page_of(&full, 1).is_some());
        let over = json!({ "preview": "hh", "items": [{ "id": "a", "text": "x".repeat(5999) }] });
        assert!(preview_page_of(&over, 1).is_none());
        assert!(preview_page_of(&json!({ "preview": "y".repeat(6001) }), 1).is_none());
    }
}
