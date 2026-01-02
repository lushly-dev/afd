# Todo Backend - TypeScript

TypeScript implementation of the Todo API.

## Quick Start

```bash
pnpm install
pnpm start
```

Server runs at `http://localhost:3100`.

## Commands

| Command            | Type     | Description               |
| ------------------ | -------- | ------------------------- |
| `todo.create`      | mutation | Create a new todo         |
| `todo.list`        | query    | List todos with filtering |
| `todo.get`         | query    | Get a single todo by ID   |
| `todo.update`      | mutation | Update todo fields        |
| `todo.toggle`      | mutation | Toggle completion status  |
| `todo.delete`      | mutation | Delete a todo             |
| `todo.clear`       | mutation | Clear all completed todos |
| `todo.stats`       | query    | Get todo statistics       |
| `todo.createBatch` | mutation | Create multiple todos     |
| `todo.deleteBatch` | mutation | Delete multiple todos     |
| `todo.toggleBatch` | mutation | Toggle multiple todos     |

## Conformance

Run conformance tests:

```bash
BACKEND_URL=http://localhost:3100 pnpm example:todo:test
```
