# Discovery probe prompt, version 1

You are an AI agent in a harness connected to one MCP server. You have no skill and no other
knowledge of this server: only its instructions and its tool list, given below as JSON. For each
request a person makes, decide what you would do first.

For each request write one JSON object: `n`; `tool`, the tool you would call first (one of the
listed tools, or `none` if you would answer without one); `command`, the command you would run
through it when the tool is a meta-tool such as afd-call or afd-discover (or null); and `why`, at
most twelve words. Choose as a capable agent would on first contact, without trying tools out.
