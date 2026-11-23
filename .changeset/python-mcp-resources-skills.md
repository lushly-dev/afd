---
"afd-python": minor
---

### Added

- Opt-in MCP resources (`create_server(..., resources=...)`, `ResourceEntry`, `ResourceContents`, `ResourceProvider`, `MCP_APP_MIME_TYPE`, `check_entries`) serving `resources/list`, `resources/read`, and `resources/templates/list` across Streamable HTTP and stdio in both MCP eras (R1–R6), with `dev.afd/digest` SHA-256 metadata on upfront content and modern-era cache hints (`ttlMs`, `cacheScope: "public"`).
- Opt-in Skills over MCP extension (`io.modelcontextprotocol/skills`, SEP-2640: `Skill`, `SkillCatalog`, `skill_from_directory`, `sha256_digest`, `skill_mime_type`, `parse_frontmatter`, `FrontmatterError`) serving `skills/list`, `skills/get`, skill files as `skill://` resources, and optional `resources/directory/read` (S1–S7). Promoted `pyyaml>=6.0` to the `afd[server]` extra and added a YAML 1.2 core frontmatter parser over `yaml.parse()` events.
- Extra command tool `_meta` (`tool_meta`, `check_meta_entry`, `assert_tool_meta`, `MCP_APPS_META_KEY`) with T2 key-rule validation and `advertised_input_schema` (`assert_advertised_input_schema`) kept separate from runtime input validation (T1–T3, V1–V2).

### Fixed

- Removed the MCP SDK's default `prompts` capability (always) and `resources` capability (unless `resources` or `skills` is configured), and set `resources.subscribe` and `resources.listChanged` to `false` when resources are enabled (R1).
