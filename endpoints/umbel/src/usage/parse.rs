//! What a metered request asked and what it was answered, read from the bytes the host received
//! and sent: never more than `usage-event.v1` has a field for.

use serde::Deserialize;
use serde::de::IgnoredAny;
use serde_json::{Map, Value};

/// The five methods a usage event meters (section 12.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Method {
    ToolsCall,
    ToolsList,
    TasksGet,
    TasksUpdate,
    TasksCancel,
}

impl Method {
    fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "tools/call" => Self::ToolsCall,
            "tools/list" => Self::ToolsList,
            "tasks/get" => Self::TasksGet,
            "tasks/update" => Self::TasksUpdate,
            "tasks/cancel" => Self::TasksCancel,
            _ => return None,
        })
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::ToolsCall => "tools/call",
            Self::ToolsList => "tools/list",
            Self::TasksGet => "tasks/get",
            Self::TasksUpdate => "tasks/update",
            Self::TasksCancel => "tasks/cancel",
        }
    }
}

/// What a request asked, as far as a record may say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Asked {
    pub(crate) method: Method,
    /// A `tools/call`'s tool name, when it has the form of one; kept only if the call names a
    /// tool the caller can see ([`super::META_TOOLS`], or a command that ran).
    pub(crate) tool: Option<String>,
    /// The command a `tools/call` names: its tool's own, or `afd-call`'s `command`. Kept only if
    /// it ran for this request or became its task.
    pub(crate) named: Option<String>,
    /// The `space` argument the named command was given, when it has the form of a space id.
    /// Kept only for a task's creation, and only when the caller reads it.
    pub(crate) space: Option<String>,
    /// A task method's `taskId`, when it has the form of one.
    pub(crate) task: Option<String>,
}

/// Whether `text` matches `^[A-Za-z0-9_.-]{1,128}$` (a tool's name in `usage-event.v1`).
fn is_tool_name(text: &str) -> bool {
    (1..=128).contains(&text.len())
        && text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

/// Whether `text` matches `^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$` (a command's name).
pub(crate) fn is_command_name(text: &str) -> bool {
    text.len() <= 128
        && text.split('-').count() >= 2
        && text.split('-').all(|part| {
            let mut bytes = part.bytes();
            matches!(bytes.next(), Some(b'a'..=b'z'))
                && bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

/// Whether `text` matches `^[a-z][a-z0-9-]{0,62}$` (a space id).
pub(crate) fn is_space_id(text: &str) -> bool {
    let mut bytes = text.bytes();
    matches!(bytes.next(), Some(b'a'..=b'z'))
        && text.len() <= 63
        && bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// Whether `text` matches `^[a-z2-7]{26}$` (a task id).
pub(crate) fn is_task_id(text: &str) -> bool {
    text.len() == 26
        && text
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || (b'2'..=b'7').contains(&byte))
}

/// Whether `text` matches `^[A-Za-z0-9._:-]{1,128}$` (a trace id).
pub(crate) fn is_trace(text: &str) -> bool {
    (1..=128).contains(&text.len())
        && text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

/// Whether `text` matches `^[A-Z][A-Z0-9_]{0,63}$` (an error code as an outcome).
pub(crate) fn is_code(text: &str) -> bool {
    let mut bytes = text.bytes();
    matches!(bytes.next(), Some(b'A'..=b'Z'))
        && text.len() <= 64
        && bytes.all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}

/// Any JSON value in which no object names a member twice; anything else fails to deserialize.
struct Unique;

impl<'de> Deserialize<'de> for Unique {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(UniqueVisitor)
    }
}

struct UniqueVisitor;

impl<'de> serde::de::Visitor<'de> for UniqueVisitor {
    type Value = Unique;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("JSON with no member named twice in one object")
    }

    fn visit_bool<E>(self, _: bool) -> Result<Unique, E> {
        Ok(Unique)
    }

    fn visit_i64<E>(self, _: i64) -> Result<Unique, E> {
        Ok(Unique)
    }

    fn visit_u64<E>(self, _: u64) -> Result<Unique, E> {
        Ok(Unique)
    }

    fn visit_f64<E>(self, _: f64) -> Result<Unique, E> {
        Ok(Unique)
    }

    fn visit_str<E>(self, _: &str) -> Result<Unique, E> {
        Ok(Unique)
    }

    fn visit_unit<E>(self) -> Result<Unique, E> {
        Ok(Unique)
    }

    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Unique, A::Error> {
        while seq.next_element::<Unique>()?.is_some() {}
        Ok(Unique)
    }

    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Unique, A::Error> {
        let mut seen = std::collections::HashSet::new();
        while let Some(key) = map.next_key::<String>()? {
            if !seen.insert(key) {
                return Err(serde::de::Error::custom("a member is named twice"));
            }
            map.next_value::<Unique>()?;
        }
        Ok(Unique)
    }
}

/// The request a JSON-RPC body carries, when it is one of the five metered methods: a single
/// request object with an `id`. A batch, a notification, a response or another method is not
/// metered (`None`). A body in which some object names a member twice is metered by its method,
/// but names no tool, command, space or task: which of the two the server took is its parser's
/// choice, and a record never names what the server may not have run.
pub(crate) fn asked(body: &[u8]) -> Option<Asked> {
    let request: Map<String, Value> = serde_json::from_slice(body).ok()?;
    let unambiguous = serde_json::from_slice::<Unique>(body).is_ok();
    if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0") || !request.contains_key("id")
    {
        return None;
    }
    let method = Method::parse(request.get("method")?.as_str()?)?;
    let params = request.get("params").and_then(Value::as_object);
    let member = |name: &str| params.and_then(|params| params.get(name));
    let mut asked = Asked {
        method,
        tool: None,
        named: None,
        space: None,
        task: None,
    };
    if !unambiguous {
        return Some(asked);
    }
    match method {
        Method::ToolsCall => {
            let tool = member("name").and_then(Value::as_str);
            let arguments = member("arguments").and_then(Value::as_object);
            let (named, input) = match tool {
                Some("afd-call") => (
                    arguments
                        .and_then(|arguments| arguments.get("command"))
                        .and_then(Value::as_str),
                    arguments
                        .and_then(|arguments| arguments.get("input"))
                        .and_then(Value::as_object),
                ),
                Some(tool) if super::META_TOOLS.contains(&tool) => (None, None),
                other => (other, arguments),
            };
            asked.tool = tool.filter(|tool| is_tool_name(tool)).map(str::to_owned);
            asked.named = named
                .filter(|named| is_command_name(named))
                .map(str::to_owned);
            asked.space = input
                .and_then(|input| input.get("space"))
                .and_then(Value::as_str)
                .filter(|space| is_space_id(space))
                .map(str::to_owned);
        }
        Method::ToolsList => {}
        Method::TasksGet | Method::TasksUpdate | Method::TasksCancel => {
            asked.task = member("taskId")
                .and_then(Value::as_str)
                .filter(|task| is_task_id(task))
                .map(str::to_owned);
        }
    }
    Some(asked)
}

/// What a request was answered, as far as a record may say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Answered {
    /// `ok`, an error code, or a refused request's HTTP status.
    pub(crate) outcome: String,
    /// The id of the task a `tools/call` created.
    pub(crate) task: Option<String>,
}

/// The members of a JSON-RPC answer an outcome is read from; everything else is skipped unread.
#[derive(Deserialize)]
struct Envelope {
    #[serde(default)]
    result: Option<ResultView>,
    #[serde(default)]
    error: Option<ErrorView>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResultView {
    #[serde(default)]
    result_type: Option<String>,
    #[serde(default)]
    task_id: Option<String>,
    #[serde(default)]
    task: Option<TaskView>,
    #[serde(default)]
    is_error: Option<bool>,
    #[serde(default)]
    structured_content: Option<CommandView>,
    #[serde(default, rename = "content")]
    _content: Option<IgnoredAny>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskView {
    #[serde(default)]
    task_id: Option<String>,
}

#[derive(Deserialize)]
struct CommandView {
    #[serde(default)]
    success: Option<bool>,
    #[serde(default)]
    error: Option<CodeView>,
}

#[derive(Deserialize)]
struct CodeView {
    #[serde(default)]
    code: Option<Value>,
}

#[derive(Deserialize)]
struct ErrorView {
    #[serde(default)]
    code: Option<i64>,
    #[serde(default)]
    data: Option<CodeView>,
}

/// JSON-RPC 2.0's names for its own error codes; any other is `JSONRPC_<n>`.
fn jsonrpc_code(code: Option<i64>) -> String {
    match code {
        Some(-32700) => "PARSE_ERROR".to_owned(),
        Some(-32600) => "INVALID_REQUEST".to_owned(),
        Some(-32601) => "METHOD_NOT_FOUND".to_owned(),
        Some(-32602) => "INVALID_PARAMS".to_owned(),
        Some(-32603) => "INTERNAL_ERROR".to_owned(),
        Some(code) => format!("JSONRPC_{}", code.unsigned_abs()),
        None => "JSONRPC_ERROR".to_owned(),
    }
}

/// A code member when it is an error code's form.
fn code_of(view: Option<&CodeView>) -> Option<String> {
    view.and_then(|view| view.code.as_ref())
        .and_then(Value::as_str)
        .filter(|code| is_code(code))
        .map(str::to_owned)
}

/// The answer to a metered request: `status`'s text for a refused request (4xx or 5xx); else the
/// JSON-RPC answer's own (`body`, when the host held it whole): the error's code (its
/// `data.code` when it has one), a tool result's failed command's code, or `ok`. A task a
/// `tools/call` created is named by its id.
pub(crate) fn answered(status: u16, body: Option<&[u8]>) -> Answered {
    if (400..=599).contains(&status) {
        return Answered {
            outcome: status.to_string(),
            task: None,
        };
    }
    let Some(envelope) = body.and_then(|body| serde_json::from_slice::<Envelope>(body).ok()) else {
        return Answered {
            outcome: "ok".to_owned(),
            task: None,
        };
    };
    if let Some(error) = envelope.error {
        return Answered {
            outcome: code_of(error.data.as_ref()).unwrap_or_else(|| jsonrpc_code(error.code)),
            task: None,
        };
    }
    let Some(result) = envelope.result else {
        return Answered {
            outcome: "ok".to_owned(),
            task: None,
        };
    };
    let task = if result.result_type.as_deref() == Some("task") {
        result
            .task_id
            .or_else(|| result.task.and_then(|task| task.task_id))
            .filter(|task| is_task_id(task))
    } else {
        result
            .task
            .and_then(|task| task.task_id)
            .filter(|task| is_task_id(task))
    };
    let failed = result.is_error == Some(true)
        || result
            .structured_content
            .as_ref()
            .is_some_and(|content| content.success == Some(false));
    let outcome = if failed {
        code_of(
            result
                .structured_content
                .as_ref()
                .and_then(|content| content.error.as_ref()),
        )
        .unwrap_or_else(|| "TOOL_ERROR".to_owned())
    } else {
        "ok".to_owned()
    };
    Answered { outcome, task }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use serde_json::json;

    fn ask(body: Value) -> Option<Asked> {
        asked(body.to_string().as_bytes())
    }

    #[test]
    fn only_the_five_methods_as_single_requests_are_metered() {
        for method in [
            "initialize",
            "ping",
            "notifications/initialized",
            "tasks/list",
        ] {
            assert_eq!(
                ask(json!({"jsonrpc": "2.0", "id": 1, "method": method})),
                None
            );
        }
        // A notification, a batch, not JSON-RPC 2.0, not JSON.
        assert_eq!(ask(json!({"jsonrpc": "2.0", "method": "tools/list"})), None);
        assert_eq!(
            ask(json!([{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}])),
            None
        );
        assert_eq!(ask(json!({"id": 1, "method": "tools/list"})), None);
        assert_eq!(asked(b"tools/list"), None);
        let list = ask(json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})).unwrap();
        assert_eq!(list.method, Method::ToolsList);
        assert_eq!((list.tool, list.named, list.task), (None, None, None));
    }

    #[test]
    fn a_call_names_its_tool_command_and_space_only_in_their_forms() {
        let call = ask(json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
            "name": "afd-call", "arguments": {"command": "job-echo", "input": {"space": "alpha", "q": "canary"}}}}))
        .unwrap();
        assert_eq!(call.tool.as_deref(), Some("afd-call"));
        assert_eq!(call.named.as_deref(), Some("job-echo"));
        assert_eq!(call.space.as_deref(), Some("alpha"));
        let direct = ask(
            json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
            "name": "workspace-show", "arguments": {}}}),
        )
        .unwrap();
        assert_eq!(direct.named.as_deref(), Some("workspace-show"));
        let batch = ask(
            json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
            "name": "afd-batch", "arguments": {"commands": []}}}),
        )
        .unwrap();
        assert_eq!(
            (batch.tool.as_deref(), batch.named),
            (Some("afd-batch"), None)
        );
        let odd = ask(
            json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
            "name": "a tool with spaces", "arguments": {"space": "Not A Space"}}}),
        )
        .unwrap();
        assert_eq!((odd.tool, odd.named, odd.space), (None, None, None));
        let poll = ask(
            json!({"jsonrpc": "2.0", "id": 1, "method": "tasks/get", "params": {
            "taskId": "abcdefghijklmnopqrstuvwxyz"}}),
        )
        .unwrap();
        assert_eq!(poll.task.as_deref(), Some("abcdefghijklmnopqrstuvwxyz"));
        let bad = ask(
            json!({"jsonrpc": "2.0", "id": 1, "method": "tasks/cancel", "params": {
            "taskId": "not-a-task"}}),
        )
        .unwrap();
        assert_eq!(bad.task, None);
    }

    #[test]
    fn a_body_naming_a_member_twice_names_nothing() {
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"afd-call","arguments":{"command":"job-echo","command":"probe-run","input":{"space":"alpha"}}}}"#;
        let asked = asked(body).unwrap();
        assert_eq!(asked.method, Method::ToolsCall);
        assert_eq!((asked.tool, asked.named, asked.space), (None, None, None));
        let nested = br#"{"jsonrpc":"2.0","id":1,"method":"tasks/get","params":{"taskId":"abcdefghijklmnopqrstuvwxyz","_meta":{"a":[{"b":1,"b":2}]}}}"#;
        assert_eq!(super::asked(nested).unwrap().task, None);
        let fine = br#"{"jsonrpc":"2.0","id":1,"method":"tasks/get","params":{"taskId":"abcdefghijklmnopqrstuvwxyz","_meta":{"a":[{"b":1},{"b":2}]}}}"#;
        assert!(super::asked(fine).unwrap().task.is_some());
    }

    #[test]
    fn outcomes_are_the_status_the_code_or_ok() {
        let answer = |status: u16, body: Value| answered(status, Some(body.to_string().as_bytes()));
        assert_eq!(answer(401, json!({})).outcome, "401");
        assert_eq!(answered(429, None).outcome, "429");
        assert_eq!(
            answer(
                200,
                json!({"jsonrpc": "2.0", "id": 1, "result": {"tools": []}})
            )
            .outcome,
            "ok"
        );
        assert_eq!(
            answer(200, json!({"jsonrpc": "2.0", "id": 1, "error": {"code": -32602, "message": "Task not found"}})).outcome,
            "INVALID_PARAMS"
        );
        assert_eq!(
            answer(
                200,
                json!({"jsonrpc": "2.0", "id": 1, "error": {"code": -32021}})
            )
            .outcome,
            "JSONRPC_32021"
        );
        assert_eq!(
            answer(200, json!({"jsonrpc": "2.0", "id": 1, "error": {"code": -32600, "data": {"code": "INSUFFICIENT_SCOPE"}}})).outcome,
            "INSUFFICIENT_SCOPE"
        );
        let failed = answer(
            200,
            json!({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": "canary"}],
                "structuredContent": {"success": false, "error": {"code": "SPACE_NOT_READABLE", "message": "m"}},
                "isError": true}}),
        );
        assert_eq!(failed.outcome, "SPACE_NOT_READABLE");
        let odd = answer(
            200,
            json!({"jsonrpc": "2.0", "id": 1, "result": {"structuredContent": {"success": false, "error": {"code": "lower case"}}, "isError": true}}),
        );
        assert_eq!(odd.outcome, "TOOL_ERROR");
        let task = answer(
            200,
            json!({"jsonrpc": "2.0", "id": 1, "result": {"resultType": "task", "taskId": "abcdefghijklmnopqrstuvwxyz", "status": "working"}}),
        );
        assert_eq!(
            (task.outcome.as_str(), task.task.as_deref()),
            ("ok", Some("abcdefghijklmnopqrstuvwxyz"))
        );
    }

    #[test]
    fn forms_are_the_schema_s() {
        assert!(is_command_name("knowledge-search") && !is_command_name("knowledge"));
        assert!(!is_command_name("Knowledge-search") && !is_command_name("a--b"));
        assert!(is_space_id("main") && !is_space_id("Main") && !is_space_id(""));
        assert!(is_code("SPACE_NOT_READABLE") && !is_code("ok") && !is_code("_X"));
        assert!(is_trace("mcp-18a3-7") && !is_trace("a b"));
    }
}
