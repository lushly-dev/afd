//! Approvals and confirmations on the CLI.
//!
//! Both need a person at a terminal. A prompt goes to stderr, so stdout keeps holding exactly one
//! JSON document, and is shown only when stdin **and** stderr are terminals. Nothing is ever
//! answered on the person's behalf: `--approve` and `--yes` are the person's own flags.

use afd::server::ConfirmationMode;
use afd::{CommandError, DirectApprovalHook, DirectApprovalRequest, error_codes};
use std::io::{BufRead, IsTerminal, Write};
use std::sync::Arc;

use super::terminal::sanitize;

/// Where prompts go and answers come from.
pub trait Console: Send + Sync + 'static {
    /// Whether a person can answer: stdin and stderr are both terminals.
    fn is_interactive(&self) -> bool;
    /// Show `text` on stderr and read one answer; `true` for `y` or `yes`.
    fn ask(&self, text: &str) -> bool;
}

/// The process's terminal.
pub(crate) struct StdConsole;

impl Console for StdConsole {
    fn is_interactive(&self) -> bool {
        std::io::stdin().is_terminal() && std::io::stderr().is_terminal()
    }

    fn ask(&self, text: &str) -> bool {
        let mut stderr = std::io::stderr();
        let _ = write!(stderr, "{text}");
        let _ = stderr.flush();
        let mut line = String::new();
        if std::io::stdin().lock().read_line(&mut line).is_err() {
            return false;
        }
        matches!(line.trim().to_ascii_lowercase().as_str(), "y" | "yes")
    }
}

/// The approval hook of `cli_client()`: `--approve` approves once without asking; at a terminal
/// the summary is shown and `Approve? [y/N]` asked; with neither, no approval is given and the
/// token-free `APPROVAL_REQUIRED` result is printed unchanged.
pub(crate) fn approval_hook(approve: bool, console: Arc<dyn Console>) -> DirectApprovalHook {
    Arc::new(move |request: DirectApprovalRequest| {
        let console = Arc::clone(&console);
        Box::pin(async move {
            if approve {
                return Ok(true);
            }
            if !console.is_interactive() {
                return Ok(false);
            }
            let text = format!(
                "{}\nExpires {}.\nApprove? [y/N] ",
                sanitize(&request.summary),
                sanitize(&request.expires_at)
            );
            tokio::task::spawn_blocking(move || console.ask(&text))
                .await
                .map_err(|error| error.to_string())
        })
    })
}

/// Decide whether a command that declares `confirm_prompt` may run from the CLI.
///
/// `mode` is `mcp.confirmations`. Under `Off` nothing is asked. `--yes` proceeds without asking,
/// except under `RequireHuman`, where only a terminal answer counts. With no terminal and no
/// usable `--yes` the answer is `CONFIRMATION_REQUIRED`; a refusal at the terminal is
/// `CONFIRMATION_DECLINED`.
pub(crate) async fn confirm(
    mode: ConfirmationMode,
    command: &str,
    prompt: &str,
    yes: bool,
    console: Arc<dyn Console>,
) -> Result<(), Box<CommandError>> {
    if mode == ConfirmationMode::Off {
        return Ok(());
    }
    if yes && mode == ConfirmationMode::Enforce {
        return Ok(());
    }
    if console.is_interactive() {
        let text = format!(
            "'{}' needs confirmation: {}\nProceed? [y/N] ",
            sanitize(command),
            sanitize(prompt)
        );
        let approved = tokio::task::spawn_blocking(move || console.ask(&text))
            .await
            .unwrap_or(false);
        return if approved {
            Ok(())
        } else {
            Err(Box::new(
                CommandError::new(
                    error_codes::CONFIRMATION_DECLINED,
                    format!("'{command}' was not confirmed"),
                )
                .with_suggestion("Run it again and answer y to proceed.")
                .with_retryable(false),
            ))
        };
    }
    let suggestion = if yes {
        "Run it at a terminal: under mcp.confirmations = \"require-human\", --yes does not count."
    } else {
        "Run it at a terminal, or pass --yes."
    };
    Err(Box::new(
        CommandError::new(
            error_codes::CONFIRMATION_REQUIRED,
            format!("'{command}' needs confirmation: {prompt}"),
        )
        .with_suggestion(suggestion)
        .with_retryable(false),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Fake {
        interactive: bool,
        answer: bool,
        asked: Mutex<Vec<String>>,
    }

    impl Fake {
        fn new(interactive: bool, answer: bool) -> Arc<Self> {
            Arc::new(Self {
                interactive,
                answer,
                asked: Mutex::new(Vec::new()),
            })
        }
        fn asked(&self) -> Vec<String> {
            self.asked.lock().unwrap().clone()
        }
    }

    impl Console for Fake {
        fn is_interactive(&self) -> bool {
            self.interactive
        }
        fn ask(&self, text: &str) -> bool {
            self.asked.lock().unwrap().push(text.to_owned());
            self.answer
        }
    }

    fn request() -> DirectApprovalRequest {
        DirectApprovalRequest {
            command: "x-y".into(),
            input: serde_json::json!({}),
            summary: "Run x-y\u{1b}[31m".into(),
            expires_at: "soon".into(),
            reason: None,
        }
    }

    #[tokio::test]
    async fn approve_flag_approves_without_asking() {
        let console = Fake::new(true, false);
        let hook = approval_hook(true, console.clone());
        assert_eq!(hook(request()).await, Ok(true));
        assert!(console.asked().is_empty());
    }

    #[tokio::test]
    async fn without_a_terminal_nothing_is_approved() {
        let console = Fake::new(false, true);
        let hook = approval_hook(false, console.clone());
        assert_eq!(hook(request()).await, Ok(false));
        assert!(console.asked().is_empty());
    }

    #[tokio::test]
    async fn at_a_terminal_the_answer_decides_and_the_summary_is_sanitized() {
        let yes = Fake::new(true, true);
        assert_eq!(approval_hook(false, yes.clone())(request()).await, Ok(true));
        let asked = yes.asked();
        assert!(asked[0].contains("Run x-y\n"), "{asked:?}");
        assert!(asked[0].ends_with("Approve? [y/N] "));
        let no = Fake::new(true, false);
        assert_eq!(approval_hook(false, no)(request()).await, Ok(false));
    }

    async fn run(mode: ConfirmationMode, yes: bool, console: Arc<Fake>) -> Result<(), String> {
        confirm(mode, "x-y", "Really?", yes, console)
            .await
            .map_err(|error| error.code)
    }

    #[tokio::test]
    async fn off_asks_nothing() {
        let console = Fake::new(true, false);
        assert_eq!(
            run(ConfirmationMode::Off, false, console.clone()).await,
            Ok(())
        );
        assert!(console.asked().is_empty());
    }

    #[tokio::test]
    async fn yes_proceeds_under_enforce_without_asking() {
        let console = Fake::new(true, false);
        assert_eq!(
            run(ConfirmationMode::Enforce, true, console.clone()).await,
            Ok(())
        );
        assert!(console.asked().is_empty());
    }

    #[tokio::test]
    async fn no_terminal_and_no_yes_is_required() {
        let console = Fake::new(false, true);
        assert_eq!(
            run(ConfirmationMode::Enforce, false, console).await,
            Err("CONFIRMATION_REQUIRED".into())
        );
    }

    #[tokio::test]
    async fn a_refusal_at_the_terminal_is_declined_and_an_acceptance_proceeds() {
        let no = Fake::new(true, false);
        assert_eq!(
            run(ConfirmationMode::Enforce, false, no.clone()).await,
            Err("CONFIRMATION_DECLINED".into())
        );
        assert!(no.asked()[0].ends_with("Proceed? [y/N] "));
        let yes = Fake::new(true, true);
        assert_eq!(run(ConfirmationMode::Enforce, false, yes).await, Ok(()));
    }

    #[tokio::test]
    async fn require_human_refuses_yes_and_asks_at_a_terminal() {
        let none = Fake::new(false, true);
        assert_eq!(
            run(ConfirmationMode::RequireHuman, true, none).await,
            Err("CONFIRMATION_REQUIRED".into())
        );
        let tty = Fake::new(true, true);
        assert_eq!(
            run(ConfirmationMode::RequireHuman, true, tty.clone()).await,
            Ok(())
        );
        assert_eq!(tty.asked().len(), 1);
    }
}
