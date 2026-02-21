# Feature Proposal: Multi-Tool Registration Automation

## 1. Summary
Create an `afd register` CLI command to automatically detect installed AI tools and write the appropriate MCP server configuration files.

## 2. Motivation
Currently, users must manually configure their AI tools (Claude Desktop, Cursor, VS Code, Windsurf, etc.) to connect to an AFD MCP server. This setup friction hinders the adoption of AFD servers.

## 3. Proposed Solution
- Implement an `afd register` command in the CLI.
- The command will detect installed AI tools and write the appropriate MCP server config.
- Support both stdio and HTTP transports with appropriate defaults per tool.
- Handle auth configuration (bearer tokens, API keys, environment variables).
- Ensure the command is idempotent so it is safe to re-run after config changes.

## 4. Breaking Changes
**None.** This is a new CLI command and does not change any API surface.

## 5. Alternatives Considered
- Providing extensive documentation on manual configuration. While necessary, automation provides a significantly better developer experience.

## 6. Specification
See [multi-tool-registration.spec.md](./multi-tool-registration.spec.md) for the full technical specification.
