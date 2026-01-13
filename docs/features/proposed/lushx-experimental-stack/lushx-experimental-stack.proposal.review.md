# Proposal Review: Lushx Experimental Workflow-as-Code Stack

**Reviewer**: Claude (pr-review skill)
**Date**: 2026-01-12
**Proposal**: `lushx-experimental-stack.proposal.md`
**Verdict**: **Request Changes** (blockers must be addressed)

---

## BLOCKERS

Issues that must be resolved before approval.

### 1. Missing AFD Alignment: Commands Not Defined

The proposal describes "workflow-as-code" with Python functions calling `lushx.*` methods, but **no command definitions are provided**.

**Problem**: AFD requires commands to be defined with schemas before any UI or orchestration. The proposal jumps to orchestration code without showing:
- What commands exist (`lushx.work.start`, `lushx.spec.create`, etc.)
- Their input/output schemas
- How they return `CommandResult` with reasoning/confidence

**Required**: Add a section showing concrete command definitions using AFD patterns:
```python
@mcp.tool()
async def work_start(issue: str) -> CommandResult[WorkSession]:
    # Returns CommandResult with reasoning, not raw data
```

**Reference**: CLAUDE.md - "All functionality is exposed as commands before any UI is built"

### 2. Control Center Architecture Conflicts with AFD Philosophy

The Control Center proposal describes an Electron/Tauri desktop app with:
- Agent panes with embedded terminals
- Human controls (Pause/Stop/Finish buttons)
- Settings panels

**Problem**: This is **UI-first thinking** in an agent-first proposal. Per AFD philosophy:
- Commands ARE the application
- UI should be a projection of command results, not the source of truth

**Required**: Reframe Control Center as:
1. First: Define the MCP commands (`agent-spawn`, `agent-pause`, `agent-status`)
2. Then: Control Center becomes one possible UI surface calling those commands
3. Show how CLI users could achieve same functionality via `afd call agent-spawn`

### 3. Convex Dependency Not Justified

The proposal introduces Convex for state management without:
- Explaining why file-based state (which the research praises) is insufficient
- Considering DirectClient patterns already in AFD
- Addressing offline/local-first scenarios

**Problem**: Adding a cloud dependency for an "experimental" stack increases complexity and reduces portability.

**Required**: Either:
- Justify why Convex is necessary over simpler patterns
- Propose a file-first approach with optional Convex sync
- Reference how this aligns with research's "files as universal abstraction" pattern

### 4. Security Model Undefined

The proposal mentions "Code execution security - Agent-written code needs sandboxing" as a risk but provides no mitigation.

**Problem**: Workflow-as-code means agents write Python that gets executed. Without a security model, this is a critical vulnerability.

**Required**: Define the sandboxing approach:
- What sandbox technology? (subprocess, containers, WebAssembly)
- What permissions are allowed/denied?
- How are file system and network access controlled?

---

## SUGGESTIONS

Improvements that would strengthen the proposal.

### 1. Leverage Existing AFD Patterns

The proposal creates new patterns when AFD already has solutions:

| Proposal | Existing AFD |
|----------|--------------|
| `lushx.agent.spawn()` | DirectClient for in-process execution |
| Single entry point | MCP server with command discovery |
| Convex state | CommandResult with persistence layer |

**Suggestion**: Show how lushx extends AFD rather than replacing it. Map new concepts to existing primitives.

### 2. Add CommandResult Examples Throughout

The proposal shows function signatures but not return values. Add examples showing proper CommandResult structure:

```python
async def feature_workflow(issue: str) -> CommandResult[FeatureResult]:
    work = await lushx.work.start(issue)
    if not work.success:
        return failure({
            "code": "WORK_START_FAILED",
            "message": work.error.message,
            "suggestion": "Check if issue exists and is assignable"
        })
    return success(
        data={"work_id": work.data.id, "feature": work.data.feature_name},
        reasoning="Started feature work from issue, created spec, validated lint"
    )
```

### 3. Define Progressive Disclosure Strategy

The research document emphasizes progressive disclosure (85% token reduction at Anthropic), but the proposal's folder structure is underdeveloped.

**Suggestion**: Expand the `.lushx/` structure:
```
.lushx/
  ENTRY.md              # 10-line overview, always in context
  workflows/
    feature/
      README.md         # Quick description
      workflow.py       # Full implementation
      schema.json       # Input/output schema
  commands/
    work-start.md       # Command reference (loaded on grep)
```

### 4. Strengthen Testing Section

The testing strategy mentions "pytest" and "JTBD" but lacks specifics on:
- How workflow tests validate CommandResult structure
- Mock patterns for external dependencies
- CI integration approach

**Suggestion**: Add concrete test example:
```python
async def test_feature_workflow_returns_command_result():
    result = await feature_workflow("test-issue")
    assert result.success is True
    assert "reasoning" in result
    assert result.data.pr_created
```

### 5. Clarify Relationship to Existing Lushbot

The proposal mentions "parallel maintenance" as a risk but doesn't define:
- What gets migrated vs. what stays in lushbot?
- What's the graduation criteria for patterns?
- Is lushx a fork or a dependent package?

**Suggestion**: Add a "Migration Strategy" section with clear decision points.

### 6. Map Visualization Tool to AFD Commands

`lushx map` is described as a CLI command generating browser visualization. This should follow command-first:

```python
@mcp.tool()
async def map_generate(format: Literal["html", "json"] = "html") -> CommandResult[MapData]:
    """Generate workflow visualization from code analysis."""
    ...
```

Then `lushx map` becomes a CLI wrapper, and agents can call `map-generate` programmatically.

---

## OUT OF SCOPE

Items noted but not blocking this review.

### 1. Phase 3-4 Features (IDE-Lite, Full Agentic IDE)

These are speculative and don't affect Phase 1-2 approval. Review when those phases are proposed.

### 2. Specific Tauri vs. Electron Decision

The choice of desktop framework is implementation detail. Either works for the architecture.

### 3. Cost Estimates Accuracy

Hour estimates (15-25h for Phase 1) are reasonable for experimental work. Actual variance is expected.

### 4. Research Document Deep Dive

The research at `docs/research/tool-scale-analysis.md` is well-structured. Specific claims (98.7% token reduction, etc.) are attributed but not independently verified. Acceptable for proposal stage.

### 5. Success Metrics Validation

Targets like ">90% workflow completion rate" need baseline measurement infrastructure. This should be addressed in spec.md, not proposal.

---

## Summary

This proposal addresses real problems (context amnesia, fragile orchestration, discovery gaps) with patterns aligned to industry research. However, it needs to be reframed in AFD terms:

1. **Define commands first** before describing orchestration or UI
2. **Justify new dependencies** (Convex) against existing patterns (DirectClient, files)
3. **Add security model** for code execution
4. **Show CommandResult patterns** throughout

Once these blockers are addressed, the proposal can proceed to active status with spec development.

---

*Reviewed using `.claude/skills/pr-review/SKILL.md` guidelines*
