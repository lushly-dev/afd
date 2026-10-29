# Technical Debt Management

Strategies for identifying, prioritizing, and systematically reducing technical debt through targeted refactoring.

---

## The Technical Debt Quadrant

Classifying debt by intent and awareness helps prioritize and communicate with stakeholders.

| | **Reckless** | **Prudent** |
|---|---|---|
| **Deliberate** | "We don't have time for design" -- High priority to fix; reflects poor decision-making | "We must ship now and deal with consequences" -- Acceptable if tracked; schedule paydown |
| **Inadvertent** | "What's layering?" -- Invest in team education; fix as encountered | "Now we know how we should have done it" -- Natural learning; refactor when touching the area |

### Prioritization by Quadrant

1. **Reckless-Deliberate** -- Fix immediately; these are ticking time bombs
2. **Prudent-Deliberate** -- Schedule in upcoming sprints; these are strategic trade-offs with known payoff
3. **Reckless-Inadvertent** -- Fix and educate; pair programming and code review help prevent recurrence
4. **Prudent-Inadvertent** -- Refactor opportunistically; apply the Boy Scout Rule

---

## Cost-Impact Matrix

Prioritize refactoring efforts by plotting debt items on two axes.

```
HIGH IMPACT
    |
    |  Quick Wins        Strategic
    |  (Do first)        (Plan and schedule)
    |
    +--------------------------
    |
    |  Fill-in           Ignore
    |  (Do if time)      (Not worth it)
    |
LOW IMPACT
    LOW COST            HIGH COST
```

### Scoring Framework

For each debt item, score 1-5 on:

| Factor | Weight | Description |
|--------|--------|-------------|
| **Frequency of contact** | 3x | How often developers touch this code |
| **Bug density** | 3x | Number of bugs traced to this area |
| **Change difficulty** | 2x | How hard it is to modify safely |
| **Onboarding friction** | 1x | How much it slows new team members |
| **Customer impact** | 2x | Effect on reliability, performance, or UX |

**Priority Score** = Sum of (factor score * weight)

Items with score > 30: Address in current quarter
Items with score 20-30: Schedule in roadmap
Items with score < 20: Address opportunistically

---

## The 80/20 Rule for Technical Debt

Typically, 20% of the codebase causes 80% of the problems. Focus refactoring effort on:

- **Hot spots** -- Files with the highest churn rate (frequent changes)
- **Bug magnets** -- Modules with disproportionate bug counts
- **Coupling hubs** -- Components with the most inbound/outbound dependencies
- **Complexity peaks** -- Functions or classes with the highest cyclomatic complexity

### Identifying Hot Spots

```bash
# Find files with most commits in the last 6 months (high churn)
git log --since="6 months ago" --name-only --pretty=format: | sort | uniq -c | sort -rn | head -20

# Find files involved in bug-fix commits
git log --since="6 months ago" --grep="fix\|bug\|hotfix" --name-only --pretty=format: | sort | uniq -c | sort -rn | head -20

# Combine churn with complexity for hotspot analysis
# Use tools like CodeScene, SonarQube, or custom scripts
```

---

## Budget Allocation

### The 15-20% Rule

Allocate 15-20% of engineering capacity to technical debt reduction. This can take several forms:

| Strategy | Description | Best For |
|----------|-------------|----------|
| **Dedicated sprint time** | Reserve 20% of sprint capacity for debt | Predictable cadence |
| **Debt sprints** | Full sprint every 5th sprint focused on debt | Concentrated effort |
| **Boy Scout Rule** | Leave code cleaner than you found it | Small, continuous improvement |
| **Tech Debt Fridays** | One day per week for debt work | Cultural habit building |
| **Refactoring stories** | Mix debt tickets into regular backlog | Stakeholder visibility |

### Tracking Debt

Maintain a living debt register:

```markdown
| ID | Area | Description | Quadrant | Impact Score | Estimated Effort | Status |
|----|------|-------------|----------|-------------|-----------------|--------|
| TD-001 | Auth | Hardcoded session timeout | Reckless-Deliberate | 35 | 2h | Planned |
| TD-002 | API | No input validation on /users | Reckless-Deliberate | 42 | 4h | In Progress |
| TD-003 | DB | N+1 queries in reports | Prudent-Deliberate | 28 | 8h | Backlog |
| TD-004 | UI | Duplicated form logic | Prudent-Inadvertent | 18 | 3h | Opportunistic |
```

---

## Refactoring Strategies by Debt Type

### Code Duplication Debt

- **Detection:** Use static analysis tools (SonarQube, jsinspect, PMD CPD)
- **Strategy:** Extract shared functions, create utility modules, introduce shared components
- **Agentic approach:** Agent can detect duplication patterns and suggest consolidation, but human should approve the shared abstraction boundary

### Dependency Debt

- **Detection:** Outdated dependencies, security vulnerabilities, unsupported libraries
- **Strategy:** Regular dependency audits, automated update tools (Dependabot, Renovate)
- **Agentic approach:** Agent can identify outdated dependencies and draft update PRs, but breaking changes require human review

### Architecture Debt

- **Detection:** God classes, circular dependencies, layer violations
- **Strategy:** Strangler fig, branch by abstraction, incremental decomposition
- **Agentic approach:** Agent can propose decomposition plans and implement individual steps, but architectural decisions need human sign-off

### Test Debt

- **Detection:** Low coverage, flaky tests, missing integration tests
- **Strategy:** Add characterization tests before refactoring, fix flaky tests first, increase coverage incrementally
- **Agentic approach:** Agent can generate characterization tests to capture current behavior before refactoring begins

### Documentation Debt

- **Detection:** Outdated docs, missing API docs, stale comments
- **Strategy:** Doc-as-you-go, auto-generate API docs, remove stale comments
- **Agentic approach:** Agent can update docs and comments as part of refactoring PRs

---

## Communicating Debt to Stakeholders

### Framing for Business Audiences

Avoid technical jargon. Frame debt in terms stakeholders understand:

| Technical Framing | Business Framing |
|-------------------|------------------|
| "We need to refactor the auth module" | "We can reduce security incident response time by 60%" |
| "Our test coverage is low" | "Each release requires 3 extra days of manual QA" |
| "The codebase has high coupling" | "Adding a new payment method takes 4 weeks instead of 1" |
| "We have duplicated logic" | "Bug fixes need to be applied in 5 places, and we miss some" |

### Metrics That Matter

- **Lead time** -- How long from code commit to production deploy
- **Change failure rate** -- Percentage of deployments causing incidents
- **Bug escape rate** -- Bugs found in production vs. caught in dev/QA
- **Developer velocity** -- Story points or throughput over time
- **Time to onboard** -- How long until new developers are productive

---

## Preventing New Debt

### Guardrails

- **Linting rules** -- Enforce coding standards automatically
- **Complexity budgets** -- Fail CI if cyclomatic complexity exceeds threshold
- **Bundle size budgets** -- Catch oversized dependencies before merge
- **Architecture fitness functions** -- Automated checks for dependency rules, layer violations
- **Code review standards** -- Established review checklist that includes debt assessment

### Agentic Prevention

- Configure agents to flag potential debt introduction in PRs
- Use agent-powered pre-commit checks for complexity, duplication, and naming
- Agent should suggest the debt-free approach first, then offer the shortcut only if time-constrained with a tracking ticket
