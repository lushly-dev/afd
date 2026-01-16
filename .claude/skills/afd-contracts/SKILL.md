---
name: afd-contracts
description: >
  TypeSpec-based contract system for multi-layer API schema sync. Prevents
  cross-layer schema drift between Python, TypeScript, and Convex. Use when
  building apps with multiple codebases that share types.
version: "1.0.0"
category: patterns
triggers:
  - contracts
  - TypeSpec
  - schema drift
  - API types
  - cross-layer
  - Pydantic
  - OpenAPI
---

# AFD Contracts: TypeSpec Schema Sync

Pattern for preventing cross-layer schema drift using TypeSpec as single source of truth.

## When to Use

- App has **2+ codebases** sharing types (e.g., Python backend + TypeScript frontend)
- You've hit **schema drift bugs** like `loraId: null` not being accepted
- You want **compile-time guarantees** that types match

## The Problem: Hazard #129

```
Frontend (JS)  →  sends { loraId: null }
                        ↓
Backend (Python)  →  expects (loraId: str | None)  ← Different validator!
                        ↓
Convex (TS)     →  v.optional(v.id("loras"))     ← Yet another!
```

Each layer defines schemas separately. When they drift, you get runtime errors.

## The Solution: TypeSpec Contract System

```
contracts/models/*.tsp     ← Single source of truth
        │
        ├──► OpenAPI spec     (documentation)
        ├──► TypeScript types (frontend)
        └──► Python Pydantic  (backend)
```

## Setup

### 1. Install Dependencies
```bash
npm install -D @typespec/compiler @typespec/openapi3 @typespec/http @typespec/rest
npm install -D openapi-typescript
pip install datamodel-code-generator
```

### 2. Create Directory Structure
```
contracts/
├── main.tsp              # Entry point
├── models/
│   ├── common.tsp        # Shared types (IDs, timestamps)
│   └── <domain>.tsp      # Domain models
└── generated/
    ├── openapi.yaml      # Generated docs
    ├── types.ts          # Generated TS types
    └── python/           # Generated Pydantic models
```

### 3. Add npm Scripts
```json
{
  "scripts": {
    "contracts:compile": "tsp compile contracts/main.tsp",
    "contracts:types": "openapi-typescript contracts/contracts/generated/openapi.yaml -o contracts/generated/types.ts",
    "contracts:python": "datamodel-codegen --input contracts/contracts/generated/openapi.yaml --output contracts/generated/python --output-model-type pydantic_v2.BaseModel",
    "contracts:generate": "npm run contracts:compile && npm run contracts:types && npm run contracts:python",
    "contracts:check": "npm run contracts:generate && git diff --exit-code contracts/generated/"
  }
}
```

## TypeSpec Syntax Quick Reference

```typespec
// Define a model
model AssetType {
  @doc("Convex document ID")
  _id: ConvexId;
  
  @doc("Optional LoRA - null means none")
  loraId?: ConvexId | null;  // ← Nullable optional field
  
  isActive: boolean;
}

// Enums
enum LoraStatus {
  created,
  training,
  completed,
  failed,
}

// Escape reserved keywords with backticks
model Job {
  `model`: string;  // 'model' is reserved
}
```

## CI Integration

### Pre-commit Hook (.husky/pre-commit)
```bash
#!/bin/sh
TSP_CHANGED=$(git diff --cached --name-only | grep '\.tsp$' || true)
if [ -n "$TSP_CHANGED" ]; then
    npm run contracts:generate
    git add contracts/generated/
fi
```

### GitHub Action
```yaml
- name: Check contracts
  run: |
    npm run contracts:generate
    if [ -n "$(git status --porcelain contracts/generated/)" ]; then
      echo "❌ Contracts out of sync"
      exit 1
    fi
```

## lushbot Integration

```bash
# Check for stale contracts
lush dev action=afd-lint

# Scaffold new TypeSpec setup
lush scaffold typespec
```

## Reference Implementation

See [Noisett](../../../noisett/contracts/) for a working implementation with:
- AssetType, LoRA, Job, Generation models
- Full codegen pipeline
- CI validation
