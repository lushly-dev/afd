#include "mcp_stdio/frontmatter.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "detail/utf8.hpp"

namespace afd::mcp::surface {
namespace {

constexpr std::size_t max_frontmatter_bytes = std::size_t{16} << 20;

bool is_space_or_tab(char c) noexcept {
    return c == ' ' || c == '\t';
}

bool is_digit(char c) noexcept {
    return c >= '0' && c <= '9';
}

bool is_octal_digit(char c) noexcept {
    return c >= '0' && c <= '7';
}

int hex_value(char c) noexcept {
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
        return c - 'a' + 10;
    }
    if (c >= 'A' && c <= 'F') {
        return c - 'A' + 10;
    }
    return -1;
}

std::string_view trim_spaces(std::string_view text) noexcept {
    while (!text.empty() && is_space_or_tab(text.front())) {
        text.remove_prefix(1U);
    }
    while (!text.empty() && is_space_or_tab(text.back())) {
        text.remove_suffix(1U);
    }
    return text;
}

std::string_view rtrim_spaces(std::string_view text) noexcept {
    while (!text.empty() && is_space_or_tab(text.back())) {
        text.remove_suffix(1U);
    }
    return text;
}

void append_utf8(std::string& out, char32_t cp) {
    if (cp <= 0x7FU) {
        out.push_back(static_cast<char>(cp));
    } else if (cp <= 0x7FFU) {
        out.push_back(static_cast<char>(0xC0U | ((cp >> 6) & 0x1FU)));
        out.push_back(static_cast<char>(0x80U | (cp & 0x3FU)));
    } else if (cp <= 0xFFFFU) {
        out.push_back(static_cast<char>(0xE0U | ((cp >> 12) & 0x0FU)));
        out.push_back(static_cast<char>(0x80U | ((cp >> 6) & 0x3FU)));
        out.push_back(static_cast<char>(0x80U | (cp & 0x3FU)));
    } else {
        out.push_back(static_cast<char>(0xF0U | ((cp >> 18) & 0x07U)));
        out.push_back(static_cast<char>(0x80U | ((cp >> 12) & 0x3FU)));
        out.push_back(static_cast<char>(0x80U | ((cp >> 6) & 0x3FU)));
        out.push_back(static_cast<char>(0x80U | (cp & 0x3FU)));
    }
}

bool is_blank_or_comment(std::string_view line) noexcept {
    std::size_t i = 0;
    while (i < line.size() && is_space_or_tab(line[i])) {
        ++i;
    }
    return i == line.size() || line[i] == '#';
}

std::optional<std::string> forbidden_indicator_error(char c) {
    if (c == '!') {
        return std::string("YAML tags are not allowed in skill frontmatter");
    }
    if (c == '&') {
        return std::string("YAML anchors are not allowed in skill frontmatter");
    }
    if (c == '*') {
        return std::string("YAML aliases are not allowed in skill frontmatter");
    }
    if (c == '%') {
        return std::string("YAML directives are not allowed in skill frontmatter");
    }
    if (c == '@' || c == '`') {
        return std::string("reserved YAML indicator character in skill frontmatter");
    }
    return std::nullopt;
}

bool is_sequence_dash(std::string_view line, std::size_t col) noexcept {
    if (col >= line.size() || line[col] != '-') {
        return false;
    }
    return col + 1U == line.size() || is_space_or_tab(line[col + 1U]);
}

bool is_explicit_key(std::string_view line, std::size_t col) noexcept {
    if (col >= line.size() || line[col] != '?') {
        return false;
    }
    return col + 1U == line.size() || is_space_or_tab(line[col + 1U]);
}

bool is_colon_separator(std::string_view text, std::size_t pos) noexcept {
    if (pos >= text.size() || text[pos] != ':') {
        return false;
    }
    return pos + 1U == text.size() || is_space_or_tab(text[pos + 1U]);
}

/// Finds an unquoted `: ` (or `:` at end of text / before comment) in a single block line.
std::optional<std::size_t> find_block_mapping_colon(std::string_view line, std::size_t start) {
    for (std::size_t i = start; i < line.size(); ++i) {
        const char c = line[i];
        if (c == '#' && (i == start || is_space_or_tab(line[i - 1U]))) {
            return std::nullopt;
        }
        if (c == ':' && is_colon_separator(line, i)) {
            return i;
        }
    }
    return std::nullopt;
}

/// Resolves a trimmed plain (unquoted) scalar using the YAML 1.2 Core Schema (section 10.3.2).
Expected<Json> resolve_plain_scalar(std::string_view raw) {
    const std::string_view s = trim_spaces(raw);
    if (s.empty() || s == "~" || s == "null" || s == "Null" || s == "NULL") {
        return Json(nullptr);
    }
    if (auto err = forbidden_indicator_error(s.front())) {
        return unexpected(std::move(*err));
    }
    if (s == "true" || s == "True" || s == "TRUE") {
        return Json(true);
    }
    if (s == "false" || s == "False" || s == "FALSE") {
        return Json(false);
    }
    // YAML 1.2 Core non-finite floats must be refused (S2 requires finite numbers).
    if (s == ".inf" || s == ".Inf" || s == ".INF" || s == "+.inf" || s == "+.Inf" || s == "+.INF" ||
        s == "-.inf" || s == "-.Inf" || s == "-.INF" || s == ".nan" || s == ".NaN" || s == ".NAN") {
        return unexpected(std::string("non-finite numbers are not allowed in skill frontmatter"));
    }

    // Octal integer: 0o[0-7]+
    if (s.size() > 2U && s[0] == '0' && s[1] == 'o') {
        bool all_octal = true;
        for (std::size_t i = 2U; i < s.size(); ++i) {
            if (!is_octal_digit(s[i])) {
                all_octal = false;
                break;
            }
        }
        if (all_octal) {
            std::uint64_t uval = 0;
            bool overflow = false;
            for (std::size_t i = 2U; i < s.size(); ++i) {
                const auto digit = static_cast<std::uint64_t>(s[i] - '0');
                if (uval > ((std::numeric_limits<std::uint64_t>::max)() - digit) / 8U) {
                    overflow = true;
                    break;
                }
                uval = uval * 8U + digit;
            }
            if (!overflow) {
                return Json(uval);
            }
            double dval = 0.0;
            for (std::size_t i = 2U; i < s.size(); ++i) {
                dval = dval * 8.0 + static_cast<double>(s[i] - '0');
            }
            if (!std::isfinite(dval)) {
                return unexpected(
                    std::string("integer overflows finite number range in skill frontmatter"));
            }
            return Json(dval);
        }
    }

    // Hexadecimal integer: 0x[0-9a-fA-F]+
    if (s.size() > 2U && s[0] == '0' && s[1] == 'x') {
        bool all_hex = true;
        for (std::size_t i = 2U; i < s.size(); ++i) {
            if (hex_value(s[i]) < 0) {
                all_hex = false;
                break;
            }
        }
        if (all_hex) {
            std::uint64_t uval = 0;
            bool overflow = false;
            for (std::size_t i = 2U; i < s.size(); ++i) {
                const auto digit = static_cast<std::uint64_t>(hex_value(s[i]));
                if (uval > ((std::numeric_limits<std::uint64_t>::max)() - digit) / 16U) {
                    overflow = true;
                    break;
                }
                uval = uval * 16U + digit;
            }
            if (!overflow) {
                return Json(uval);
            }
            double dval = 0.0;
            for (std::size_t i = 2U; i < s.size(); ++i) {
                dval = dval * 16.0 + static_cast<double>(hex_value(s[i]));
            }
            if (!std::isfinite(dval)) {
                return unexpected(
                    std::string("integer overflows finite number range in skill frontmatter"));
            }
            return Json(dval);
        }
    }

    // Decimal integer: [-+]?[0-9]+
    {
        std::size_t idx = 0;
        const bool negative = (s[0] == '-');
        if (s[0] == '+' || s[0] == '-') {
            idx = 1U;
        }
        if (idx < s.size()) {
            bool all_digits = true;
            for (std::size_t i = idx; i < s.size(); ++i) {
                if (!is_digit(s[i])) {
                    all_digits = false;
                    break;
                }
            }
            if (all_digits) {
                const std::string_view digits = s.substr(idx);
                if (negative) {
                    std::int64_t ival = 0;
                    const auto res = std::from_chars(s.data(), s.data() + s.size(), ival);
                    if (res.ec == std::errc{} && res.ptr == s.data() + s.size()) {
                        return Json(ival);
                    }
                } else {
                    std::uint64_t uval = 0;
                    const auto res =
                        std::from_chars(digits.data(), digits.data() + digits.size(), uval);
                    if (res.ec == std::errc{} && res.ptr == digits.data() + digits.size()) {
                        if (uval <= static_cast<std::uint64_t>(
                                        (std::numeric_limits<std::int64_t>::max)())) {
                            return Json(static_cast<std::int64_t>(uval));
                        }
                        return Json(uval);
                    }
                }
                // Overflowed 64-bit integer: normalize for JSON float parsing and verify finite.
                std::size_t nz = 0;
                while (nz + 1U < digits.size() && digits[nz] == '0') {
                    ++nz;
                }
                std::string norm;
                if (negative) {
                    norm.push_back('-');
                }
                norm.append(digits.substr(nz));
                norm.append(".0");
                Json parsed = Json::parse(norm, nullptr, false);
                if (parsed.is_discarded() || !parsed.is_number() ||
                    (parsed.is_number_float() && !std::isfinite(parsed.get<double>()))) {
                    return unexpected(
                        std::string("integer overflows finite number range in skill frontmatter"));
                }
                return parsed;
            }
        }
    }

    // Decimal float: [-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?
    // Must contain '.' or 'e'/'E' (pure digits were handled above).
    {
        std::size_t i = 0;
        const bool negative = (s[0] == '-');
        if (s[0] == '+' || s[0] == '-') {
            ++i;
        }
        const std::size_t int_start = i;
        while (i < s.size() && is_digit(s[i])) {
            ++i;
        }
        const std::size_t int_end = i;
        bool has_dot = false;
        std::size_t frac_start = i;
        std::size_t frac_end = i;
        if (i < s.size() && s[i] == '.') {
            has_dot = true;
            ++i;
            frac_start = i;
            while (i < s.size() && is_digit(s[i])) {
                ++i;
            }
            frac_end = i;
        }
        const bool has_int = int_end > int_start;
        const bool has_frac = frac_end > frac_start;
        if (has_int || (has_dot && has_frac)) {
            bool has_exp = false;
            std::size_t exp_start = i;
            bool exp_ok = true;
            if (i < s.size() && (s[i] == 'e' || s[i] == 'E')) {
                has_exp = true;
                ++i;
                if (i < s.size() && (s[i] == '+' || s[i] == '-')) {
                    ++i;
                }
                const std::size_t exp_digits = i;
                while (i < s.size() && is_digit(s[i])) {
                    ++i;
                }
                exp_ok = (i > exp_digits);
            }
            if (exp_ok && i == s.size() && (has_dot || has_exp)) {
                std::string norm;
                if (negative) {
                    norm.push_back('-');
                }
                if (has_int) {
                    std::size_t nz = int_start;
                    while (nz + 1U < int_end && s[nz] == '0') {
                        ++nz;
                    }
                    norm.append(s.substr(nz, int_end - nz));
                } else {
                    norm.push_back('0');
                }
                if (has_dot) {
                    norm.push_back('.');
                    if (has_frac) {
                        norm.append(s.substr(frac_start, frac_end - frac_start));
                    } else {
                        norm.push_back('0');
                    }
                }
                if (has_exp) {
                    norm.append(s.substr(exp_start));
                }
                Json parsed = Json::parse(norm, nullptr, false);
                if (parsed.is_discarded() || !parsed.is_number() ||
                    (parsed.is_number_float() && !std::isfinite(parsed.get<double>()))) {
                    return unexpected(std::string("non-finite float in skill frontmatter"));
                }
                return parsed;
            }
        }
    }

    return Json(std::string(s));
}

class FrontmatterParser {
public:
    explicit FrontmatterParser(std::vector<std::string_view> lines) : lines_(std::move(lines)) {}

    Expected<Json> parse_document() {
        skip_blank_and_comments();
        if (eof()) {
            return unexpected(std::string("SKILL.md frontmatter must be a YAML mapping"));
        }
        const auto indent = line_indent(lines_[line_idx_]);
        if (!indent) {
            return unexpected(indent.error());
        }
        const std::string_view first = lines_[line_idx_];
        if (*indent < first.size()) {
            if (auto err = forbidden_indicator_error(first[*indent])) {
                return unexpected(std::move(*err));
            }
            if (first[*indent] == '{') {
                std::size_t col = *indent;
                auto value = parse_flow_value(col, 1U);
                if (!value) {
                    return unexpected(value.error());
                }
                if (auto err = expect_line_end(col)) {
                    return unexpected(std::move(*err));
                }
                ++line_idx_;
                skip_blank_and_comments();
                if (!eof()) {
                    return unexpected(
                        std::string("unexpected trailing content in SKILL.md frontmatter"));
                }
                if (!value->is_object()) {
                    return unexpected(std::string("SKILL.md frontmatter must be a YAML mapping"));
                }
                return value;
            }
            if (first[*indent] == '[' || is_sequence_dash(first, *indent)) {
                return unexpected(std::string("SKILL.md frontmatter must be a YAML mapping"));
            }
        }
        auto mapping = parse_block_mapping(*indent, 1U);
        if (!mapping) {
            return unexpected(mapping.error());
        }
        skip_blank_and_comments();
        if (!eof()) {
            return unexpected(std::string("unexpected trailing content in SKILL.md frontmatter"));
        }
        return mapping;
    }

private:
    std::vector<std::string_view> lines_;
    std::size_t line_idx_ = 0;

    [[nodiscard]] bool eof() const noexcept { return line_idx_ >= lines_.size(); }

    void skip_blank_and_comments() noexcept {
        while (!eof() && is_blank_or_comment(lines_[line_idx_])) {
            ++line_idx_;
        }
    }

    static Expected<std::size_t> line_indent(std::string_view line) {
        std::size_t indent = 0;
        while (indent < line.size() && line[indent] == ' ') {
            ++indent;
        }
        if (indent < line.size() && line[indent] == '\t') {
            return unexpected(std::string("tabs are not allowed for indentation in YAML"));
        }
        return indent;
    }

    std::optional<std::string> expect_line_end(std::size_t col) const {
        if (eof()) {
            return std::nullopt;
        }
        const std::string_view line = lines_[line_idx_];
        while (col < line.size() && is_space_or_tab(line[col])) {
            ++col;
        }
        if (col < line.size() && line[col] != '#') {
            return std::string("unexpected trailing characters on YAML line");
        }
        return std::nullopt;
    }

    // --- Quoted strings (may span multiple lines) ---------------------------------------------

    Expected<std::string> parse_single_quoted(std::size_t& col) {
        if (eof() || col >= lines_[line_idx_].size() || lines_[line_idx_][col] != '\'') {
            return unexpected(std::string("expected single-quoted string"));
        }
        ++col;
        std::string out;
        while (true) {
            const std::string_view line = lines_[line_idx_];
            while (col < line.size()) {
                if (line[col] == '\'') {
                    if (col + 1U < line.size() && line[col + 1U] == '\'') {
                        out.push_back('\'');
                        col += 2U;
                        continue;
                    }
                    ++col;
                    return out;
                }
                out.push_back(line[col]);
                ++col;
            }
            // Fold across newline(s): trim trailing spaces from out, count empty lines.
            while (!out.empty() && is_space_or_tab(out.back())) {
                out.pop_back();
            }
            std::size_t newlines = 0;
            while (true) {
                ++line_idx_;
                ++newlines;
                if (eof()) {
                    return unexpected(std::string("unterminated single-quoted string"));
                }
                const std::string_view next = lines_[line_idx_];
                col = 0;
                while (col < next.size() && is_space_or_tab(next[col])) {
                    ++col;
                }
                if (col < next.size()) {
                    break;
                }
            }
            if (newlines == 1U) {
                out.push_back(' ');
            } else {
                out.append(newlines - 1U, '\n');
            }
        }
    }

    Expected<std::string> parse_double_quoted(std::size_t& col) {
        if (eof() || col >= lines_[line_idx_].size() || lines_[line_idx_][col] != '"') {
            return unexpected(std::string("expected double-quoted string"));
        }
        ++col;
        std::string out;
        std::size_t protected_len = 0;
        while (true) {
            const std::string_view line = lines_[line_idx_];
            bool escaped_newline = false;
            while (col < line.size()) {
                const char c = line[col];
                if (c == '"') {
                    ++col;
                    return out;
                }
                if (c == '\\') {
                    if (col + 1U == line.size()) {
                        // Escaped line break: line continuation without inserting space/newline.
                        escaped_newline = true;
                        col = line.size();
                        break;
                    }
                    const char esc = line[col + 1U];
                    col += 2U;
                    switch (esc) {
                    case '0':
                        out.push_back('\0');
                        break;
                    case 'a':
                        out.push_back('\a');
                        break;
                    case 'b':
                        out.push_back('\b');
                        break;
                    case 't':
                    case '\t':
                        out.push_back('\t');
                        break;
                    case 'n':
                        out.push_back('\n');
                        break;
                    case 'v':
                        out.push_back('\v');
                        break;
                    case 'f':
                        out.push_back('\f');
                        break;
                    case 'r':
                        out.push_back('\r');
                        break;
                    case 'e':
                        out.push_back('\x1b');
                        break;
                    case ' ':
                        out.push_back(' ');
                        break;
                    case '"':
                        out.push_back('"');
                        break;
                    case '/':
                        out.push_back('/');
                        break;
                    case '\\':
                        out.push_back('\\');
                        break;
                    case 'N':
                        append_utf8(out, 0x85U);
                        break;
                    case '_':
                        append_utf8(out, 0xA0U);
                        break;
                    case 'L':
                        append_utf8(out, 0x2028U);
                        break;
                    case 'P':
                        append_utf8(out, 0x2029U);
                        break;
                    case 'x':
                    case 'u':
                    case 'U': {
                        const std::size_t count = (esc == 'x') ? 2U : (esc == 'u' ? 4U : 8U);
                        if (col + count > line.size()) {
                            return unexpected(std::string("incomplete Unicode escape in string"));
                        }
                        char32_t cp = 0;
                        for (std::size_t k = 0; k < count; ++k) {
                            const int hv = hex_value(line[col + k]);
                            if (hv < 0) {
                                return unexpected(std::string("invalid hex escape in string"));
                            }
                            cp = (cp << 4) | static_cast<char32_t>(hv);
                        }
                        col += count;
                        if (cp > 0x10FFFFU || (cp >= 0xD800U && cp <= 0xDFFFU)) {
                            return unexpected(std::string("invalid Unicode code point in escape"));
                        }
                        append_utf8(out, cp);
                        break;
                    }
                    default:
                        return unexpected(std::string("invalid escape sequence in string"));
                    }
                    protected_len = out.size();
                    continue;
                }
                out.push_back(c);
                ++col;
            }
            if (escaped_newline) {
                ++line_idx_;
                if (eof()) {
                    return unexpected(std::string("unterminated double-quoted string"));
                }
                const std::string_view next = lines_[line_idx_];
                col = 0;
                while (col < next.size() && is_space_or_tab(next[col])) {
                    ++col;
                }
                continue;
            }
            // Fold across unescaped newline(s); do not trim characters written by escapes.
            while (out.size() > protected_len && is_space_or_tab(out.back())) {
                out.pop_back();
            }
            std::size_t newlines = 0;
            while (true) {
                ++line_idx_;
                ++newlines;
                if (eof()) {
                    return unexpected(std::string("unterminated double-quoted string"));
                }
                const std::string_view next = lines_[line_idx_];
                col = 0;
                while (col < next.size() && is_space_or_tab(next[col])) {
                    ++col;
                }
                if (col < next.size()) {
                    break;
                }
            }
            if (newlines == 1U) {
                out.push_back(' ');
            } else {
                out.append(newlines - 1U, '\n');
            }
        }
    }

    // --- Flow collections ---------------------------------------------------------------------

    void skip_flow_ws(std::size_t& col) {
        while (!eof()) {
            const std::string_view line = lines_[line_idx_];
            while (col < line.size() && is_space_or_tab(line[col])) {
                ++col;
            }
            if (col < line.size() && line[col] == '#') {
                col = line.size();
            }
            if (col < line.size()) {
                return;
            }
            ++line_idx_;
            col = 0;
        }
    }

    Expected<Json> parse_flow_value(std::size_t& col, std::size_t depth) {
        skip_flow_ws(col);
        if (eof()) {
            return unexpected(std::string("unexpected end of flow collection"));
        }
        const char c = lines_[line_idx_][col];
        if (auto err = forbidden_indicator_error(c)) {
            return unexpected(std::move(*err));
        }
        if (c == '[') {
            return parse_flow_sequence(col, depth);
        }
        if (c == '{') {
            return parse_flow_mapping(col, depth);
        }
        if (c == '\'') {
            auto s = parse_single_quoted(col);
            if (!s) {
                return unexpected(s.error());
            }
            return Json(std::move(*s));
        }
        if (c == '"') {
            auto s = parse_double_quoted(col);
            if (!s) {
                return unexpected(s.error());
            }
            return Json(std::move(*s));
        }
        return parse_flow_plain(col, false);
    }

    Expected<Json> parse_flow_sequence(std::size_t& col, std::size_t depth) {
        if (depth > max_frontmatter_depth) {
            return unexpected(std::string("skill frontmatter exceeds maximum nesting depth of 64"));
        }
        ++col; // consume '['
        Json arr = Json::array();
        skip_flow_ws(col);
        if (eof()) {
            return unexpected(std::string("unterminated flow sequence"));
        }
        if (lines_[line_idx_][col] == ']') {
            ++col;
            return arr;
        }
        while (true) {
            skip_flow_ws(col);
            if (eof()) {
                return unexpected(std::string("unterminated flow sequence"));
            }
            const char c = lines_[line_idx_][col];
            if (c == ']') {
                ++col;
                return arr;
            }
            if (c == ',' || c == '}') {
                return unexpected(std::string("unexpected delimiter in flow sequence"));
            }
            if (auto err = forbidden_indicator_error(c)) {
                return unexpected(std::move(*err));
            }
            // YAML 1.2 §7.4.1 allows single-pair flow mappings inside flow sequences:
            // `[role: editor]` -> `[{"role": "editor"}]`.
            Expected<Json> elem = Json();
            if (c == '[' || c == '{') {
                elem = parse_flow_value(col, depth + 1U);
            } else {
                const bool quoted_elem = (c == '\'' || c == '"');
                Expected<Json> item = Json();
                if (c == '\'') {
                    auto s = parse_single_quoted(col);
                    item = s ? Expected<Json>(Json(std::move(*s))) : unexpected(s.error());
                } else if (c == '"') {
                    auto s = parse_double_quoted(col);
                    item = s ? Expected<Json>(Json(std::move(*s))) : unexpected(s.error());
                } else {
                    item = parse_flow_plain(col, true);
                }
                if (!item) {
                    return unexpected(item.error());
                }
                skip_flow_ws(col);
                if (!eof() && lines_[line_idx_][col] == ':') {
                    const std::string_view cur_line = lines_[line_idx_];
                    const bool valid_sep = quoted_elem || col + 1U == cur_line.size() ||
                                           is_space_or_tab(cur_line[col + 1U]) ||
                                           cur_line[col + 1U] == ',' || cur_line[col + 1U] == ']' ||
                                           cur_line[col + 1U] == '}';
                    if (!valid_sep) {
                        return unexpected(std::string("invalid ':' separator in flow sequence"));
                    }
                    if (depth + 1U > max_frontmatter_depth) {
                        return unexpected(
                            std::string("skill frontmatter exceeds maximum nesting depth of 64"));
                    }
                    if (!item->is_string()) {
                        return unexpected(
                            std::string("mapping key must be a string in skill frontmatter"));
                    }
                    std::string key_str = item->get<std::string>();
                    ++col;
                    skip_flow_ws(col);
                    if (eof()) {
                        return unexpected(std::string("unterminated flow sequence"));
                    }
                    Json mapped_val = Json(nullptr);
                    const char next_ch = lines_[line_idx_][col];
                    if (next_ch != ',' && next_ch != ']') {
                        auto parsed_val = parse_flow_value(col, depth + 2U);
                        if (!parsed_val) {
                            return unexpected(parsed_val.error());
                        }
                        mapped_val = std::move(*parsed_val);
                    }
                    Json pair_obj = Json::object();
                    pair_obj[std::move(key_str)] = std::move(mapped_val);
                    elem = std::move(pair_obj);
                } else {
                    elem = std::move(*item);
                }
            }
            if (!elem) {
                return unexpected(elem.error());
            }
            arr.push_back(std::move(*elem));
            skip_flow_ws(col);
            if (eof()) {
                return unexpected(std::string("unterminated flow sequence"));
            }
            const char sep = lines_[line_idx_][col];
            if (sep == ',') {
                ++col;
                continue;
            }
            if (sep == ']') {
                ++col;
                return arr;
            }
            return unexpected(std::string("expected ',' or ']' in flow sequence"));
        }
    }

    Expected<Json> parse_flow_mapping(std::size_t& col, std::size_t depth) {
        if (depth > max_frontmatter_depth) {
            return unexpected(std::string("skill frontmatter exceeds maximum nesting depth of 64"));
        }
        ++col; // consume '{'
        Json obj = Json::object();
        skip_flow_ws(col);
        if (eof()) {
            return unexpected(std::string("unterminated flow mapping"));
        }
        if (lines_[line_idx_][col] == '}') {
            ++col;
            return obj;
        }
        while (true) {
            skip_flow_ws(col);
            if (eof()) {
                return unexpected(std::string("unterminated flow mapping"));
            }
            const char c = lines_[line_idx_][col];
            if (c == '}') {
                ++col;
                return obj;
            }
            if (c == ',' || c == ']') {
                return unexpected(std::string("unexpected delimiter in flow mapping"));
            }
            if (auto err = forbidden_indicator_error(c)) {
                return unexpected(std::move(*err));
            }
            if (c == '[' || c == '{' || (c == '?' && is_explicit_key(lines_[line_idx_], col))) {
                return unexpected(
                    std::string("non-string mapping key is not allowed in skill frontmatter"));
            }
            std::string key_str;
            bool quoted_key = false;
            if (c == '\'') {
                auto k = parse_single_quoted(col);
                if (!k) {
                    return unexpected(k.error());
                }
                key_str = std::move(*k);
                quoted_key = true;
            } else if (c == '"') {
                auto k = parse_double_quoted(col);
                if (!k) {
                    return unexpected(k.error());
                }
                key_str = std::move(*k);
                quoted_key = true;
            } else {
                auto k = parse_flow_plain(col, true);
                if (!k) {
                    return unexpected(k.error());
                }
                if (!k->is_string()) {
                    return unexpected(
                        std::string("mapping key must be a string in skill frontmatter"));
                }
                key_str = k->get<std::string>();
            }
            if (obj.contains(key_str)) {
                return unexpected("duplicate key '" + key_str + "' in skill frontmatter");
            }
            skip_flow_ws(col);
            if (eof()) {
                return unexpected(std::string("unterminated flow mapping"));
            }
            Json value = Json(nullptr);
            const char after_key = lines_[line_idx_][col];
            if (after_key == ':') {
                // In YAML 1.2 flow mappings, adjacent `:` without space is allowed after quoted
                // keys (JSON compatibility), or followed by space/flow indicator/EOL.
                const std::string_view cur_line = lines_[line_idx_];
                const bool valid_sep = quoted_key || col + 1U == cur_line.size() ||
                                       is_space_or_tab(cur_line[col + 1U]) ||
                                       cur_line[col + 1U] == ',' || cur_line[col + 1U] == '}' ||
                                       cur_line[col + 1U] == ']';
                if (!valid_sep) {
                    return unexpected(std::string("invalid ':' separator in flow mapping"));
                }
                ++col;
                skip_flow_ws(col);
                if (eof()) {
                    return unexpected(std::string("unterminated flow mapping"));
                }
                const char next_ch = lines_[line_idx_][col];
                if (next_ch != ',' && next_ch != '}') {
                    auto parsed_val = parse_flow_value(col, depth + 1U);
                    if (!parsed_val) {
                        return unexpected(parsed_val.error());
                    }
                    value = std::move(*parsed_val);
                }
            } else if (after_key != ',' && after_key != '}') {
                return unexpected(std::string("expected ':' after key in flow mapping"));
            }
            obj[std::move(key_str)] = std::move(value);
            skip_flow_ws(col);
            if (eof()) {
                return unexpected(std::string("unterminated flow mapping"));
            }
            const char sep = lines_[line_idx_][col];
            if (sep == ',') {
                ++col;
                continue;
            }
            if (sep == '}') {
                ++col;
                return obj;
            }
            return unexpected(std::string("expected ',' or '}' in flow mapping"));
        }
    }

    Expected<Json> parse_flow_plain(std::size_t& col, bool as_mapping_key) {
        std::string raw;
        while (!eof()) {
            const std::string_view line = lines_[line_idx_];
            const std::size_t seg_start = col;
            while (col < line.size()) {
                const char c = line[col];
                if (c == ',' || c == ']' || c == '[' || c == '{' || c == '}') {
                    break;
                }
                if (c == '#' && (col == 0U || is_space_or_tab(line[col - 1U]))) {
                    break;
                }
                if (c == ':') {
                    const bool followed_by_delim =
                        col + 1U == line.size() || is_space_or_tab(line[col + 1U]) ||
                        line[col + 1U] == ',' || line[col + 1U] == ']' || line[col + 1U] == '}' ||
                        line[col + 1U] == '[' || line[col + 1U] == '{';
                    if (followed_by_delim) {
                        if (as_mapping_key) {
                            break;
                        }
                        return unexpected(std::string("unexpected ':' in flow plain scalar"));
                    }
                }
                ++col;
            }
            const std::string_view part = rtrim_spaces(line.substr(seg_start, col - seg_start));
            if (!part.empty()) {
                raw.append(part);
            }
            if (col < line.size()) {
                const char stop = line[col];
                if (stop == ',' || stop == ']' || stop == '}' || stop == ':' || stop == '[' ||
                    stop == '{') {
                    break;
                }
                // Hit `#comment` -> ends the plain scalar on this line.
                break;
            }
            // Reached end of line inside flow plain scalar: peek next non-empty line.
            const std::size_t saved_line = line_idx_;
            std::size_t newlines = 0;
            bool continued = false;
            while (true) {
                ++line_idx_;
                ++newlines;
                if (eof()) {
                    line_idx_ = saved_line;
                    col = line.size();
                    break;
                }
                const std::string_view next = lines_[line_idx_];
                std::size_t next_col = 0;
                while (next_col < next.size() && is_space_or_tab(next[next_col])) {
                    ++next_col;
                }
                if (next_col == next.size()) {
                    continue;
                }
                const char nc = next[next_col];
                if (nc == ',' || nc == ']' || nc == '}' || nc == '#' || nc == ':' || nc == '[' ||
                    nc == '{') {
                    col = next_col;
                    break;
                }
                col = next_col;
                continued = true;
                break;
            }
            if (!continued) {
                break;
            }
            if (newlines == 1U) {
                raw.push_back(' ');
            } else {
                raw.append(newlines - 1U, '\n');
            }
        }
        return resolve_plain_scalar(raw);
    }

    // --- Block scalars (`|` and `>`) ----------------------------------------------------------

    Expected<Json> parse_block_scalar(std::size_t parent_indent, std::size_t col) {
        const std::string_view header_line = lines_[line_idx_];
        const bool folded = (header_line[col] == '>');
        ++col;
        enum class Chomp { clip, strip, keep };
        Chomp chomp = Chomp::clip;
        bool saw_chomp = false;
        std::size_t explicit_indent = 0;
        while (col < header_line.size()) {
            const char c = header_line[col];
            if (c == '-' || c == '+') {
                if (saw_chomp) {
                    return unexpected(std::string("duplicate chomping indicator in block scalar"));
                }
                saw_chomp = true;
                chomp = (c == '-') ? Chomp::strip : Chomp::keep;
                ++col;
            } else if (c >= '1' && c <= '9') {
                if (explicit_indent != 0U) {
                    return unexpected(
                        std::string("duplicate indentation indicator in block scalar"));
                }
                explicit_indent = static_cast<std::size_t>(c - '0');
                ++col;
            } else if (is_space_or_tab(c)) {
                break;
            } else {
                return unexpected(std::string("invalid block scalar header"));
            }
        }
        if (auto err = expect_line_end(col)) {
            return unexpected(std::move(*err));
        }
        ++line_idx_;

        std::size_t block_indent = 0;
        if (explicit_indent > 0U) {
            block_indent = parent_indent + explicit_indent;
        } else {
            // Auto-detect from first non-space content line.
            std::size_t max_blank_spaces = 0;
            std::size_t scan = line_idx_;
            while (scan < lines_.size()) {
                const std::string_view ln = lines_[scan];
                std::size_t sp = 0;
                while (sp < ln.size() && ln[sp] == ' ') {
                    ++sp;
                }
                if (sp == ln.size()) {
                    max_blank_spaces = (std::max)(max_blank_spaces, sp);
                    ++scan;
                    continue;
                }
                if (sp <= parent_indent) {
                    break;
                }
                block_indent = sp;
                break;
            }
            if (block_indent > 0U && max_blank_spaces > block_indent) {
                return unexpected(
                    std::string("leading blank line exceeds block scalar indentation"));
            }
        }

        std::vector<std::string_view> content_lines;
        while (!eof()) {
            const std::string_view ln = lines_[line_idx_];
            std::size_t sp = 0;
            while (sp < ln.size() && ln[sp] == ' ') {
                ++sp;
            }
            if (sp == ln.size()) {
                if (block_indent > 0U && sp > block_indent) {
                    content_lines.push_back(ln.substr(block_indent));
                } else {
                    content_lines.emplace_back();
                }
                ++line_idx_;
                continue;
            }
            if (block_indent == 0U || sp < block_indent) {
                break;
            }
            content_lines.push_back(ln.substr(block_indent));
            ++line_idx_;
        }

        // Split trailing empty lines for chomping.
        std::size_t content_end = content_lines.size();
        while (content_end > 0U && content_lines[content_end - 1U].empty()) {
            --content_end;
        }
        const std::size_t trailing_blanks = content_lines.size() - content_end;

        std::string result;
        if (content_end == 0U) {
            if (chomp == Chomp::keep) {
                result.append(trailing_blanks, '\n');
            }
            return Json(std::move(result));
        }

        if (!folded) {
            for (std::size_t i = 0; i < content_end; ++i) {
                if (i > 0U) {
                    result.push_back('\n');
                }
                result.append(content_lines[i]);
            }
        } else {
            const auto is_more_indented = [](std::string_view ln) noexcept {
                return !ln.empty() && is_space_or_tab(ln.front());
            };
            std::size_t i = 0;
            while (i < content_end) {
                if (content_lines[i].empty()) {
                    // Leading empty lines before first text or after text.
                    result.push_back('\n');
                    ++i;
                    continue;
                }
                if (i > 0U) {
                    // Already emitted separator before this line if needed.
                }
                result.append(content_lines[i]);
                const bool cur_more = is_more_indented(content_lines[i]);
                ++i;
                if (i >= content_end) {
                    break;
                }
                std::size_t blanks = 0;
                while (i < content_end && content_lines[i].empty()) {
                    ++blanks;
                    ++i;
                }
                if (i >= content_end) {
                    break;
                }
                const bool next_more = is_more_indented(content_lines[i]);
                if (cur_more || next_more) {
                    result.append(blanks + 1U, '\n');
                } else if (blanks == 0U) {
                    result.push_back(' ');
                } else {
                    result.append(blanks, '\n');
                }
            }
        }

        if (chomp == Chomp::clip) {
            result.push_back('\n');
        } else if (chomp == Chomp::keep) {
            result.append(trailing_blanks + 1U, '\n');
        }
        return Json(std::move(result));
    }

    // --- Block plain scalar (may continue on more-indented lines) -----------------------------

    Expected<Json> parse_block_plain(std::size_t min_continuation_indent, std::size_t col) {
        const std::string_view first = lines_[line_idx_];
        if (find_block_mapping_colon(first, col)) {
            return unexpected(std::string("unexpected ':' in plain YAML scalar"));
        }
        const std::string_view tail = first.substr(col);
        bool had_comment = false;
        std::string_view first_part = rtrim_spaces(tail);
        for (std::size_t i = 0; i < tail.size(); ++i) {
            if (tail[i] == '#' && (i == 0U || is_space_or_tab(tail[i - 1U]))) {
                first_part = rtrim_spaces(tail.substr(0, i));
                had_comment = true;
                break;
            }
        }
        std::string raw(first_part);
        ++line_idx_;
        if (had_comment) {
            return resolve_plain_scalar(raw);
        }
        while (!eof()) {
            std::size_t scan = line_idx_;
            std::size_t blank_count = 0;
            while (scan < lines_.size() &&
                   lines_[scan].find_first_not_of(" \t") == std::string_view::npos) {
                ++blank_count;
                ++scan;
            }
            if (scan >= lines_.size() || is_blank_or_comment(lines_[scan])) {
                break;
            }
            const auto indent = line_indent(lines_[scan]);
            if (!indent) {
                return unexpected(indent.error());
            }
            if (*indent < min_continuation_indent) {
                break;
            }
            const std::string_view cont = lines_[scan];
            if (is_sequence_dash(cont, *indent) || find_block_mapping_colon(cont, *indent)) {
                break;
            }
            const std::string_view cont_tail = cont.substr(*indent);
            bool cont_comment = false;
            std::string_view text = rtrim_spaces(cont_tail);
            for (std::size_t i = 0; i < cont_tail.size(); ++i) {
                if (cont_tail[i] == '#' && (i == 0U || is_space_or_tab(cont_tail[i - 1U]))) {
                    text = rtrim_spaces(cont_tail.substr(0, i));
                    cont_comment = true;
                    break;
                }
            }
            if (text.empty()) {
                break;
            }
            if (blank_count == 0U) {
                raw.push_back(' ');
            } else {
                raw.append(blank_count, '\n');
            }
            raw.append(text);
            line_idx_ = scan + 1U;
            if (cont_comment) {
                break;
            }
        }
        return resolve_plain_scalar(raw);
    }

    // --- Block mapping / sequence / node ------------------------------------------------------

    Expected<Json> parse_inline_value(std::size_t parent_indent, std::size_t col,
                                      std::size_t depth) {
        const std::string_view line = lines_[line_idx_];
        while (col < line.size() && is_space_or_tab(line[col])) {
            ++col;
        }
        if (col >= line.size() || line[col] == '#') {
            ++line_idx_;
            skip_blank_and_comments();
            if (eof()) {
                return Json(nullptr);
            }
            const auto next_indent = line_indent(lines_[line_idx_]);
            if (!next_indent) {
                return unexpected(next_indent.error());
            }
            if (*next_indent < parent_indent) {
                return Json(nullptr);
            }
            if (*next_indent == parent_indent) {
                if (is_sequence_dash(lines_[line_idx_], *next_indent)) {
                    return parse_block_sequence(*next_indent, depth);
                }
                return Json(nullptr);
            }
            return parse_block_node(*next_indent, depth);
        }
        const char c = line[col];
        if (auto err = forbidden_indicator_error(c)) {
            return unexpected(std::move(*err));
        }
        if (c == '|' || c == '>') {
            return parse_block_scalar(parent_indent, col);
        }
        if (c == '[' || c == '{') {
            auto val = parse_flow_value(col, depth);
            if (!val) {
                return unexpected(val.error());
            }
            if (auto err = expect_line_end(col)) {
                return unexpected(std::move(*err));
            }
            ++line_idx_;
            return val;
        }
        if (c == '\'') {
            auto s = parse_single_quoted(col);
            if (!s) {
                return unexpected(s.error());
            }
            if (auto err = expect_line_end(col)) {
                return unexpected(std::move(*err));
            }
            ++line_idx_;
            return Json(std::move(*s));
        }
        if (c == '"') {
            auto s = parse_double_quoted(col);
            if (!s) {
                return unexpected(s.error());
            }
            if (auto err = expect_line_end(col)) {
                return unexpected(std::move(*err));
            }
            ++line_idx_;
            return Json(std::move(*s));
        }
        return parse_block_plain(parent_indent + 1U, col);
    }

    Expected<Json> parse_block_node(std::size_t indent, std::size_t depth) {
        const std::string_view line = lines_[line_idx_];
        if (auto err = forbidden_indicator_error(line[indent])) {
            return unexpected(std::move(*err));
        }
        if (is_sequence_dash(line, indent)) {
            return parse_block_sequence(indent, depth);
        }
        if (line[indent] == '[' || line[indent] == '{') {
            std::size_t col = indent;
            auto val = parse_flow_value(col, depth);
            if (!val) {
                return unexpected(val.error());
            }
            if (auto err = expect_line_end(col)) {
                return unexpected(std::move(*err));
            }
            ++line_idx_;
            return val;
        }
        if (line[indent] == '|' || line[indent] == '>') {
            return parse_block_scalar(indent > 0U ? indent - 1U : 0U, indent);
        }
        if (line[indent] == '"' || line[indent] == '\'') {
            // Could be a quoted mapping key (`"k": v`) or a standalone quoted scalar.
            const std::size_t saved_line = line_idx_;
            std::size_t col = indent;
            auto quoted =
                (line[indent] == '"') ? parse_double_quoted(col) : parse_single_quoted(col);
            if (!quoted) {
                return unexpected(quoted.error());
            }
            if (!eof()) {
                const std::string_view cur = lines_[line_idx_];
                std::size_t probe = col;
                while (probe < cur.size() && is_space_or_tab(cur[probe])) {
                    ++probe;
                }
                if (is_colon_separator(cur, probe)) {
                    line_idx_ = saved_line;
                    return parse_block_mapping(indent, depth);
                }
            }
            if (auto err = expect_line_end(col)) {
                return unexpected(std::move(*err));
            }
            ++line_idx_;
            return Json(std::move(*quoted));
        }
        if (is_explicit_key(line, indent)) {
            return parse_block_mapping(indent, depth);
        }
        if (find_block_mapping_colon(line, indent)) {
            return parse_block_mapping(indent, depth);
        }
        return parse_block_plain(indent, indent);
    }

    Expected<Json> parse_block_sequence(std::size_t seq_indent, std::size_t depth) {
        if (depth > max_frontmatter_depth) {
            return unexpected(std::string("skill frontmatter exceeds maximum nesting depth of 64"));
        }
        Json arr = Json::array();
        while (true) {
            skip_blank_and_comments();
            if (eof()) {
                break;
            }
            const auto indent = line_indent(lines_[line_idx_]);
            if (!indent) {
                return unexpected(indent.error());
            }
            if (*indent < seq_indent) {
                break;
            }
            if (*indent > seq_indent) {
                return unexpected(std::string("unexpected indentation in YAML sequence"));
            }
            if (!is_sequence_dash(lines_[line_idx_], seq_indent)) {
                break;
            }
            auto elem = parse_sequence_item(seq_indent, depth);
            if (!elem) {
                return unexpected(elem.error());
            }
            arr.push_back(std::move(*elem));
        }
        return arr;
    }

    Expected<Json> parse_sequence_item(std::size_t seq_indent, std::size_t depth) {
        const std::string_view line = lines_[line_idx_];
        std::size_t col = seq_indent + 1U;
        while (col < line.size() && is_space_or_tab(line[col])) {
            ++col;
        }
        if (col >= line.size() || line[col] == '#') {
            ++line_idx_;
            skip_blank_and_comments();
            if (eof()) {
                return Json(nullptr);
            }
            const auto next_indent = line_indent(lines_[line_idx_]);
            if (!next_indent) {
                return unexpected(next_indent.error());
            }
            if (*next_indent <= seq_indent) {
                return Json(nullptr);
            }
            return parse_block_node(*next_indent, depth + 1U);
        }
        const char c = line[col];
        if (auto err = forbidden_indicator_error(c)) {
            return unexpected(std::move(*err));
        }
        if (is_sequence_dash(line, col)) {
            // Compact nested sequence: `- - item`
            if (depth + 1U > max_frontmatter_depth) {
                return unexpected(
                    std::string("skill frontmatter exceeds maximum nesting depth of 64"));
            }
            Json nested = Json::array();
            auto first_elem = parse_sequence_item(col, depth + 1U);
            if (!first_elem) {
                return unexpected(first_elem.error());
            }
            nested.push_back(std::move(*first_elem));
            while (true) {
                skip_blank_and_comments();
                if (eof()) {
                    break;
                }
                const auto ni = line_indent(lines_[line_idx_]);
                if (!ni) {
                    return unexpected(ni.error());
                }
                if (*ni < col) {
                    break;
                }
                if (*ni > col) {
                    return unexpected(std::string("unexpected indentation in nested sequence"));
                }
                if (!is_sequence_dash(lines_[line_idx_], col)) {
                    break;
                }
                auto next_elem = parse_sequence_item(col, depth + 1U);
                if (!next_elem) {
                    return unexpected(next_elem.error());
                }
                nested.push_back(std::move(*next_elem));
            }
            return nested;
        }
        if (c == '|' || c == '>') {
            return parse_block_scalar(seq_indent, col);
        }
        if (c == '[' || c == '{') {
            auto val = parse_flow_value(col, depth + 1U);
            if (!val) {
                return unexpected(val.error());
            }
            if (auto err = expect_line_end(col)) {
                return unexpected(std::move(*err));
            }
            ++line_idx_;
            return val;
        }
        if (c == '"' || c == '\'') {
            const std::size_t saved_line = line_idx_;
            std::size_t end_col = col;
            auto quoted = (c == '"') ? parse_double_quoted(end_col) : parse_single_quoted(end_col);
            if (!quoted) {
                return unexpected(quoted.error());
            }
            if (!eof()) {
                const std::string_view cur = lines_[line_idx_];
                std::size_t probe = end_col;
                while (probe < cur.size() && is_space_or_tab(cur[probe])) {
                    ++probe;
                }
                if (is_colon_separator(cur, probe)) {
                    line_idx_ = saved_line;
                    return parse_compact_mapping(col, depth + 1U);
                }
            }
            if (auto err = expect_line_end(end_col)) {
                return unexpected(std::move(*err));
            }
            ++line_idx_;
            return Json(std::move(*quoted));
        }
        if (is_explicit_key(line, col)) {
            return parse_compact_mapping(col, depth + 1U);
        }
        if (find_block_mapping_colon(line, col)) {
            return parse_compact_mapping(col, depth + 1U);
        }
        return parse_block_plain(seq_indent + 1U, col);
    }

    Expected<Json> parse_compact_mapping(std::size_t map_indent, std::size_t depth) {
        if (depth > max_frontmatter_depth) {
            return unexpected(std::string("skill frontmatter exceeds maximum nesting depth of 64"));
        }
        Json obj = Json::object();
        // First entry starts at `map_indent` on the current line (after `- `).
        if (auto err = parse_mapping_entry(obj, map_indent, map_indent, depth)) {
            return unexpected(std::move(*err));
        }
        return continue_block_mapping(std::move(obj), map_indent, depth);
    }

    Expected<Json> parse_block_mapping(std::size_t map_indent, std::size_t depth) {
        if (depth > max_frontmatter_depth) {
            return unexpected(std::string("skill frontmatter exceeds maximum nesting depth of 64"));
        }
        return continue_block_mapping(Json::object(), map_indent, depth);
    }

    Expected<Json> continue_block_mapping(Json obj, std::size_t map_indent, std::size_t depth) {
        while (true) {
            skip_blank_and_comments();
            if (eof()) {
                break;
            }
            const auto indent = line_indent(lines_[line_idx_]);
            if (!indent) {
                return unexpected(indent.error());
            }
            if (*indent < map_indent) {
                break;
            }
            if (*indent > map_indent) {
                return unexpected(std::string("unexpected indentation in YAML mapping"));
            }
            if (is_sequence_dash(lines_[line_idx_], map_indent)) {
                return unexpected(std::string("unexpected sequence item inside YAML mapping"));
            }
            if (auto err = parse_mapping_entry(obj, map_indent, map_indent, depth)) {
                return unexpected(std::move(*err));
            }
        }
        return obj;
    }

    std::optional<std::string> parse_mapping_entry(Json& obj, std::size_t map_indent,
                                                   std::size_t key_col, std::size_t depth) {
        const std::string_view line = lines_[line_idx_];
        if (key_col == 0U && line == "...") {
            return std::string("unexpected YAML document end marker in skill frontmatter");
        }
        const char first = line[key_col];
        if (auto err = forbidden_indicator_error(first)) {
            return err;
        }
        if (first == '[' || first == '{') {
            return std::string("non-string mapping key is not allowed in skill frontmatter");
        }
        if (is_explicit_key(line, key_col)) {
            // Explicit YAML block mapping key (`? <key>` followed optionally by `: <value>`).
            // Only string keys are permitted by S2; non-string keys (collections, numbers, etc.)
            // are rejected.
            auto key_val = parse_inline_value(map_indent, key_col + 1U, depth + 1U);
            if (!key_val) {
                return key_val.error();
            }
            if (!key_val->is_string()) {
                return std::string("mapping key must be a string in skill frontmatter");
            }
            std::string explicit_key_str = key_val->get<std::string>();
            if (obj.contains(explicit_key_str)) {
                return "duplicate key '" + explicit_key_str + "' in skill frontmatter";
            }
            skip_blank_and_comments();
            Json explicit_val = Json(nullptr);
            if (!eof()) {
                const auto val_indent = line_indent(lines_[line_idx_]);
                if (!val_indent) {
                    return val_indent.error();
                }
                if (*val_indent == map_indent &&
                    is_colon_separator(lines_[line_idx_], map_indent)) {
                    auto parsed_val = parse_inline_value(map_indent, map_indent + 1U, depth + 1U);
                    if (!parsed_val) {
                        return parsed_val.error();
                    }
                    explicit_val = std::move(*parsed_val);
                }
            }
            obj[std::move(explicit_key_str)] = std::move(explicit_val);
            return std::nullopt;
        }

        std::string key_str;
        std::size_t after_colon = 0;
        if (first == '"' || first == '\'') {
            std::size_t col = key_col;
            auto quoted = (first == '"') ? parse_double_quoted(col) : parse_single_quoted(col);
            if (!quoted) {
                return quoted.error();
            }
            if (eof()) {
                return std::string("expected ':' after mapping key");
            }
            const std::string_view cur = lines_[line_idx_];
            while (col < cur.size() && is_space_or_tab(cur[col])) {
                ++col;
            }
            if (!is_colon_separator(cur, col)) {
                return std::string("expected ':' after mapping key");
            }
            key_str = std::move(*quoted);
            after_colon = col + 1U;
        } else {
            const auto colon = find_block_mapping_colon(line, key_col);
            if (!colon) {
                return std::string("expected ':' in YAML mapping entry");
            }
            const std::string_view raw_key = trim_spaces(line.substr(key_col, *colon - key_col));
            if (raw_key.empty()) {
                return std::string("empty mapping key is not allowed in skill frontmatter");
            }
            auto resolved = resolve_plain_scalar(raw_key);
            if (!resolved) {
                return resolved.error();
            }
            if (!resolved->is_string()) {
                return std::string("mapping key must be a string in skill frontmatter");
            }
            key_str = resolved->get<std::string>();
            after_colon = *colon + 1U;
        }

        if (obj.contains(key_str)) {
            return "duplicate key '" + key_str + "' in skill frontmatter";
        }
        auto value = parse_inline_value(map_indent, after_colon, depth + 1U);
        if (!value) {
            return value.error();
        }
        obj[std::move(key_str)] = std::move(*value);
        return std::nullopt;
    }
};

} // namespace

Expected<Json> parse_skill_frontmatter(std::string_view content) {
    if (content.size() > max_frontmatter_bytes) {
        return unexpected(std::string("SKILL.md exceeds maximum skill size of 16 MiB"));
    }
    if (!afd::detail::is_valid_utf8(content)) {
        return unexpected(std::string("SKILL.md is not valid UTF-8"));
    }

    // Opening fence: line must be `---` terminated by `\n` or `\r\n`.
    std::size_t pos = 0;
    if (content.starts_with("---\n")) {
        pos = 4U;
    } else if (content.starts_with("---\r\n")) {
        pos = 5U;
    } else {
        return unexpected(std::string("SKILL.md must begin with a '---' frontmatter fence"));
    }

    // Split frontmatter lines strictly on `\n` (allowing `\r\n` only, refusing bare `\r`).
    std::vector<std::string_view> lines;
    bool found_closing = false;
    while (pos <= content.size()) {
        const std::size_t nl = content.find('\n', pos);
        const bool has_nl = (nl != std::string_view::npos);
        std::string_view line = has_nl ? content.substr(pos, nl - pos) : content.substr(pos);
        if (has_nl && !line.empty() && line.back() == '\r') {
            line.remove_suffix(1U);
        }
        if (line.find('\r') != std::string_view::npos) {
            return unexpected(
                std::string("bare carriage return is not allowed in SKILL.md frontmatter"));
        }
        if (line == "---") {
            found_closing = true;
            break;
        }
        lines.push_back(line);
        if (!has_nl) {
            break;
        }
        pos = nl + 1U;
    }

    if (!found_closing) {
        return unexpected(std::string("SKILL.md frontmatter is missing a closing '---' fence"));
    }

    FrontmatterParser parser(std::move(lines));
    return parser.parse_document();
}

} // namespace afd::mcp::surface
