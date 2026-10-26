#include "afd/command.hpp"

namespace afd {

ExposeOptions default_expose() noexcept {
    return ExposeOptions{};
}

bool is_exposed_to(const ExposeOptions& expose, Interface surface) noexcept {
    switch (surface) {
    case Interface::palette:
        return expose.palette;
    case Interface::mcp:
        return expose.mcp;
    case Interface::agent:
        return expose.agent;
    case Interface::cli:
        return expose.cli;
    }
    return false;
}

namespace {

bool is_lower(char c) {
    return c >= 'a' && c <= 'z';
}

bool is_digit(char c) {
    return c >= '0' && c <= '9';
}

// ^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$, without std::regex.
bool is_kebab_case(std::string_view name) {
    std::size_t segments = 0;
    std::size_t i = 0;
    while (true) {
        if (i >= name.size() || !is_lower(name[i])) {
            return false;
        }
        ++i;
        while (i < name.size() && (is_lower(name[i]) || is_digit(name[i]))) {
            ++i;
        }
        ++segments;
        if (i == name.size()) {
            return segments >= 2;
        }
        if (name[i] != '-') {
            return false;
        }
        ++i;
    }
}

} // namespace

CommandNameCheck validate_command_name(std::string_view name) {
    if (name.empty()) {
        return {.valid = false, .reason = "Command name must not be empty"};
    }
    if (!is_kebab_case(name)) {
        const std::string quoted = "'" + std::string(name) + "'";
        return {.valid = false,
                .reason = "Command name " + quoted +
                          " must use kebab-case with at least two segments (e.g., "
                          "'domain-action'). Got " +
                          quoted + "."};
    }
    return {.valid = true, .reason = std::nullopt};
}

CommandContext with_context_defaults(CommandContext context, const ContextDefaults& defaults) {
    // New system sources rather than shared ones: afd-cpp keeps no global mutable state. The
    // registry always passes its own, so this costs nothing on the execute path.
    if (!context.clock) {
        context.clock = defaults.clock ? defaults.clock : std::make_shared<SystemClock>();
    }
    if (!context.random) {
        context.random = defaults.random ? defaults.random : std::make_shared<SystemRandom>();
    }
    if (!context.actor) {
        context.actor = defaults.actor;
    }
    return context;
}

std::optional<ApprovalMode> approval_mode(const std::optional<ApprovalPolicy>& policy) noexcept {
    if (!policy) {
        return std::nullopt;
    }
    if (const auto* decision = std::get_if<ApprovalDecision>(&*policy)) {
        return *decision == ApprovalDecision::required ? ApprovalMode::required
                                                       : ApprovalMode::not_required;
    }
    return ApprovalMode::conditional;
}

std::string_view approval_mode_name(ApprovalMode mode) noexcept {
    switch (mode) {
    case ApprovalMode::not_required:
        return "not-required";
    case ApprovalMode::required:
        return "required";
    case ApprovalMode::conditional:
        return "conditional";
    }
    return "conditional";
}

} // namespace afd
