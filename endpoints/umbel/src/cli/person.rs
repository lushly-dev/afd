//! The CLI's URL flow (phase 5 specification, sections 7.1 and 7.2): a `person.cli = "verified"`
//! command at the terminal prints its person page's link and waits for the person's decision.
//!
//! It needs a hosted workspace that serves the page (beside the MCP path in mode `oauth`, on its
//! own listener in mode `gateway`, step 5b), the operator's
//! namespaced `principal.local_id`, and that namespace's person login passing `auth.person`; else
//! `PERSON_VERIFICATION_UNAVAILABLE`, and nothing is asked. The input is validated first, as the
//! registry will, so the person decides on exactly what runs. Then the decision is begun for the
//! operator (`for` from `local_id`, `issuer` and `clientId` `null`), its link shown on stderr, and
//! the CLI polls the shared store once a second:
//!
//! - **approved** before it expired: spent once as `person:<id>`, then the call runs with
//!   `humanPresent` and the decision's mark, and without the terminal marks (the terminal never
//!   stands in for `verified`);
//! - **declined**: `CONFIRMATION_DECLINED`, nothing runs;
//! - **expired** (or gone): `PERSON_DECISION_EXPIRED`, retryable, nothing runs.

#[cfg(feature = "auth")]
use std::sync::Arc;
#[cfg(feature = "auth")]
use std::time::Duration;

#[cfg(feature = "auth")]
use afd::error_codes;
use afd::{CommandResult, failure};
use serde_json::Value;

use super::Environment;
use crate::host::Host;

/// How often the CLI reads its decision.
#[cfg(feature = "auth")]
const POLL: Duration = Duration::from_secs(1);

/// `PERSON_DECISION_EXPIRED`: the decision was not decided, or not used, in time.
#[cfg(feature = "auth")]
fn expired(command: &str) -> afd::CommandError {
    afd::CommandError::new(
        crate::person::PERSON_DECISION_EXPIRED,
        format!("'{command}' was not decided on the person page in time; nothing ran"),
    )
    .with_suggestion("Run it again and decide on the new link within ten minutes.")
    .with_retryable(true)
}

/// Run `command` with `input`, decided by a person on the person page.
pub(super) async fn run(
    host: &Host,
    command: &str,
    input: Value,
    environment: &Environment,
) -> CommandResult<Value> {
    #[cfg(not(feature = "auth"))]
    {
        let _ = (host, input, environment);
        failure(crate::person::unavailable(
            command,
            "this build serves no person page (it was built without the `auth` feature)",
        ))
    }
    #[cfg(feature = "auth")]
    {
        verified(host, command, input, environment).await
    }
}

#[cfg(feature = "auth")]
async fn verified(
    host: &Host,
    command: &str,
    input: Value,
    environment: &Environment,
) -> CommandResult<Value> {
    use crate::person::service::BeginRequest;
    use crate::person::{Surface, for_of_cli, unavailable};
    use crate::shared::person::Status;

    let Some(service) = host.person().cloned() else {
        return failure(unavailable(
            command,
            "this workspace serves no person page (it needs auth.filter_tools_by_scope and auth.mode \"oauth\" with http.public_url, or auth.mode \"gateway\" with [http.person])",
        ));
    };
    let mut context = host.cli_context();
    context.interface = Some(afd::CommandInterface::Cli);
    let who = match for_of_cli(host.workspace().config(), &context) {
        Ok(who) => who,
        Err(reason) => {
            return failure(unavailable(
                command,
                &format!(
                    "{reason}: a person at the CLI is the namespaced principal.local_id of a namespace with a person login"
                ),
            ));
        }
    };
    let registry = host.registry();
    let Some(definition) = registry.get(command) else {
        return failure(afd::CommandError::new(
            error_codes::COMMAND_NOT_FOUND,
            format!("'{command}' is not a command"),
        ));
    };
    let validated = match registry.validate(&definition, input) {
        Ok(validated) => validated,
        Err(error) => return failure(*error),
    };
    let digest = match afd::input_digest(&validated) {
        Ok(digest) => digest,
        Err(message) => {
            return failure(
                afd::CommandError::new(error_codes::VALIDATION_ERROR, message)
                    .with_retryable(false),
            );
        }
    };
    let decision = match service
        .begin(BeginRequest {
            who,
            command,
            input: &validated,
            input_digest: &digest,
            context: &context,
            surface: Surface::Cli,
        })
        .await
    {
        Ok(decision) => decision,
        Err(error) => return failure(error),
    };
    environment.console.show(&format!(
        "'{command}' is decided by a person on the person page. Open this link, sign in and decide:\n{}\nWaiting until {} ...\n",
        service.url(&decision.id),
        crate::person::iso(decision.expires_ms),
    ));
    let decided = loop {
        let read = match service.decision(&decision.id).await {
            Ok(read) => read,
            Err(error) => return failure(crate::person::service::store_failure(&error)),
        };
        let Some(read) = read else {
            return failure(expired(command));
        };
        // Decided and unexpired: a decision used after its expiry is refused like one never
        // decided.
        if !read.live(service.now()) {
            return failure(expired(command));
        }
        match read.status {
            Status::Pending => tokio::time::sleep(POLL).await,
            Status::Declined => {
                return failure(
                    afd::CommandError::new(
                        error_codes::CONFIRMATION_DECLINED,
                        format!("'{command}' was declined on the person page; nothing ran"),
                    )
                    .with_suggestion("Run it again only if the person wants it.")
                    .with_retryable(false),
                );
            }
            Status::Approved => break read,
        }
    };
    match service.spend(&decided.id).await {
        Ok(true) => {}
        Ok(false) => return failure(crate::person::not_decided(command)),
        Err(error) => return failure(crate::person::service::store_failure(&error)),
    }
    let principal = crate::principal::Principal::from_context(&context);
    let Some(fields) = service.run_fields(&decided, Surface::Cli, principal) else {
        return failure(crate::person::not_decided(command));
    };
    context.extra.extend(fields);
    let client = host
        .cli_client()
        .with_on_approval_needed(super::prompt::approval_hook(
            false,
            Arc::clone(&environment.console),
        ));
    client.call(command, validated, Some(context)).await
}
