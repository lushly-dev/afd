# @lushly-dev/violet-server

MCP server and local REST API for Violet Design, a hierarchical design token platform. Every Violet command is exposed as an MCP tool with the same input schema and result as the CLI.

```bash
npm install @lushly-dev/violet-server
npx violet-mcp            # MCP over stdio
```

```ts
import { createApiServer, createMcpServer, generateTools, startStdioServer } from '@lushly-dev/violet-server';
```

## License

MIT
