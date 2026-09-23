---
'@lushly-dev/afd-testing': patch
---

`MockMcpServer.register()` now accepts typed commands, matching `CommandRegistry.register()` in `@lushly-dev/afd-core`. Previously `server.register(createMockCommand<{ name: string }, Greeting>(...))` did not compile, because the method only took `CommandDefinition<unknown, unknown>`. Runtime behaviour is unchanged.
