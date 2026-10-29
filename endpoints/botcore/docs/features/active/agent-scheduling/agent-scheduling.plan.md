# Agent Scheduling

> Active planning spec — defines how botcore agents should run on a schedule locally and in cloud environments.

## Overview

If botcore agents are going to work on a user's behalf, they need a scheduling model. That model should be explicit, observable, and portable across local and cloud runtimes.

This spec evaluates whether botcore should:
- delegate scheduling to external systems like cron
- embed a scheduler in the runtime
- support both through a stable job/schedule model

## Status

| Field | Value |
|---|---|
| Status | Active |
| Author | AI-assisted |
| Date | 2026-03-21 |
| Last reviewed | 2026-10-01 |
| Priority | Platform Planning |

## Goals

- Schedule agent jobs locally or in cloud deployments
- Support headless execution
- Preserve a clear audit trail of what ran and why
- Work cleanly with botcore state persistence and AFD-based surfaces

## Non-Goals

- Replacing enterprise workflow engines
- Building a full calendar product
- Supporting arbitrarily complex DAG scheduling in the first phase

## Core Decision

Should botcore own scheduling semantics, execution, both, or neither?

## Options

### Option A — External Scheduler Only

Use cron/launchd/systemd timers/Task Scheduler or cloud-native schedulers to invoke botcore commands.

**Pros**
- Extremely simple
- Good local and cloud portability
- Leverages mature system tooling

**Cons**
- Weak job visibility inside botcore
- Harder overlap/retry semantics
- Fragmented user experience across platforms

### Option B — In-Process Scheduler

The persistent botcore runtime owns schedule evaluation and job dispatch.

**Pros**
- Consistent semantics across platforms
- Easier to expose in CLI and AFD UI
- Stronger observability and run history

**Cons**
- Runtime must always be up
- More moving parts in the gateway
- Need leader/lock strategy in cloud scenarios

### Option C — Hybrid Model

Botcore owns the **schedule model** and job semantics, but can execute them either:
- via a built-in runtime scheduler
- or through external schedulers that call into the same commands

**Pros**
- Best long-term flexibility
- Supports local and cloud well
- Avoids tying product semantics to one deployment pattern

**Cons**
- Slightly more upfront design work

## Recommendation

Prefer **Option C**:

- Botcore should define a first-class **scheduled job model**
- The local persistent gateway should support an embedded scheduler
- Cloud deployments should also be able to trigger the same jobs from platform-native schedulers

That means botcore owns:
- job identity
- schedule definition
- run history
- overlap policy
- retry policy

But does not need to insist on one execution substrate everywhere.

## Scheduling Semantics To Standardize

- job name and description
- target agent or agent role
- prompt/task template
- schedule expression
- timezone
- overlap policy: `skip`, `queue`, `replace`, `parallel`
- retry policy
- timeout policy
- run provenance: manual vs scheduled vs delegated

## Build vs Buy

| Concern | Prefer | Why |
|---|---|---|
| Schedule expression model | Build a small botcore model | Keep semantics stable across local/cloud |
| Local schedule evaluation | Use a scheduler library | No reason to hand-roll timer management |
| Cloud triggering | Use platform-native schedulers | Better operational fit than inventing our own |

## Candidate Libraries / Approaches

### Local

- **APScheduler**
  - Pros: mature, Python-native, cron/interval/date triggers, persistent job store options
  - Cons: another runtime dependency, still requires gateway uptime

- **Simple asyncio tick loop**
  - Pros: minimal dependency surface, botcore-specific behavior
  - Cons: easy to underbuild, reinvents missed-run and persistence logic

### External / Cloud

- **cron / systemd timers / launchd / Windows Task Scheduler**
  - Pros: available, proven, low complexity
  - Cons: fragmented user setup and weak in-app visibility

- **Cloud-native cron systems**
  - Examples: managed scheduler plus HTTP/job trigger
  - Pros: ideal for hosted deployment
  - Cons: provider-specific integration work

### Probably Too Heavy Early

- **Temporal / Prefect / Airflow**
  - Powerful, but likely too much platform surface for the first botcore scheduling layer

## Decision Points

- Is cron syntax enough, or do we want a smaller botcore-specific schedule DSL?
- Do missed runs backfill, skip, or roll into the next run?
- Should scheduled tasks create normal orchestrator tasks, or a separate job type?
- Should schedule definitions live in config files, runtime state, or both?

## AFD Fit

AFD is a good fit for:
- schedule CRUD commands
- job run history commands
- operator/admin UI built on those commands

AFD is not the scheduler itself. Scheduling remains a botcore runtime concern.

## Success Criteria

- Scheduled jobs can run locally and in cloud deployments
- The same job model works headlessly and through future UIs
- Retry/overlap behavior is explicit and observable
- The first version avoids overcommitting to a heavyweight workflow engine
