# Feature Proposal: Plugin Discovery via Entry Points

## 1. Summary
Implement plugin discovery via package metadata entry points, allowing third-party packages to contribute commands without modifying the host application.

## 2. Motivation
Currently, commands are registered explicitly via arrays passed to `createMcpServer`. Adding a command requires updating the registration site. As the ecosystem grows, a zero-config plugin model where installing a package automatically makes its commands available becomes desirable.

## 3. Proposed Solution
- Define a plugin protocol with two responsibilities: (1) register commands into a shared registry, and (2) optionally declare a config schema for validation.
- Update the server factory to discover command packages at startup via a declared entry point group.
- Walk discovered plugins, call their registration functions, and build the namespace.
- Support both explicit registration (primary) and discovery (opt-in) to maintain debuggability.

*Note: This feature is deferred until command sets exceed what explicit registration can comfortably manage (e.g., 50+ commands from multiple packages).*

## 4. Breaking Changes
**Low.** The key contract `McpServerOptions.commands: ZodCommandDefinition[]` remains. Plugin discovery adds an alternative way to build that array. As long as explicit registration is supported and discovery doesn't silently overwrite explicit commands, the risk is low.

## 5. Alternatives Considered
- Sticking exclusively to explicit registration. This is safer and easier to debug but limits ecosystem extensibility in the long run.

## 6. Specification
See [plugin-discovery.spec.md](./plugin-discovery.spec.md) for full design.
