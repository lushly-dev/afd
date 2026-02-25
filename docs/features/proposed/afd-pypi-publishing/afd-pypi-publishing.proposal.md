# AFD Python Package - PyPI Publishing

Status: Proposed  
Created: 2026-01-13  
Updated: 2026-02-24

## Summary

Publish the existing Python package from `python/` to PyPI so Python projects can install it via `pip` without local path wiring.

## Problem

Current Python consumers must vendor or path-link the package. This slows onboarding and increases version drift risk.

## Scope

In scope:
- First public package release to PyPI.
- Build, metadata, and publish automation baseline.
- Install/import verification in a clean environment.

Out of scope:
- Feature changes to runtime APIs.
- Non-PyPI distribution channels.

## Requirements

- The package MUST build reproducibly from `python/` using standard Python build tooling.
- The package MUST publish to PyPI under an approved name.
- The package MUST include typing metadata and pass import smoke tests after install.
- Release workflow SHOULD support token-based publish in CI.
- Documentation SHOULD include installation and version pinning guidance.

## Architecture / Dataflow

1. Source in `python/src` is built into wheel and sdist.
2. Artifacts are uploaded to PyPI.
3. Consumers install from PyPI and import public APIs.
4. CI validates publish and post-install smoke tests.

## Edge Cases and Risk Handling

- Name unavailable on PyPI: choose fallback package name and document mapping.
- Publish failure after build: keep artifacts, do not retag release, retry publish only.
- Broken release detected post-publish: yank the release and publish patch increment.
- Credential leakage risk: use API token only via CI secrets; never commit credentials.

## Acceptance Criteria

- Package install succeeds in a fresh virtual environment via `pip install`.
- Core imports succeed (`CommandResult`, server bootstrap utilities).
- Version in package metadata matches release notes.
- Publish can be run non-interactively in CI with token auth.
- README contains install, upgrade, and troubleshooting sections.

## Task Breakdown

1. Validate package name and metadata.
2. Add/confirm typed package markers and build config.
3. Build wheel/sdist and run smoke tests.
4. Publish to TestPyPI, then PyPI.
5. Add CI release workflow and docs updates.
