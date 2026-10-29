# Azure Connectors

> Proposed — Phase 2 of the connectors plan. Extends the same ConnectorBase pattern used by GitHub.

## Summary

Add typed connectors for Azure services (Azure DevOps, Azure Resource Manager, Key Vault) following the same `ConnectorBase` middleware stack, error mapping, and CommandResult patterns established in Phase 1 with the GitHub connector.

## Why This Matters

- Enterprise teams use Azure DevOps for work items, pipelines, and repos
- Agents managing cloud infrastructure need ARM (Azure Resource Manager) access
- Key Vault integration enables secure credential retrieval for other connectors
- All use the same connector pattern — no new architecture needed

## Prerequisite Specs

- Phase 1 connectors complete (done — 248 tests)
- [Agent Capability Declarations](../../complete/agent-skill-scoping/agent-skill-scoping.plan.md) — agents must declare Azure access

## Scope

Covered in existing spec: [06-azure-connectors.plan.md](../../complete/connectors/06-azure-connectors.plan.md)

## Estimated Effort

Medium — new ConnectorBase subclasses following established pattern. Auth via Azure Identity SDK (DefaultAzureCredential).
