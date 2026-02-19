# Trust Through Validation

CLI validation is central to AFD because it builds the foundation for user trust in agent-powered applications.

## The Trust Problem

Users interacting with AI agents face: **"Can I trust this agent to do what I need?"** Without trust, users manually verify every action, limit agents to trivial tasks, or abandon agent features entirely.

## Competence Trust

**Competence Trust** = user confidence in the agent's ability to perform tasks effectively and reliably.

| Component | Definition | How AFD Addresses It |
|-----------|------------|---------------------|
| **Capability Transparency** | Clear communication of what the agent can/cannot do | Commands have explicit schemas |
| **Performance Consistency** | Reliable execution within stated parameters | CLI-tested commands work the same every time |
| **Error Handling** | Graceful management of mistakes | Standardized error schemas with suggestions |
| **Expertise Boundaries** | Honest acknowledgment of limits | Commands fail clearly rather than hallucinate |

## The AFD Trust Chain

```
1. DEFINE    -> Command schema declares capabilities
2. VALIDATE  -> Developer proves command works via CLI
3. TEST      -> Automated tests verify consistent behavior
4. SURFACE   -> UI invokes the proven command
5. TRUST     -> User experiences reliable behavior
```

Each step reinforces the next:
- **Define -> Capability Transparency**: Schema IS the capability declaration
- **Validate -> Performance Consistency**: CLI strips away UI tricks; what remains is the raw capability
- **Test -> Reliability Proof**: Tests run on every commit, preventing regression
- **Surface -> Consistent Experience**: UI gets exact same behavior as CLI
- **Trust -> User Confidence**: Reliable behavior compounds into Competence Trust

## The Anti-Pattern: UI-Only Features

```
1. Build UI feature
2. It works! (in the browser, with the right clicks)
3. Agent tries to use it... how?
4. Reverse-engineer UI into API
5. API doesn't quite match UI behavior
6. User trust erodes
```

## Trust Signals in Command Results

### Confidence Scores
A well-calibrated confidence score tells users how much to trust this specific result, whether to verify manually, and whether to explore alternatives.

### Reasoning
Enables transparency (users understand *why*), verification (users can check the logic), and learning (users learn the agent's decision process).

### Sources
Enable attribution (where did this come from?), verification (users can check the source), and trust calibration (authoritative sources increase confidence).

## Measuring Trust

| Metric | What It Measures | Target |
|--------|------------------|--------|
| **Command success rate** | Do commands work? | > 99% |
| **Error clarity score** | Are errors actionable? | User survey |
| **Retry rate** | Do users retry failed commands? | Lower is better |
| **Override rate** | How often do users override agent suggestions? | Contextual |
| **Delegation expansion** | Do users delegate more tasks over time? | Increasing |

Segment these by **surface** (UI vs agent vs automation) and **command type** (query vs mutation) for actionable insights.

## The Honesty Check in Practice

Before shipping any feature:

```bash
# Can I do this via CLI?
$ afd call feature.action --input "test"

# If yes: Ship it
# If no: Fix the abstraction first
```

| Feature | Honesty Check | Result |
|---------|---------------|--------|
| "Review document" | `afd call content.review --file doc.md` | Pass |
| "Drag to reorder" | `afd call items.reorder --ids [1,3,2]` | Pass |
| "Hover to preview" | Uses `afd call document.getSummary --id doc-1` | Pass (UI triggers existing query) |
| "Auto-save on blur" | `afd call document.save --id doc-1` | Pass (event triggers command) |
