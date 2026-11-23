// Private: dedicated YAML 1.2 Core frontmatter parser for Agent Skills (`SKILL.md`,
// `spec/mcp-resources.md`, S2). Zero external dependencies, no exceptions, no RTTI. Not installed.
#pragma once

#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <cstddef>
#include <string>
#include <string_view>

namespace afd::mcp::surface {

/// Maximum nesting depth permitted in skill frontmatter (`spec/mcp-resources.md`, S2).
inline constexpr std::size_t max_frontmatter_depth = 64;

/// Extracts and parses the YAML 1.2 Core frontmatter of `SKILL.md` (`---\n...\n---`).
/// Enforces every S2 rule: valid UTF-8, single mapping with string keys, unique keys,
/// no tags/anchors/aliases/directives, finite numbers, depth <= 64, YAML 1.2 Core scalar
/// resolution (so unquoted dates like `2026-11-01` and YAML 1.1 words like `yes`/`no` stay
/// strings).
[[nodiscard]] Expected<Json> parse_skill_frontmatter(std::string_view content);

} // namespace afd::mcp::surface
