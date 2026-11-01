//! The plugin manifest, version 1 (phase 1 specification, section 2): every rule with the key
//! named, the reserved keys, the schemas, path confinement and the protocol check.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::Path;

use umbel::plugins::{Effect, Manifest, PluginKind, SchemaRef, Transport};

const FILE: &str = "umbel-plugin.toml";

/// A complete compiled plugin: every section the manifest has, except `component` and `mount`.
const FULL: &str = r#"
manifest_version = 1
protocol = 1

[plugin]
id = "hello"
title = "Hello"
version = "0.1.0"
description = "One command, one pack, one skill: the reference plugin."
kind = "compiled"
domains = ["hello"]
homepage = "https://afd.dev/umbel"
license = "MIT"

[[grants]]
name = "packs"
required = true
reason = "Reads the salutation from the greetings pack."

[[commands]]
name = "hello-greet"
description = "Greet someone, in a space, with the pack's salutation."
effects = ["inspect"]
input_schema = { type = "object", properties = { name = { type = "string" } }, additionalProperties = false }
returns = { type = "object" }
category = "hello"
tags = ["example"]
version = "1.0.0"
contexts = ["hello"]
first_class = true
confirm_prompt = "Really?"
destructive = false
approval = "none"
execution_time = "instant"
expose = { mcp = true, agent = true, cli = true, palette = false }
examples = [{ title = "Greet Ada", input = { name = "Ada" } }]

[[contexts]]
name = "hello"
description = "Greeting commands."
triggers = ["greet"]
priority = 0

[[pipelines]]
name = "hello-twice"
description = "Greet two people in one call."
effects = ["inspect"]
input_schema = { type = "object", properties = { first = { type = "string" } }, additionalProperties = false }
steps = [
  { command = "hello-greet", input = { name = "$input.first" }, as = "one" },
  { command = "hello-greet", input = { name = "$input.first" }, as = "two" },
]

[[packs]]
id = "greetings"
path = "packs/greetings"

[[skills]]
name = "hello-guide"
path = "skills/hello-guide"

[config]
schema = { type = "object", properties = { default_name = { type = "string", default = "world" } }, additionalProperties = false }
"#;

const MOUNTED: &str = r#"
manifest_version = 1
protocol = 1

[plugin]
id = "tickets"
title = "Tickets"
version = "1.0.0"
description = "A ticket tracker."
kind = "mounted"
domains = ["tickets"]

[mount]
prefix = "tickets"
transport = "stdio"
command = ["bin/server"]
"#;

fn parse(text: &str) -> Result<Manifest, umbel::plugins::PluginError> {
    Manifest::parse(text, FILE)
}

/// `FULL` with `from` replaced by `to`.
fn edited(from: &str, to: &str) -> String {
    assert!(FULL.contains(from), "FULL has no `{from}`");
    FULL.replacen(from, to, 1)
}

/// The manifest is refused with `code`, and the message names `key`.
fn refused(text: &str, code: &str, key: &str) {
    let error = parse(text).expect_err(key);
    assert_eq!(error.code(), code, "{key}: {error}");
    assert!(
        error.message().contains(key),
        "{error} does not name `{key}`"
    );
    assert!(
        error.message().contains(FILE),
        "{error} does not name the file"
    );
    assert!(!error.suggestion().is_empty());
}

fn invalid(text: &str, key: &str) {
    refused(text, "PLUGIN_MANIFEST_INVALID", key);
}

// ── The shape ──────────────────────────────────────────────────────────────────────────────────

#[test]
fn the_full_manifest_is_read_whole() {
    let manifest = parse(FULL).unwrap();
    assert_eq!(manifest.plugin.id, "hello");
    assert_eq!(manifest.plugin.kind, PluginKind::Compiled);
    assert_eq!(manifest.plugin.domains, ["hello"]);
    assert_eq!(
        manifest.plugin.homepage.as_deref(),
        Some("https://afd.dev/umbel")
    );
    assert_eq!(manifest.grants.len(), 1);
    assert!(manifest.grants[0].required);
    let command = &manifest.commands[0];
    assert_eq!(command.name, "hello-greet");
    assert_eq!(command.effects, [Effect::Inspect]);
    assert!(!command.mutation());
    assert!(command.first_class);
    assert!(matches!(command.input_schema, SchemaRef::Inline(_)));
    assert!(command.expose.mcp && command.expose.cli && !command.expose.palette);
    assert_eq!(command.examples[0].0, "Greet Ada");
    assert_eq!(manifest.contexts[0].name, "hello");
    assert_eq!(manifest.pipelines[0].steps.len(), 2);
    assert_eq!(manifest.pipelines[0].steps[0].alias.as_deref(), Some("one"));
    assert_eq!(manifest.packs[0].id, "greetings");
    assert_eq!(manifest.skills[0].name, "hello-guide");
    assert!(manifest.config.is_some());
}

#[test]
fn defaults_apply() {
    let manifest = parse(
        r#"
manifest_version = 1
protocol = 1
[plugin]
id = "hello"
title = "Hello"
version = "0.1.0"
description = "d"
kind = "compiled"
domains = ["hello"]
[[grants]]
name = "log"
reason = "r"
[[commands]]
name = "hello-greet"
description = "d"
effects = ["external", "plugin-state"]
input_schema = { type = "object" }
"#,
    )
    .unwrap();
    assert!(manifest.grants[0].required, "required defaults to true");
    let command = &manifest.commands[0];
    assert!(command.mutation());
    assert!(!command.first_class && !command.destructive && !command.approval_required);
    assert!(command.expose.mcp && command.expose.agent && command.expose.cli);
    assert!(!command.expose.palette, "palette is off by default");
}

#[test]
fn a_file_that_is_not_toml_names_the_file() {
    invalid("manifest_version = [", FILE);
}

// ── Versions ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn another_manifest_version_or_protocol_is_unsupported_and_names_what_is_served() {
    for (key, text) in [
        (
            "manifest_version",
            edited("manifest_version = 1", "manifest_version = 2"),
        ),
        ("protocol", edited("protocol = 1", "protocol = 2")),
        ("protocol", edited("protocol = 1", "protocol = 0")),
    ] {
        let error = parse(&text).unwrap_err();
        assert_eq!(error.code(), "PLUGIN_PROTOCOL_UNSUPPORTED", "{key}");
        assert!(error.message().contains(key), "{error}");
        assert!(
            error.message().contains("manifest 1, protocol 1"),
            "{error}"
        );
        assert!(error.suggestion().contains("manifest 1, protocol 1"));
    }
    // A newer manifest may have keys this host cannot know: the version is judged first.
    let future = "manifest_version = 2\nprotocol = 1\nsomething_new = true\n";
    assert_eq!(
        parse(future).unwrap_err().code(),
        "PLUGIN_PROTOCOL_UNSUPPORTED"
    );
    invalid("protocol = 1\n", "manifest_version");
    invalid("manifest_version = 1\n", "protocol");
    invalid(
        "manifest_version = \"1\"\nprotocol = 1\n",
        "manifest_version",
    );
    invalid("manifest_version = 1\nprotocol = 1.5\n", "protocol");
}

// ── Unknown and reserved keys ──────────────────────────────────────────────────────────────────

#[test]
fn unknown_keys_are_refused_at_every_level() {
    invalid(&format!("{FULL}\nbogus = 1\n"), "bogus");
    invalid(
        &edited("kind = \"compiled\"", "kind = \"compiled\"\nbogus = 1"),
        "plugin.bogus",
    );
    invalid(
        &edited("reason =", "bogus = 1\nreason ="),
        "grants[0].bogus",
    );
    invalid(
        &edited("category = \"hello\"", "bogus = 1"),
        "commands[0].bogus",
    );
    invalid(
        &edited("triggers = [\"greet\"]", "bogus = 1"),
        "contexts[0].bogus",
    );
    invalid(
        &edited(
            "path = \"packs/greetings\"",
            "path = \"packs/greetings\"\nbogus = 1",
        ),
        "packs[0].bogus",
    );
    invalid(
        &edited(
            "path = \"skills/hello-guide\"",
            "path = \"skills/hello-guide\"\nbogus = 1",
        ),
        "skills[0].bogus",
    );
    invalid(
        &edited("palette = false }", "palette = false, bogus = true }"),
        "commands[0].expose.bogus",
    );
    invalid(
        &edited(
            "input = { name = \"Ada\" } }]",
            "input = { name = \"Ada\" }, bogus = 1 }]",
        ),
        "commands[0].examples[0].bogus",
    );
}

#[test]
fn reserved_keys_are_refused_and_say_why() {
    for key in [
        "ui",
        "connectors",
        "backends",
        "dependencies",
        "signature",
        "scopes",
        "on_conflict",
    ] {
        // A top-level key must precede the first table.
        let text = FULL.replacen("protocol = 1\n", &format!("protocol = 1\n{key} = 1\n"), 1);
        let error = parse(&text).unwrap_err();
        assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{key}");
        assert!(error.message().contains(&format!("`{key}`")), "{error}");
        assert!(error.message().contains("reserved"), "{error}");
        assert!(
            error
                .message()
                .contains("manifest version 1 does not define it"),
            "{error}"
        );
    }
    let allow = edited("required = true", "required = true\nallow = [\"x\"]");
    let error = parse(&allow).unwrap_err();
    assert!(error.message().contains("grants[0].allow"));
    assert!(error.message().contains("reserved"));
    let scopes = edited("category = \"hello\"", "scopes = [\"read\"]");
    assert!(
        parse(&scopes)
            .unwrap_err()
            .message()
            .contains("commands[0].scopes")
    );
}

// ── [plugin] ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn plugin_fields_follow_their_rules() {
    invalid("manifest_version = 1\nprotocol = 1\n", "plugin");
    for (from, to, key) in [
        ("id = \"hello\"", "id = \"Hello\"", "plugin.id"),
        ("id = \"hello\"", "id = \"hel-lo\"", "plugin.id"),
        ("id = \"hello\"", "id = \"1ello\"", "plugin.id"),
        (
            "id = \"hello\"",
            "id = \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"",
            "plugin.id",
        ),
        ("title = \"Hello\"", "title = \"\"", "plugin.title"),
        ("version = \"0.1.0\"", "version = \"0.1\"", "plugin.version"),
        ("version = \"0.1.0\"", "version = 1", "plugin.version"),
        ("kind = \"compiled\"", "kind = \"wasm\"", "plugin.kind"),
        (
            "homepage = \"https://afd.dev/umbel\"",
            "homepage = \"http://afd.dev\"",
            "plugin.homepage",
        ),
        (
            "license = \"MIT\"",
            "license = \"MIT; DROP\"",
            "plugin.license",
        ),
    ] {
        invalid(&edited(from, to), key);
    }
    let long = format!("description = \"{}\"", "x".repeat(501));
    invalid(
        &edited(
            "description = \"One command, one pack, one skill: the reference plugin.\"",
            &long,
        ),
        "plugin.description",
    );
    invalid(
        &edited("title = \"Hello\"", "title = \"a\\u0007b\""),
        "plugin.title",
    );
}

#[test]
fn domains_are_required_distinct_and_never_the_hosts() {
    invalid(&edited("domains = [\"hello\"]\n", ""), "plugin.domains");
    invalid(
        &edited("domains = [\"hello\"]", "domains = []"),
        "plugin.domains",
    );
    invalid(
        &edited("domains = [\"hello\"]", "domains = [\"hello\", \"hello\"]"),
        "plugin.domains",
    );
    for taken in ["workspace", "space", "event", "plugin", "skill", "afd"] {
        let text = edited("domains = [\"hello\"]", &format!("domains = [\"{taken}\"]"));
        let error = parse(&text).unwrap_err();
        assert!(
            error.message().contains("plugin.domains") && error.message().contains("host domain"),
            "{taken}: {error}"
        );
    }
    for verb in ["init", "serve", "help", "docs", "schema", "call", "batch"] {
        let text = edited("domains = [\"hello\"]", &format!("domains = [\"{verb}\"]"));
        let error = parse(&text).unwrap_err();
        assert!(
            error.message().contains("reserved CLI verb"),
            "{verb}: {error}"
        );
    }
    invalid(
        &edited("domains = [\"hello\"]", "domains = [\"Hello\"]"),
        "plugin.domains",
    );
}

// ── Commands ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn command_names_follow_afds_rule_and_start_with_a_declared_domain() {
    for bad in [
        "hello",
        "Hello-greet",
        "hello_greet",
        "hello--greet",
        "-hello-greet",
    ] {
        invalid(
            &edited("name = \"hello-greet\"", &format!("name = \"{bad}\"")),
            "commands[0].name",
        );
    }
    // Outside the plugin's domains, including the host's own.
    for outside in ["other-greet", "workspace-greet", "event-list", "afd-help"] {
        let text = edited("name = \"hello-greet\"", &format!("name = \"{outside}\""));
        let error = parse(&text).unwrap_err();
        assert!(
            error.message().contains("commands[0].name") && error.message().contains("domains"),
            "{outside}: {error}"
        );
    }
    // The pipeline's step still names the old command, which is fine: steps are checked at seal.
    let mut two = edited("name = \"hello-greet\"", "name = \"hello-greet\"");
    two.push_str(
        "\n[[commands]]\nname = \"hello-greet\"\ndescription = \"d\"\neffects = [\"inspect\"]\ninput_schema = { type = \"object\" }\n",
    );
    invalid(&two, "commands[1].name");
}

#[test]
fn effects_come_from_the_catalog() {
    for (effects, why) in [
        ("[]", "at least one"),
        ("[\"destroy\"]", "not an effect"),
        ("[\"store-write\"]", "reserved for phase 2"),
        ("[\"workspace-write\"]", "host's own commands"),
        ("[\"inspect\", \"external\"]", "alone"),
        ("[\"external\", \"external\"]", "twice"),
        ("\"inspect\"", "array of strings"),
    ] {
        let error = parse(&edited(
            "effects = [\"inspect\"]\ninput",
            &format!("effects = {effects}\ninput"),
        ))
        .unwrap_err();
        assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{effects}");
        assert!(
            error.message().contains("commands[0].effects"),
            "{effects}: {error}"
        );
        assert!(error.message().contains(why), "{effects}: {error}");
    }
    invalid(
        &edited("effects = [\"inspect\"]\ninput", "input"),
        "commands[0].effects",
    );
    let state = parse(&edited(
        "effects = [\"inspect\"]\ninput",
        "effects = [\"plugin-state\", \"external\"]\ninput",
    ))
    .unwrap();
    assert!(state.commands[0].mutation());
}

#[test]
fn input_schemas_are_objects_the_afd_checker_accepts() {
    let inline = |schema: &str| {
        edited(
            "input_schema = { type = \"object\", properties = { name = { type = \"string\" } }, additionalProperties = false }",
            &format!("input_schema = {schema}"),
        )
    };
    invalid(&inline("{ type = \"string\" }"), "commands[0].input_schema");
    invalid(&inline("{ properties = {} }"), "commands[0].input_schema");
    // `pattern` is a keyword the checker refuses (phase 0 amendments from step 4).
    let with_pattern = inline(
        "{ type = \"object\", properties = { a = { type = \"string\", pattern = \"^a$\" } } }",
    );
    let error = parse(&with_pattern).unwrap_err();
    assert!(
        error.message().contains("commands[0].input_schema") && error.message().contains("pattern"),
        "{error}"
    );
    invalid(&inline("3"), "commands[0].input_schema");
    invalid(
        &edited("input_schema = {", "# none\nxinput_schema = {"),
        "commands[0].xinput_schema",
    );
    // Required.
    let missing = FULL.replacen(
        "input_schema = { type = \"object\", properties = { name = { type = \"string\" } }, additionalProperties = false }\n",
        "",
        1,
    );
    invalid(&missing, "commands[0].input_schema");
    // A path names a JSON file inside the plugin root.
    let path = |p: &str| inline(&format!("\"{p}\""));
    assert!(matches!(
        parse(&path("schemas/hello-greet.input.json"))
            .unwrap()
            .commands[0]
            .input_schema,
        SchemaRef::File(_)
    ));
    for bad in [
        "../x.json",
        "schemas/../../x.json",
        "/etc/x.json",
        "schemas/x.txt",
        "",
        "a\\\\b.json",
    ] {
        invalid(&path(bad), "commands[0].input_schema");
    }
}

#[test]
fn command_options_are_checked() {
    invalid(
        &edited("approval = \"none\"", "approval = \"always\""),
        "commands[0].approval",
    );
    invalid(
        &edited(
            "execution_time = \"instant\"",
            "execution_time = \"eventually\"",
        ),
        "commands[0].execution_time",
    );
    invalid(
        &edited("version = \"1.0.0\"", "version = \"one\""),
        "commands[0].version",
    );
    invalid(
        &edited("contexts = [\"hello\"]", "contexts = [\"Hello\"]"),
        "commands[0].contexts",
    );
    invalid(
        &edited("first_class = true", "first_class = \"yes\""),
        "commands[0].first_class",
    );
    invalid(
        &edited("destructive = false", "destructive = 1"),
        "commands[0].destructive",
    );
    invalid(
        &edited("mcp = true, agent", "mcp = 1, agent"),
        "commands[0].expose.mcp",
    );
    invalid(
        &edited("input = { name = \"Ada\" } }]", "input = 3 }]"),
        "commands[0].examples[0]",
    );
    invalid(
        &edited("confirm_prompt = \"Really?\"", "confirm_prompt = \"\""),
        "commands[0].confirm_prompt",
    );
}

#[test]
fn names_are_unique_inside_one_manifest() {
    let again = |section: &str| format!("{FULL}\n{section}");
    invalid(
        &again("[[contexts]]\nname = \"hello\"\ndescription = \"again\""),
        "contexts[1].name",
    );
    invalid(
        &again("[[packs]]\nid = \"greetings\"\npath = \"packs/other\""),
        "packs[1].id",
    );
    invalid(
        &again("[[skills]]\nname = \"hello-guide\"\npath = \"skills/hello-guide\""),
        "skills[1].name",
    );
    invalid(
        &again("[[grants]]\nname = \"packs\"\nreason = \"again\""),
        "grants[1].name",
    );
    // A pipeline cannot take a command's name either.
    invalid(
        &edited("name = \"hello-twice\"", "name = \"hello-greet\""),
        "pipelines[0].name",
    );
}

// ── Contexts, pipelines, packs, skills, config ─────────────────────────────────────────────────

#[test]
fn contexts_start_with_a_domain() {
    invalid(
        &edited(
            "name = \"hello\"\ndescription = \"Greeting",
            "name = \"other\"\ndescription = \"Greeting",
        ),
        "contexts[0].name",
    );
    let ok = edited(
        "name = \"hello\"\ndescription = \"Greeting",
        "name = \"hello-extra\"\ndescription = \"Greeting",
    )
    .replace("contexts = [\"hello\"]", "contexts = [\"hello-extra\"]");
    parse(&ok).unwrap();
    // A command may only list contexts the manifest declares.
    invalid(
        &edited(
            "contexts = [\"hello\"]",
            "contexts = [\"hello-undeclared\"]",
        ),
        "commands[0].contexts",
    );
    invalid(
        &edited("priority = 0", "priority = \"high\""),
        "contexts[0].priority",
    );
}

#[test]
fn pipelines_are_commands_as_data_without_parallel_or_streaming_steps() {
    invalid(
        &edited("name = \"hello-twice\"", "name = \"other-twice\""),
        "pipelines[0].name",
    );
    invalid(
        &edited(
            "effects = [\"inspect\"]\ninput_schema = { type = \"object\", properties = { first",
            "effects = []\ninput_schema = { type = \"object\", properties = { first",
        ),
        "pipelines[0].effects",
    );
    invalid(
        &edited(
            "{ command = \"hello-greet\", input = { name = \"$input.first\" }, as = \"one\" }",
            "{ command = \"hello-greet\", parallel = true }",
        ),
        "pipelines[0].steps[0].parallel",
    );
    invalid(
        &edited(
            "{ command = \"hello-greet\", input = { name = \"$input.first\" }, as = \"one\" }",
            "{ command = \"hello-greet\", stream = true }",
        ),
        "pipelines[0].steps[0].stream",
    );
    invalid(
        &edited(
            "{ command = \"hello-greet\", input = { name = \"$input.first\" }, as = \"one\" }",
            "{ command = \"Hello\" }",
        ),
        "pipelines[0].steps[0].command",
    );
    invalid(
        &edited("as = \"two\"", "as = \"one\""),
        "pipelines[0].steps[1].as",
    );
    invalid(
        &edited(
            "input = { name = \"$input.first\" }, as = \"one\"",
            "input = \"x\", as = \"one\"",
        ),
        "pipelines[0].steps[0].input",
    );
    let none = FULL.replacen(
        "steps = [\n  { command = \"hello-greet\", input = { name = \"$input.first\" }, as = \"one\" },\n  { command = \"hello-greet\", input = { name = \"$input.first\" }, as = \"two\" },\n]",
        "steps = []",
        1,
    );
    invalid(&none, "pipelines[0].steps");
}

#[test]
fn pack_and_skill_ids_follow_their_rules() {
    invalid(
        &edited("id = \"greetings\"", "id = \"Greetings\""),
        "packs[0].id",
    );
    invalid(
        &edited(
            "path = \"packs/greetings\"",
            "path = \"../packs/greetings\"",
        ),
        "packs[0].path",
    );
    invalid(
        &edited("path = \"packs/greetings\"", "path = \"/packs/greetings\""),
        "packs[0].path",
    );
    invalid(
        &edited("name = \"hello-guide\"", "name = \"guide\""),
        "skills[0].name",
    );
    invalid(
        &edited("name = \"hello-guide\"", "name = \"Hello-guide\""),
        "skills[0].name",
    );
    invalid(
        &edited("path = \"skills/hello-guide\"", "path = \"skills/other\""),
        "skills[0].path",
    );
    // The skill may be named for the plugin itself.
    parse(&edited(
        "name = \"hello-guide\"\npath = \"skills/hello-guide\"",
        "name = \"hello\"\npath = \"skills/hello\"",
    ))
    .unwrap();
}

#[test]
fn the_configuration_schema_is_a_closed_object() {
    let open = edited(
        "default = \"world\" } }, additionalProperties = false }",
        "default = \"world\" } } }",
    );
    let error = parse(&open).unwrap_err();
    assert!(error.message().contains("config.schema"), "{error}");
    assert!(error.message().contains("additionalProperties"), "{error}");
    let not_object = edited(
        "schema = { type = \"object\", properties = { default_name = { type = \"string\", default = \"world\" } }, additionalProperties = false }",
        "schema = { type = \"string\" }",
    );
    invalid(&not_object, "config.schema");
    invalid(
        &edited("[config]\nschema =", "[config]\nschema_file ="),
        "config.schema_file",
    );
    let path = edited(
        "schema = { type = \"object\", properties = { default_name = { type = \"string\", default = \"world\" } }, additionalProperties = false }",
        "schema = \"config.schema.json\"",
    );
    assert!(matches!(
        parse(&path).unwrap().config.unwrap().schema,
        SchemaRef::File(_)
    ));
}

// ── Kinds ──────────────────────────────────────────────────────────────────────────────────────

fn component(extra: &str) -> String {
    format!(
        r#"
manifest_version = 1
protocol = 1
[plugin]
id = "hello"
title = "Hello"
version = "0.1.0"
description = "d"
kind = "component"
domains = ["hello"]
{extra}
"#
    )
}

#[test]
fn a_component_plugin_names_its_file_and_no_world() {
    let ok = parse(&component("[component]\npath = \"hello.wasm\"")).unwrap();
    assert_eq!(ok.component.unwrap().path, "hello.wasm");
    invalid(&component(""), "component");
    invalid(
        &component("[component]\npath = \"hello.wasm\"\nworld = \"umbel:plugin/plugin@1.0.0\""),
        "component.world",
    );
    invalid(
        &component("[component]\npath = \"hello.bin\""),
        "component.path",
    );
    invalid(
        &component("[component]\npath = \"../hello.wasm\""),
        "component.path",
    );
    invalid(
        &component("[component]\npath = \"/tmp/hello.wasm\""),
        "component.path",
    );
    invalid(&component("[component]"), "component.path");
    // Refused for every other kind.
    invalid(
        &format!("{FULL}\n[component]\npath = \"hello.wasm\"\n"),
        "component",
    );
}

#[test]
fn a_mounted_plugin_declares_a_mount_and_no_commands_or_grants() {
    let manifest = parse(MOUNTED).unwrap();
    let mount = manifest.mount.unwrap();
    assert_eq!(mount.prefix, "tickets");
    assert_eq!(mount.transport, Transport::Stdio);
    assert_eq!(mount.command, ["bin/server"]);
    invalid(
        &MOUNTED.replace(
            "[mount]\nprefix = \"tickets\"\ntransport = \"stdio\"\ncommand = [\"bin/server\"]\n",
            "",
        ),
        "mount",
    );
    invalid(
        &MOUNTED.replace("prefix = \"tickets\"", "prefix = \"other\""),
        "mount.prefix",
    );
    invalid(
        &MOUNTED.replace("prefix = \"tickets\"", "prefix = \"workspace\""),
        "mount.prefix",
    );
    invalid(
        &MOUNTED.replace("transport = \"stdio\"", "transport = \"smoke\""),
        "mount.transport",
    );
    invalid(
        &MOUNTED.replace("command = [\"bin/server\"]\n", ""),
        "mount.command",
    );
    invalid(
        &MOUNTED.replace("command = [\"bin/server\"]", "command = []"),
        "mount.command",
    );
    invalid(&format!("{MOUNTED}cwd = \"../out\"\n"), "mount.cwd");
    invalid(&format!("{MOUNTED}bearer = \"required\"\n"), "mount.bearer");
    invalid(&format!("{MOUNTED}[mount.env]\nA = 1\n"), "mount.env.A");
    invalid(
        &format!("{MOUNTED}[[commands]]\nname = \"tickets-list\"\n"),
        "commands",
    );
    invalid(
        &format!("{MOUNTED}[[grants]]\nname = \"log\"\nreason = \"r\"\n"),
        "grants",
    );
    // The mount is for mounted plugins only.
    invalid(
        &format!("{FULL}\n[mount]\nprefix = \"hello\"\ntransport = \"stdio\"\ncommand = [\"x\"]\n"),
        "mount",
    );
}

#[test]
fn where_a_mount_runs_and_its_credential_are_the_deployers_not_the_manifests() {
    for key in ["url", "bearer_env"] {
        let text = format!("{MOUNTED}{key} = \"x\"\n");
        let error = parse(&text).unwrap_err();
        assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{key}");
        assert!(error.message().contains(&format!("mount.{key}")), "{error}");
        assert!(error.message().contains("umbel.toml"), "{error}");
    }
    let http = MOUNTED
        .replace("transport = \"stdio\"", "transport = \"http\"")
        .replace("command = [\"bin/server\"]\n", "bearer = \"required\"\n");
    let manifest = parse(&http).unwrap();
    assert_eq!(manifest.mount.as_ref().unwrap().transport, Transport::Http);
    assert!(manifest.is_http_mount());
    invalid(
        &format!("{http}url = \"https://x.example/mcp\"\n"),
        "mount.url",
    );
    invalid(&format!("{http}command = [\"x\"]\n"), "mount.command");
    invalid(&format!("{http}cwd = \".\"\n"), "mount.cwd");
    invalid(
        &http.replace("bearer = \"required\"", "bearer = \"always\""),
        "mount.bearer",
    );
}

#[test]
fn mount_tool_overrides_are_checked() {
    let with = |tools: &str| format!("{MOUNTED}{tools}");
    let ok = parse(&with(
        "only = [\"a\", \"b\"]\n[[mount.tools]]\ntool = \"a\"\nname = \"search\"\neffects = [\"inspect\"]\nbind_space = true\nfirst_class = true\napproval = \"required\"\nconfirm_prompt = \"Sure?\"\n",
    ))
    .unwrap();
    let tool = &ok.mount.unwrap().tools[0];
    assert_eq!(tool.name.as_deref(), Some("search"));
    assert_eq!(tool.effects.as_deref(), Some(&[Effect::Inspect][..]));
    assert!(tool.bind_space && tool.first_class && tool.approval_required);
    invalid(&with("only = [\"a\", \"a\"]\n"), "mount.only");
    invalid(
        &with("[[mount.tools]]\nname = \"x\"\n"),
        "mount.tools[0].tool",
    );
    invalid(
        &with("[[mount.tools]]\ntool = \"a\"\nname = \"Bad Name\"\n"),
        "mount.tools[0].name",
    );
    invalid(
        &with("[[mount.tools]]\ntool = \"a\"\neffects = [\"store-write\"]\n"),
        "mount.tools[0].effects",
    );
    invalid(
        &with("[[mount.tools]]\ntool = \"a\"\nbogus = 1\n"),
        "mount.tools[0].bogus",
    );
    invalid(
        &with("[[mount.tools]]\ntool = \"a\"\n[[mount.tools]]\ntool = \"a\"\n"),
        "mount.tools[1].tool",
    );
    invalid(
        &with(
            "[[mount.tools]]\ntool = \"a\"\nname = \"x\"\n[[mount.tools]]\ntool = \"b\"\nname = \"x\"\n",
        ),
        "mount.tools[1].tool",
    );
}

#[test]
fn a_pack_plugin_has_packs_and_skills_only() {
    let pack = r#"
manifest_version = 1
protocol = 1
[plugin]
id = "style"
title = "Style"
version = "1.0.0"
description = "d"
kind = "pack"
[[packs]]
id = "voice"
path = "packs/voice"
[[skills]]
name = "style-guide"
path = "skills/style-guide"
"#;
    let manifest = parse(pack).unwrap();
    assert!(manifest.plugin.domains.is_empty());
    invalid(
        &pack.replace("kind = \"pack\"", "kind = \"pack\"\ndomains = [\"style\"]"),
        "plugin.domains",
    );
    invalid(
        &format!("{pack}[[commands]]\nname = \"style-x\"\n"),
        "commands",
    );
    invalid(
        &format!("{pack}[[grants]]\nname = \"log\"\nreason = \"r\"\n"),
        "grants",
    );
    invalid(
        &format!("{pack}[[contexts]]\nname = \"style\"\ndescription = \"d\"\n"),
        "contexts",
    );
    invalid(
        &format!("{pack}[[pipelines]]\nname = \"style-x\"\n"),
        "pipelines",
    );
    invalid(
        &format!("{pack}[component]\npath = \"x.wasm\"\n"),
        "component",
    );
}

// ── Files ──────────────────────────────────────────────────────────────────────────────────────

fn plugin_dir(manifest: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join(FILE), manifest).unwrap();
    dir
}

fn write(dir: &Path, rel: &str, text: &str) {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn load_invalid(dir: &Path, key: &str) {
    let error = Manifest::load(dir).unwrap_err();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{error}");
    assert!(
        error.message().contains(key),
        "{error} does not name `{key}`"
    );
}

/// FULL with schemas, packs and skills on disk.
fn full_on_disk() -> tempfile::TempDir {
    let manifest = edited(
        "input_schema = { type = \"object\", properties = { name = { type = \"string\" } }, additionalProperties = false }\nreturns = { type = \"object\" }",
        "input_schema = \"schemas/hello-greet.input.json\"\nreturns = \"schemas/hello-greet.output.json\"",
    )
    .replace(
        "schema = { type = \"object\", properties = { default_name = { type = \"string\", default = \"world\" } }, additionalProperties = false }",
        "schema = \"config.schema.json\"",
    );
    let dir = plugin_dir(&manifest);
    let root = dir.path();
    write(
        root,
        "schemas/hello-greet.input.json",
        r#"{"type":"object","properties":{"name":{"type":"string"}}}"#,
    );
    write(
        root,
        "schemas/hello-greet.output.json",
        r#"{"type":"object"}"#,
    );
    write(
        root,
        "config.schema.json",
        r#"{"type":"object","properties":{"default_name":{"type":"string","default":"world"}},"additionalProperties":false}"#,
    );
    write(root, "packs/greetings/pack.toml", "x");
    write(root, "skills/hello-guide/SKILL.md", "# hello");
    dir
}

#[test]
fn a_plugin_directory_with_every_file_loads() {
    let dir = full_on_disk();
    let manifest = Manifest::load(dir.path()).unwrap();
    assert_eq!(manifest.plugin.id, "hello");
    let files = umbel::plugins::DirFiles::new(dir.path()).unwrap();
    let schema = manifest.commands[0].input_schema.load(&files).unwrap();
    assert_eq!(schema["type"], "object");
}

#[test]
fn the_files_a_manifest_names_must_exist_and_be_what_they_claim() {
    let dir = full_on_disk();
    let root = dir.path();
    write(root, "schemas/hello-greet.input.json", "not json");
    load_invalid(root, "commands[0].input_schema");
    write(root, "schemas/hello-greet.input.json", "[1]");
    load_invalid(root, "commands[0].input_schema");
    // The afd checker also judges a schema in a file.
    write(
        root,
        "schemas/hello-greet.input.json",
        r#"{"type":"object","properties":{"a":{"type":"string","pattern":"^a$"}}}"#,
    );
    load_invalid(root, "commands[0].input_schema");
    write(
        root,
        "schemas/hello-greet.input.json",
        r#"{"type":"object"}"#,
    );
    fs::remove_file(root.join("schemas/hello-greet.output.json")).unwrap();
    load_invalid(root, "commands[0].returns");
    write(root, "schemas/hello-greet.output.json", "{}");
    write(root, "config.schema.json", r#"{"type":"object"}"#);
    load_invalid(root, "config.schema");
    write(
        root,
        "config.schema.json",
        r#"{"type":"object","additionalProperties":false}"#,
    );
    fs::remove_dir_all(root.join("packs")).unwrap();
    load_invalid(root, "packs[0].path");
    write(root, "packs/greetings/pack.toml", "x");
    fs::remove_file(root.join("skills/hello-guide/SKILL.md")).unwrap();
    load_invalid(root, "skills[0].path");
    write(root, "skills/hello-guide/SKILL.md", "x");
    Manifest::load(root).unwrap();
}

#[test]
fn a_directory_without_a_manifest_names_the_file() {
    let dir = tempfile::tempdir().unwrap();
    load_invalid(dir.path(), FILE);
    load_invalid(&dir.path().join("missing"), FILE);
}

#[test]
fn a_component_file_must_exist_and_fit_the_cap() {
    let dir = plugin_dir(&component("[component]\npath = \"hello.wasm\""));
    load_invalid(dir.path(), "component.path");
    write(dir.path(), "hello.wasm", "\0asm");
    Manifest::load(dir.path()).unwrap();
    let big = fs::File::create(dir.path().join("hello.wasm")).unwrap();
    big.set_len(umbel::plugins::MAX_COMPONENT_BYTES + 1)
        .unwrap();
    let error = Manifest::load(dir.path()).unwrap_err();
    assert!(
        error.message().contains("component.path") && error.message().contains("limit"),
        "{error}"
    );
}

#[cfg(unix)]
#[test]
fn a_path_cannot_leave_the_plugin_root_through_a_symlink() {
    let dir = full_on_disk();
    let outside = tempfile::tempdir().unwrap();
    write(outside.path(), "x.json", r#"{"type":"object"}"#);
    fs::remove_file(dir.path().join("schemas/hello-greet.input.json")).unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("x.json"),
        dir.path().join("schemas/hello-greet.input.json"),
    )
    .unwrap();
    let error = Manifest::load(dir.path()).unwrap_err();
    assert!(
        error.message().contains("commands[0].input_schema"),
        "{error}"
    );
    assert!(error.message().contains("symlink"), "{error}");

    // A directory linked out is refused the same way.
    let dir = full_on_disk();
    fs::remove_dir_all(dir.path().join("skills")).unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    write(elsewhere.path(), "hello-guide/SKILL.md", "x");
    std::os::unix::fs::symlink(elsewhere.path(), dir.path().join("skills")).unwrap();
    load_invalid(dir.path(), "skills[0].path");
}
