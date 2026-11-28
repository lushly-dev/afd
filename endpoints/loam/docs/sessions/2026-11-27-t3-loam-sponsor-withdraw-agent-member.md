# Phase 3 follow-up: a sponsor withdraws an active agent member (#2781)

- Date: 2026-11-27
- Area: phase 3, identity
- Pull request: [#3045](https://github.com/lushly-dev/afd/pull/3045), on `t3/loam-sponsor-withdraw-agent-member`, for [#2781](https://github.com/lushly-dev/afd/issues/2781)

Built the follow-up the coordinator deferred on 2026-11-15: `agent-member-withdraw { agent }`, a human
command for the sponsor alone (`AGENT_MEMBER_SPONSOR_ONLY` for anyone else, owners included), of an
active installed agent member. It writes `suspended: 'sponsor-withdrew'`, keeps the record's access
as it was and offers no undo, so it only ever takes access away; an owner reactivates it only by
naming a sponsor, who confirms (D111). A record that is not active is `AGENT_MEMBER_NOT_ACTIVE`, a
new code; a connected agent is `AGENT_MEMBER_NOT_FOUND`, whose suggestion names
`account-agent-disconnect`, and the provider is not written. It is one of `HUMAN_COMMANDS`, not served
over MCP, re-run in a replay, and a routed write on the hosted lane (`SERVER_COMMANDS`). The members
tab's sponsor row gains Withdraw, confirmed in a native modal with its consequence. From the
review: the agent-member writes now run one at a time, each from its read to its write, so a change
that read a record active cannot write it back active after a withdrawal.

The job was written first as `docs/phases/3-identity/scenarios/sponsor-withdraws-agent.scenario.yaml`,
phase 3's first scenario file, which the kernel's runner now runs on `p4-base`. The specification's
3.4, 8.1, 8.2, 8.3 and 15 are amended, and a new follow-up row closes the row of 2026-11-15; phase 6's
`SERVER_COMMANDS` listing and the architecture's command list name the command too. Under D115 the
`late-identity`, `account` and `late` ceilings rose, with the figures in that row.

Verified 2026-11-27 on Node 26.13.1: the kernel's units (1,880 passed, the new withdraw units among
them, each guarantee's unit failing when that guarantee alone is removed), the scenario, the hosted
units, Chromium's `identity/agent-members.test.ts`, `budget` and `pnpm verify`, as the pull request
records.
