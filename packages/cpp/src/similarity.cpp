#include "afd/similarity.hpp"

#include <algorithm>
#include <cstdint>
#include <utility>

namespace afd {
namespace {

constexpr double min_suggestion_similarity = 0.4;

struct DecodedChar {
    char32_t code_point;
    std::size_t byte_length;
};

// Decodes one UTF-8 sequence at `text[i]`. Invalid bytes decode to U+FFFD, one byte at a time.
DecodedChar decode(std::string_view text, std::size_t i) {
    const auto byte = [&](std::size_t k) { return static_cast<unsigned char>(text[k]); };
    const unsigned char lead = byte(i);
    if (lead < 0x80) {
        return {lead, 1};
    }
    std::size_t length = 0;
    char32_t code_point = 0;
    char32_t minimum = 0;
    if ((lead & 0xE0) == 0xC0) {
        length = 2;
        code_point = lead & 0x1Fu;
        minimum = 0x80;
    } else if ((lead & 0xF0) == 0xE0) {
        length = 3;
        code_point = lead & 0x0Fu;
        minimum = 0x800;
    } else if ((lead & 0xF8) == 0xF0) {
        length = 4;
        code_point = lead & 0x07u;
        minimum = 0x10000;
    } else {
        return {0xFFFD, 1};
    }
    if (i + length > text.size()) {
        return {0xFFFD, 1};
    }
    for (std::size_t k = 1; k < length; ++k) {
        if ((byte(i + k) & 0xC0) != 0x80) {
            return {0xFFFD, 1};
        }
        code_point = (code_point << 6) | (byte(i + k) & 0x3Fu);
    }
    if (code_point < minimum || code_point > 0x10FFFF ||
        (code_point >= 0xD800 && code_point <= 0xDFFF)) {
        return {0xFFFD, 1};
    }
    return {code_point, length};
}

std::size_t utf16_units(char32_t code_point) {
    return code_point >= 0x10000 ? 2 : 1;
}

// `text` as UTF-16 code units, with ASCII letters lowercased.
std::u16string lowered_utf16(std::string_view text) {
    std::u16string units;
    units.reserve(text.size());
    for (std::size_t i = 0; i < text.size();) {
        const DecodedChar decoded = decode(text, i);
        i += decoded.byte_length;
        char32_t c = decoded.code_point;
        if (c >= U'A' && c <= U'Z') {
            c = c - U'A' + U'a';
        }
        if (c >= 0x10000) {
            const char32_t offset = c - 0x10000;
            units.push_back(static_cast<char16_t>(0xD800 + (offset >> 10)));
            units.push_back(static_cast<char16_t>(0xDC00 + (offset & 0x3FF)));
        } else {
            units.push_back(static_cast<char16_t>(c));
        }
    }
    return units;
}

std::size_t utf16_length(std::string_view text) {
    std::size_t length = 0;
    for (std::size_t i = 0; i < text.size();) {
        const DecodedChar decoded = decode(text, i);
        i += decoded.byte_length;
        length += utf16_units(decoded.code_point);
    }
    return length;
}

// Two-row Levenshtein distance, keeping the shorter string on the inner loop.
std::size_t levenshtein(const std::u16string& a, const std::u16string& b) {
    const std::u16string& outer = a.size() >= b.size() ? a : b;
    const std::u16string& inner = a.size() >= b.size() ? b : a;
    std::vector<std::size_t> previous(inner.size() + 1);
    std::vector<std::size_t> current(inner.size() + 1);
    for (std::size_t j = 0; j <= inner.size(); ++j) {
        previous[j] = j;
    }
    for (std::size_t i = 1; i <= outer.size(); ++i) {
        current[0] = i;
        for (std::size_t j = 1; j <= inner.size(); ++j) {
            const std::size_t cost = outer[i - 1] == inner[j - 1] ? 0 : 1;
            current[j] = (std::min)({previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost});
        }
        std::swap(previous, current);
    }
    return previous[inner.size()];
}

double lowered_similarity(const std::u16string& a, const std::u16string& b) {
    if (a == b) {
        return 1;
    }
    const std::size_t max_length = (std::max)(a.size(), b.size());
    return 1 - static_cast<double>(levenshtein(a, b)) / static_cast<double>(max_length);
}

} // namespace

double calculate_similarity(std::string_view a, std::string_view b) {
    return lowered_similarity(lowered_utf16(a), lowered_utf16(b));
}

std::vector<std::string> find_similar_tools(std::string_view requested_tool,
                                            const std::vector<std::string>& available_tools,
                                            std::size_t max_suggestions) {
    if (utf16_length(requested_tool) > max_similarity_input_length) {
        return {};
    }
    const std::u16string requested = lowered_utf16(requested_tool);

    struct Match {
        const std::string* tool;
        double similarity;
    };
    std::vector<Match> matches;
    for (const std::string& tool : available_tools) {
        const std::u16string candidate = lowered_utf16(tool);
        // Length pre-filter: distance >= the length difference, so no candidate can score above
        // 1 - lengthDiff / maxLen. Same floating-point expression as the score, as in TypeScript.
        const std::size_t max_length = (std::max)(requested.size(), candidate.size());
        const std::size_t length_diff = requested.size() > candidate.size()
                                            ? requested.size() - candidate.size()
                                            : candidate.size() - requested.size();
        if (max_length > 0 &&
            1 - static_cast<double>(length_diff) / static_cast<double>(max_length) <
                min_suggestion_similarity) {
            continue;
        }
        const double similarity = lowered_similarity(requested, candidate);
        if (similarity >= min_suggestion_similarity) {
            matches.push_back({&tool, similarity});
        }
    }

    // JavaScript's sort is stable, so ties keep their registration order.
    std::stable_sort(matches.begin(), matches.end(),
                     [](const Match& x, const Match& y) { return x.similarity > y.similarity; });
    std::vector<std::string> result;
    for (std::size_t i = 0; i < matches.size() && i < max_suggestions; ++i) {
        result.push_back(*matches[i].tool);
    }
    return result;
}

std::string truncate_name(std::string_view name, std::size_t max_length) {
    if (utf16_length(name) <= max_length) {
        return std::string(name);
    }
    // Keep whole characters while they fit. A character needing two code units that would
    // straddle the cut is dropped, as TypeScript drops a trailing high surrogate.
    std::size_t units = 0;
    std::size_t end = 0;
    while (end < name.size()) {
        const DecodedChar decoded = decode(name, end);
        if (units + utf16_units(decoded.code_point) > max_length) {
            break;
        }
        units += utf16_units(decoded.code_point);
        end += decoded.byte_length;
    }
    return std::string(name.substr(0, end)) + "…";
}

} // namespace afd
