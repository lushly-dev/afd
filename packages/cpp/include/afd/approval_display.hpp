// The approval display rules (spec/approvals.md, "Approval display"): what a person must be able
// to read in full before approving an action.
//
// An approver, or any surface that shows a person a held call, shows the call's validated input
// only when `approval_display` accepts it, and otherwise shows none of it and offers no approval:
// a person cannot approve what they cannot see, and truncating is not showing.
//
// The same rules as TypeScript's `approvalDisplay` in `@lushly-dev/afd-core` and Rust's
// `approval_display`: lengths count UTF-16 code units and keys are visited in canonical order, so
// every language gives the same verdict (`spec/vectors/approver-client.json`, `display`).
#pragma once

#include "afd/expected.hpp"
#include "afd/json.hpp"

#include <cstddef>
#include <cstdint>
#include <string_view>

namespace afd {

/// The limits of `approval_display`. Lengths count UTF-16 code units.
struct ApprovalDisplayLimits {
    /// The input's canonical JSON.
    std::size_t max_serialized_length = 8000;
    /// One string value.
    std::size_t max_string_length = 2000;
    /// One object key.
    std::size_t max_key_length = 200;
    /// Nesting: the input is at depth 0, its members and items at 1.
    std::size_t max_depth = 6;
    /// Values visited, the input itself included.
    std::size_t max_values = 400;
};

/// The limits the approval display rules apply.
inline constexpr ApprovalDisplayLimits approval_display_limits{};

/// Why `approval_display` refused an input, in the order the checks run.
enum class ApprovalDisplayRefusal {
    /// Approvals' canonical JSON does not accept it (an integer a 64-bit float cannot hold, a
    /// non-finite float, invalid UTF-8, binary or discarded value, or nesting past 256).
    not_json,
    /// Its canonical JSON is longer than 8000 UTF-16 code units.
    too_long,
    /// More than 400 values.
    too_many_values,
    /// A value deeper than 6.
    too_deep,
    /// A string longer than 2000 UTF-16 code units.
    string_too_long,
    /// An object key longer than 200 UTF-16 code units.
    key_too_long,
    /// A string or key that hides characters (`hides_characters`).
    hidden_characters
};

/// The wire name of `refusal` in the spec and vectors, e.g. `too-deep`.
std::string_view approval_display_refusal_name(ApprovalDisplayRefusal refusal) noexcept;

/// The verdict of `approval_display`: the input to show, or why not.
using ApprovalDisplay = Expected<Json, ApprovalDisplayRefusal>;

/// Whether one code point makes what a person reads differ from what runs, or draws nothing:
/// controls other than tab and line feed, the soft hyphen, bidirectional marks, embeddings,
/// overrides and isolates, zero-width characters, line and paragraph separators, invisible
/// operators, blank look-alikes, variation selectors other than U+FE0E and U+FE0F, the byte order
/// mark, interlinear annotations, format controls, tags and reserved ignorables, and surrogates.
bool is_hidden_code_point(std::uint32_t code) noexcept;

/// Whether `text` holds a hidden code point (`is_hidden_code_point`) or a run of six or more
/// combining marks (Unicode general category M), which draw over the lines around them.
bool hides_characters(std::string_view text) noexcept;

/// Whether a person can be shown `input` in full before approving it, and if so the input.
/// The checks, in order: approvals' canonical JSON accepts it; that JSON is at most 8000 UTF-16
/// code units; then, depth first through keys in canonical UTF-16 code-unit order, each value is
/// at most the 400th visited and at depth 6 or less, each string at most 2000 code units and each
/// key at most 200, and none hides characters. The first failure is the refusal.
ApprovalDisplay approval_display(const Json& input);

} // namespace afd
