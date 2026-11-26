# The seed library

The application the Agent-First Design bench is built on: a neighbourhood group that lends
packets of seed. A desk volunteer lends and takes back packets, another takes in donated boxes,
and a steward decides who gets the rare varieties. Its design, jobs and drafted commands are in
[`seed-library.md`](../../../docs/features/complete/agent-first-design/bench/seed-library.md),
and the [bench specification](../../../docs/features/complete/agent-first-design/bench.md) says
what the bench does with it. Each of the bench's four screens is built against these commands.

It is an example, private to this repository and never published.

## What is here

- **24 commands** (`src/commands/`), defined with `defineCommand`, each with a zod input
  schema, an `output` schema for its `data` (`src/schemas.ts`) and the refusals it returns.
  Every refusal carries a `suggestion` that names the command to call next.
- **An in-memory store** (`src/store.ts`) loaded from a fixture, with ids from a counter per
  prefix and time from the caller's clock, so a run against a fixture gives the same results
  every time.
- **The host's part** (`src/app.ts`): the approval middleware holds `loan-create` for a rare
  variety, and its hook records the hold as a request for the steward. Middleware in
  `src/steward.ts` refuses the steward's four commands to anyone but a person with the
  steward's role.
- **The 17 jobs** as scenario files (`scenarios/`), with the two fixtures they start from.

## Running it

```bash
pnpm -F @afd/example-seed-library test   # the 17 jobs, the bench's results and the commands' trust metadata
pnpm -F @afd/example-seed-library build
pnpm -F @afd/example-seed-library start  # MCP and HTTP on port 3100, from scenarios/fixtures/library.json
```

The tests run fifteen jobs in process as a person with the steward's role. Jobs 12 and 16
begin with a call that must be refused with `CONFIRMATION_REQUIRED`, which only a server that
enforces confirmations returns, so those two run over MCP against one, as the same person. `src/results.test.ts` checks
every file in the bench's
[`results/`](../../../docs/features/complete/agent-first-design/bench/results/) against its
command's `output` schema and refusals.

`start` serves every call as an agent, which is refused the steward's commands. Set
`SEED_LIBRARY_ACTOR=steward` to serve every call as the steward, and `SEED_LIBRARY_FIXTURE` to
start from another fixture.

**The server has no authentication.** It is for tests and local tools: `start` listens on 127.0.0.1
only, and it must not be exposed beyond loopback. Its actor is fixed: every call is an agent, or with
`SEED_LIBRARY_ACTOR=steward` every call is the steward, standing in for a sign-in a real host
would verify. With that set, anyone who can reach the port is the steward.
