# G0's rate-limit replay

These scripts answer the proposal's G0 question of whether the App's installation rate limit
carries a fleet day's reads. They ran once, on 2026-11-23, on `random`. The findings are in
[STATUS.md](../STATUS.md) under "Rate limit, settled 2026-11-23". REST was measured during the
replay. GraphQL was computed during it and read live after the gateway's update the same hour.
`results.json` holds the replays' results and each day's priced demand. It contains no transcript data.

| Script | What it does |
|---|---|
| `demand.py` | Reads the Claude and Codex transcripts on the machine it runs on. It finds every `gh` call agents made on the days given, maps each to the gateway read that answers it, and counts a polling loop by how long it ran over its `sleep` |
| `meter.py` | Runs the gateway's own `Gateway` and `GitHubApp` code through a metering transport, using the owner's `gh` token in place of the App's. It prints the REST calls and GraphQL points each read makes. Its REST counts match the App's; its GraphQL points are upper bounds, since the App's live reading came out lower |
| `replay.py` | Replays one hour of `demand.py`'s output through the deployed gateway with four callers. It reads the App's REST budget from `gateway-status` before and after |
| `gw.py` | Calls the gateway's owner route through its CLI, as the [runbook](../../../../operations/factory-gateway.md#check-it) does |

To run them again, from the repository root on `random`:

```bash
D=docs/features/active/factory-gateway/rate-replay
python3 -I $D/demand.py /tmp/demand.json 2026-11-09,2026-11-21   # once per machine
OWNER_LOGIN=$(gh api user -q .login) OWNER_GH_TOKEN=$(gh auth token) \
  uv run --frozen --extra dev --project endpoints/botcore/plugins/botcore-factory \
  python $D/meter.py '[["pr-status",{"repo":"lushly-dev/afd","number":2019}]]'
python3 -I $D/replay.py 2026-11-21T18 /tmp/demand.json
```

Each command, and what its result means:

- **`demand.py`:** its output names each read's session file. Keep that output out of the repository.
- **`meter.py`:** it spends the owner's own budget.
- **`replay.py`:** it spends the App's, which nothing else used on 2026-11-23. Once the lane or the cells read through the gateway, run it only when there is headroom for it.

These limits applied to the 2026-11-23 run, and still apply to the scripts:

- **What was missed:**
  - `gh` called inside scripts and botcore commands, and T3 Code's GitHub tools;
  - polling inside a background shell, which returns at once;
  - loops with neither `sleep` nor `seq`, counted as three passes;
  - reads that have no gateway command, which are counted but not replayed.
- **What is priced high:** every `pr-status` is priced as an open pull request, and every `claim-list` at its higher measured cost.
- **What depends on the backlog:** `claim-list` and `issue-get` page through every open issue or pull request, so their cost grows with the backlog ([#2385](https://github.com/lushly-dev/afd/issues/2385)).
- **The flag-value fix:** `demand.py` used to read a flag's value (`--limit 30`) as a pull request number. The 2026-11-23 replay ran before that was fixed, and its 13 `NOT_FOUND`s came from it.
