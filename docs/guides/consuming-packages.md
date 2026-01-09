# Consuming AFD Packages

AFD packages are published to GitHub Packages under the `@lushly-dev` scope.

## Setup (One-time)

### 1. Create Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Create a token with `read:packages` scope
3. Save the token securely

### 2. Configure npm to use GitHub Packages

Create or edit `~/.npmrc` (global) or `.npmrc` (project root):

```ini
@lushly-dev:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

> ⚠️ Never commit tokens to git. For CI, use `NODE_AUTH_TOKEN` secret.

## Install Packages

```bash
# Install what you need
npm install @lushly-dev/afd-core
npm install @lushly-dev/afd-client
npm install @lushly-dev/afd-server
npm install @lushly-dev/afd-testing
```

## Usage

```typescript
import { success, failure, type CommandResult } from '@lushly-dev/afd-core';
import { defineCommand, createMcpServer } from '@lushly-dev/afd-server';
import { DirectClient } from '@lushly-dev/afd-client';
```

## CI/CD Setup

In GitHub Actions, authenticate using the built-in `GITHUB_TOKEN`:

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    registry-url: 'https://npm.pkg.github.com'
    scope: '@lushly-dev'

- name: Install dependencies
  run: npm ci
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Available Packages

| Package | Description |
|---------|-------------|
| `@lushly-dev/afd-core` | Core types (CommandResult, errors) |
| `@lushly-dev/afd-client` | MCP client + DirectClient |
| `@lushly-dev/afd-server` | Zod-based MCP server factory |
| `@lushly-dev/afd-testing` | JTBD testing utilities |
