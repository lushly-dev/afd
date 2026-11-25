---
"@lushly-dev/afd-auth": minor
---

`auth-sign-in` is no longer exposed to agents (`expose.agent` is now `false`; it stays on the palette and the CLI, and off MCP). A person signs in, so an agent is never handed a password or a sign-in to drive; an agent's call is refused with `COMMAND_NOT_EXPOSED` and the command is not in its list. An in-app agent that called `auth-sign-in` loses that command: it asks the person to sign in instead, as the `UNAUTHORIZED` and `TOKEN_EXPIRED` suggestions now say. A Loam journal that recorded an agent's sign-in before this still replays, from its record. `auth-sign-out` and `auth-session-get` are unchanged.
