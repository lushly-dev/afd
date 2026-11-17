// The todo registry the server serves: the commands and, unless `APPROVALS=off`, the approval hold
// on todo-clear, as the TypeScript backend's src/server-options.ts assembles its server.
#pragma once

#include <memory>
#include <optional>
#include <string>

#include "store.hpp"
#include <afd/expected.hpp>
#include <afd/registry.hpp>

namespace todo {

/// Whether calls are held for approval (`APPROVALS`).
enum class Approvals {
    /// Hold todo-clear for any caller that is not a person (the default).
    agents,
    /// Hold nothing. The shared conformance suites run so, as they set `CONFIRMATIONS`.
    off
};

/// `APPROVALS`: unset or `agents`, or `off`, exactly, as TypeScript reads it.
afd::Expected<Approvals> approvals_from(const char* value);

/// The key that signs approval tokens: `TODO_APPROVAL_SECRET` (at least 32 bytes) when set, so
/// several processes accept each other's tokens; else 32 random bytes for this process.
afd::Expected<std::string> approval_secret(const char* value);

struct RegistryOptions {
    Approvals approvals = Approvals::agents;
    /// The approval key; unused with `Approvals::off`.
    std::string secret;
    /// The registry's clock. Default: a `SystemClock`.
    std::shared_ptr<const afd::Clock> clock;
    /// The registry's random. Default: a `SystemRandom`.
    std::shared_ptr<afd::RandomSource> random;
};

/// The todo commands over `store` and, with `Approvals::agents`, the approval middleware signing
/// with `options.secret`. A held todo-clear asks the person behind an MCP client that declares
/// form elicitation (`ApprovalRelay::mcp_elicitation`), with a summary of what would go; any
/// other caller gets `APPROVAL_REQUIRED`. The middleware runs before each handler, so a held call
/// never reaches the change history.
afd::Expected<std::unique_ptr<afd::CommandRegistry>>
make_registry(const std::shared_ptr<TodoStore>& store, RegistryOptions options);

} // namespace todo
