// Fuzzy matching for "did you mean" suggestions (packages/core/src/similarity.ts).
//
// Lengths and edit distances count UTF-16 code units, as JavaScript strings do, so results match
// TypeScript for any input. Case folding is ASCII-only: command names are ASCII, and folding
// non-ASCII letters could only change a distance to an ASCII name in rare cases.
#pragma once

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace afd {

/// Names longer than this (in UTF-16 code units) get no suggestions and are truncated when
/// echoed. Bounds the cost of matching an untrusted name.
inline constexpr std::size_t max_similarity_input_length = 128;

/// `1 - levenshtein(a, b) / max(len(a), len(b))`, case-insensitive; 1 for equal strings.
double calculate_similarity(std::string_view a, std::string_view b);

/// Up to `max_suggestions` names from `available_tools` with similarity >= 0.4 to
/// `requested_tool`, most similar first; ties keep their order in `available_tools`.
std::vector<std::string> find_similar_tools(std::string_view requested_tool,
                                            const std::vector<std::string>& available_tools,
                                            std::size_t max_suggestions = 3);

/// `name` cut to `max_length` UTF-16 code units plus "…", never splitting a character. Names
/// that fit are returned unchanged.
std::string truncate_name(std::string_view name,
                          std::size_t max_length = max_similarity_input_length);

} // namespace afd
