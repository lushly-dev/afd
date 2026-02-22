# Feature Proposal: Semantic Quality Validation

> **Spec:** [semantic-quality-validation.spec.md](./semantic-quality-validation.spec.md)

## 1. Summary
Introduce a semantic quality validation pass for the AFD command registry to detect duplicate descriptions, ambiguous naming, and conflicting tools. This acts as the "Honesty Check" applied to the command registry itself.

## 2. Motivation
Currently, AFD validates input schemas at runtime (Zod/Pydantic) but does not validate the command surface itself for quality. As command sets grow, agents can be confused by commands with similar descriptions or overlapping schemas. Validating the quality of the product surface is a natural extension of AFD's premise that commands *are* the product.

## 3. Proposed Solution
- Implement a validation pass over the assembled command set that detects:
  - Commands with descriptions similar enough to confuse an agent (using a pairwise similarity matrix with a configurable threshold, e.g., 30%).
  - Duplicate or overlapping input schemas that suggest redundant tools.
  - Descriptions that could be susceptible to prompt injection.
- Run this validation as a CI check or pre-registration hook.
- Report conflicts with actionable remediation suggestions (e.g., rename, merge, or disambiguate description).

## 4. Breaking Changes
**None.** This is a pure additive feature. It will be a new `validate` command or CI tool with no existing API changes.

## 5. Alternatives Considered
- Relying on manual review of command descriptions. This does not scale well as the number of commands grows.
