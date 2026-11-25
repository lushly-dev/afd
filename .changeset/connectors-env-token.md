---
"lushly-botcore": minor
---

### Breaking changes

- **`botcore-connectors` credentials come from the environment only:** the GitHub connector reads its token from `GH_TOKEN` (or the variable `github_token_env` names) and no longer falls back to running `gh auth token`. A setup that relied on the fallback sets the variable where the host starts, for example `export GH_TOKEN="$(gh auth token)"`. `GITHUB_AUTH_MISSING`'s suggestion says so. An embedder that passes its own connector policy with the former `("service", "subprocess")` effects now has host construction refused, since the commands declare only `service`: remove `subprocess` from that policy.

### Changed

- **`botcore-connectors` commands declare only the `service` effect**, since they no longer start a subprocess, so a `remote-caller` host runs them as well as a `trusted-local` one. An agent that only needs the connectors can set `tool_profile = "remote-caller"` in the LLM plugin's settings instead of `trusted-local`; the botcore-llm README shows the setup.
