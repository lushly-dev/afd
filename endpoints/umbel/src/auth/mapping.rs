//! From a verified token's claims to a caller (phase 5 specification, sections 4.1, 4.3 and 4.5;
//! owner decisions 1, 2 and 4).
//!
//! - **A person** is `human:<ns>/<subject>`, `<subject>` being the issuer's `subject_claim`; the
//!   client is `agent:<ns>/<client_id>`, acting for that person.
//! - **A service** is `service:<ns>/<client_id>`, acting for no one. A token is a service token
//!   when `sub` equals `client_id`, when `client_id` is in the issuer's `services.clients`, or
//!   when the token carries `services.claim` as exactly that string; otherwise it is a person's.
//! - **The chain** is `[client]`, or the RFC 8693 `act` chain when the issuer is configured
//!   `delegation = "act"`; an `act` from any other issuer is ignored and logged.
//! - **Claim groups** are the `[access.groups]` whose `claim` names this issuer and whose claim
//!   (a string, or an array of strings) holds the configured value exactly.
//!
//! Every value that becomes an id passed AFD's claim rule or the same rule here (1 to 255
//! characters, no control character). A token that cannot be mapped is refused at the bearer
//! layer with the rule code `claims`, and the reason is logged as a code, never a claim value.

use afd::{Actor, ActorKind, Credentials};
use serde_json::{Map, Value};

use super::caller::{ChainEntry, TokenBinding, VerifiedCaller, mapped_id};
use super::{MAX_DELEGATION_CHAIN, Scope};
use crate::workspace::{AccessGroup, AuthConfig, Delegation, IssuerConfig};

/// Why a verified token could not be mapped to a caller. Logged as its code; the token is
/// refused with AFD's rule code `claims`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Unmappable {
    /// The `subject_claim` of a person token is missing, not a string, empty, longer than 255
    /// characters or holds a control character.
    Subject,
    /// An `act` claim from an issuer configured for it is not a chain this host can map: not an
    /// object, an entry without a valid `sub`, an `iss` other than the token's, or deeper than 8.
    Act,
}

impl Unmappable {
    /// The code logged for the refusal.
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Subject => "subject-claim",
            Self::Act => "act-chain",
        }
    }
}

/// A claim value usable as an id: a string of 1 to 255 characters with no control character
/// (AFD's rule for `sub` and `client_id`, `spec/authorization.md` M3 rule 7).
fn claim_text(value: Option<&Value>) -> Option<&str> {
    let text = value?.as_str()?;
    (!text.is_empty()
        && text.chars().count() <= afd::server::auth::MAX_CLAIM_CHARS
        && !text.chars().any(char::is_control))
    .then_some(text)
}

/// Whether the token is a service's (4.1).
fn is_service(
    issuer: &IssuerConfig,
    claims: &Map<String, Value>,
    credentials: &Credentials,
) -> bool {
    if credentials.subject == credentials.client_id {
        return true;
    }
    let Some(services) = &issuer.services else {
        return false;
    };
    services.clients.contains(&credentials.client_id)
        || services.claim.as_ref().is_some_and(|claim| {
            claims.get(&claim.name).and_then(Value::as_str) == Some(claim.value.as_str())
        })
}

/// The RFC 8693 `act` chain, outermost first, each actor mapped as a client is.
fn act_chain(
    ns: &str,
    act: &Value,
    credentials: &Credentials,
) -> Result<Vec<ChainEntry>, Unmappable> {
    let mut chain = Vec::new();
    let mut current = Some(act);
    while let Some(actor) = current {
        let actor = actor.as_object().ok_or(Unmappable::Act)?;
        if chain.len() == MAX_DELEGATION_CHAIN {
            return Err(Unmappable::Act);
        }
        // An actor named by another issuer has no id in this namespace.
        if let Some(iss) = actor.get("iss")
            && iss.as_str() != Some(credentials.issuer.as_str())
        {
            return Err(Unmappable::Act);
        }
        let sub = claim_text(actor.get("sub")).ok_or(Unmappable::Act)?;
        chain.push(ChainEntry {
            kind: ActorKind::Agent,
            id: format!("{ns}/{}", mapped_id(ns, sub)),
        });
        current = actor.get("act");
    }
    Ok(chain)
}

/// Map a verified token of `issuer` (its `claims` and AFD's `credentials` for it) to a caller.
///
/// # Errors
/// [`Unmappable`] for a person token without a usable subject, or an `act` chain that cannot be
/// mapped from an issuer configured `delegation = "act"`.
pub(crate) fn map(
    auth: &AuthConfig,
    groups: &[AccessGroup],
    issuer: &IssuerConfig,
    claims: &Map<String, Value>,
    credentials: Credentials,
) -> Result<VerifiedCaller, Unmappable> {
    let ns = issuer.namespace.as_str();
    let client = format!("{ns}/{}", mapped_id(ns, &credentials.client_id));
    let service = is_service(issuer, claims, &credentials);
    let (actor, kind) = if service {
        (
            Actor::new(ActorKind::Service).with_id(&client),
            ActorKind::Service,
        )
    } else {
        let subject = claim_text(claims.get(&issuer.subject_claim)).ok_or(Unmappable::Subject)?;
        (
            Actor::new(ActorKind::Agent)
                .with_id(&client)
                .with_on_behalf_of(format!("{ns}/{}", mapped_id(ns, subject))),
            ActorKind::Agent,
        )
    };
    let chain = match (issuer.delegation, claims.get("act")) {
        (Delegation::Act, Some(act)) => act_chain(ns, act, &credentials)?,
        (Delegation::None, Some(_)) => {
            tracing::info!(
                target: "umbel::auth",
                issuer = issuer.alias.as_str(),
                "ignored an act claim from an issuer not configured delegation = \"act\""
            );
            vec![ChainEntry { kind, id: client }]
        }
        (_, None) => vec![ChainEntry { kind, id: client }],
    };
    let binding = match &credentials.certificate_thumbprint {
        Some(thumbprint) => TokenBinding::Mtls {
            thumbprint: thumbprint.clone(),
        },
        None => TokenBinding::Bearer,
    };
    let scopes = credentials
        .scopes
        .iter()
        .filter(|scope| Scope::parse(&auth.scope_prefix, scope).is_some())
        .cloned()
        .collect();
    let claim_groups = groups
        .iter()
        .filter(|group| {
            group.claim.as_ref().is_some_and(|claim| {
                claim.issuer == issuer.alias && claim_holds(claims.get(&claim.name), &claim.value)
            })
        })
        .map(|group| group.id.clone())
        .collect();
    Ok(VerifiedCaller {
        credentials,
        namespace: ns.to_owned(),
        issuer: issuer.alias.clone(),
        actor,
        chain,
        binding,
        scopes,
        claim_groups,
    })
}

/// Whether a group claim (a string, or an array of strings) holds `value` exactly (4.5).
fn claim_holds(claim: Option<&Value>, value: &str) -> bool {
    match claim {
        Some(Value::String(text)) => text == value,
        Some(Value::Array(items)) => items.iter().any(|item| item.as_str() == Some(value)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{ClaimMatch, ServicesConfig, TokenCheck};
    use serde_json::json;

    fn issuer(delegation: Delegation, services: Option<ServicesConfig>) -> IssuerConfig {
        IssuerConfig {
            alias: "as".into(),
            issuer: "https://as.example.com".into(),
            namespace: "corp".into(),
            subject_claim: "sub".into(),
            verify: TokenCheck::Jwt,
            algorithms: vec!["ES256".into()],
            delegation,
            services,
            introspection: None,
            access_tokens: true,
            ca_file: None,
        }
    }

    fn credentials(subject: &str, client: &str) -> Credentials {
        Credentials::new(
            "https://as.example.com",
            subject,
            client,
            "https://umbel.example.com/mcp",
            1,
            2,
        )
    }

    fn claims(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn a_person_token_maps_to_its_client_acting_for_the_person() {
        let caller = map(
            &AuthConfig::default(),
            &[],
            &issuer(Delegation::None, None),
            &claims(json!({ "sub": "U1", "client_id": "app" })),
            credentials("U1", "app"),
        )
        .unwrap();
        assert_eq!(caller.actor.kind, ActorKind::Agent);
        assert_eq!(caller.actor.id.as_deref(), Some("corp/app"));
        assert_eq!(caller.actor.on_behalf_of.as_deref(), Some("corp/U1"));
        assert_eq!(
            caller.effective_principal().as_deref(),
            Some("human:corp/U1")
        );
        assert_eq!(
            caller.chain,
            [ChainEntry {
                kind: ActorKind::Agent,
                id: "corp/app".into()
            }]
        );
    }

    #[test]
    fn services_are_recognised_three_ways_and_exactly() {
        let by_claim = Some(ServicesConfig {
            clients: vec!["build-bot".into()],
            claim: Some(ClaimMatch {
                name: "idtyp".into(),
                value: "app".into(),
            }),
        });
        let service = |claims_value: Value, subject: &str, client: &str| {
            map(
                &AuthConfig::default(),
                &[],
                &issuer(Delegation::None, by_claim.clone()),
                &claims(claims_value),
                credentials(subject, client),
            )
            .unwrap()
            .actor
            .kind
                == ActorKind::Service
        };
        assert!(service(json!({ "sub": "c" }), "c", "c"));
        assert!(service(json!({ "sub": "u" }), "u", "build-bot"));
        assert!(service(json!({ "sub": "u", "idtyp": "app" }), "u", "other"));
        assert!(!service(
            json!({ "sub": "u", "idtyp": "App" }),
            "u",
            "other"
        ));
        assert!(!service(
            json!({ "sub": "u", "idtyp": ["app"] }),
            "u",
            "other"
        ));
        assert!(!service(json!({ "sub": "u" }), "u", "other"));
    }

    #[test]
    fn a_person_token_without_its_subject_claim_is_unmappable() {
        let mut config = issuer(Delegation::None, None);
        config.subject_claim = "oid".into();
        for bad in [
            json!({}),
            json!({ "oid": 7 }),
            json!({ "oid": "" }),
            json!({ "oid": "a\u{7}" }),
        ] {
            assert_eq!(
                map(
                    &AuthConfig::default(),
                    &[],
                    &config,
                    &claims(bad),
                    credentials("U1", "app")
                ),
                Err(Unmappable::Subject)
            );
        }
        let caller = map(
            &AuthConfig::default(),
            &[],
            &config,
            &claims(json!({ "oid": "O-9" })),
            credentials("U1", "app"),
        )
        .unwrap();
        assert_eq!(caller.actor.on_behalf_of.as_deref(), Some("corp/O-9"));
    }

    #[test]
    fn claim_groups_come_only_from_their_own_issuer() {
        let group = |id: &str, issuer: &str| AccessGroup {
            id: id.into(),
            members: Vec::new(),
            claim: Some(crate::workspace::GroupClaim {
                issuer: issuer.into(),
                name: "groups".into(),
                value: "eng".into(),
            }),
        };
        let caller = map(
            &AuthConfig::default(),
            &[group("mine", "as"), group("theirs", "idp")],
            &issuer(Delegation::None, None),
            &claims(json!({ "sub": "U1", "groups": "eng" })),
            credentials("U1", "app"),
        )
        .unwrap();
        assert_eq!(caller.claim_groups, ["mine"]);
    }

    #[test]
    fn act_is_kept_only_from_an_act_issuer() {
        let token = claims(
            json!({ "sub": "U1", "act": { "sub": "agent-a", "act": { "sub": "agent-b" } } }),
        );
        let kept = map(
            &AuthConfig::default(),
            &[],
            &issuer(Delegation::Act, None),
            &token,
            credentials("U1", "app"),
        )
        .unwrap();
        let ids: Vec<&str> = kept.chain.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids, ["corp/agent-a", "corp/agent-b"]);
        let ignored = map(
            &AuthConfig::default(),
            &[],
            &issuer(Delegation::None, None),
            &token,
            credentials("U1", "app"),
        )
        .unwrap();
        assert_eq!(ignored.chain.len(), 1);
        assert_eq!(ignored.chain[0].id, "corp/app");
        let mut deep = json!({ "sub": "last" });
        for n in 0..8 {
            deep = json!({ "sub": format!("a{n}"), "act": deep });
        }
        for bad in [
            json!("agent-a"),
            json!({ "client_id": "agent-a" }),
            json!({ "sub": "agent-a", "iss": "https://other.example.com" }),
            deep,
        ] {
            let token = claims(json!({ "sub": "U1", "act": bad }));
            assert_eq!(
                map(
                    &AuthConfig::default(),
                    &[],
                    &issuer(Delegation::Act, None),
                    &token,
                    credentials("U1", "app")
                ),
                Err(Unmappable::Act)
            );
        }
    }
}
