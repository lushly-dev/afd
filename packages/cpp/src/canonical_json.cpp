// Canonical JSON: `afd::canonical_json`, the text an approval token binds an input to (and a
// principal binding, spec/authorization.md M8), and the journal's and output budget's variants of
// it declared in detail/canonical_json.hpp. Split from approval.cpp, which keeps the tokens and
// the middleware; the tokens share `detail::append_json_string`.
#include "detail/canonical_json.hpp"

#include "afd/approval.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <utility>
#include <vector>

#include "detail/json_io.hpp"
#include "detail/utf8.hpp"

namespace afd {

namespace {

constexpr std::size_t max_canonical_depth = 256;

/// Whether `text` is valid UTF-8. `decode_utf8` reports an invalid byte as a one-byte U+FFFD.
bool is_valid_utf8(std::string_view text) {
    for (std::size_t i = 0; i < text.size();) {
        const detail::DecodedChar decoded = detail::decode_utf8(text, i);
        if (decoded.code_point == 0xFFFD && decoded.byte_length == 1) {
            return false;
        }
        i += decoded.byte_length;
    }
    return true;
}

/// `text` (valid UTF-8) as UTF-16 code units, for ordering keys as JavaScript's `sort` does.
std::u16string to_utf16(std::string_view text) {
    std::u16string out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size();) {
        const detail::DecodedChar decoded = detail::decode_utf8(text, i);
        if (decoded.code_point >= 0x10000) {
            const char32_t offset = decoded.code_point - 0x10000;
            out.push_back(static_cast<char16_t>(0xD800 + (offset >> 10)));
            out.push_back(static_cast<char16_t>(0xDC00 + (offset & 0x3FF)));
        } else {
            out.push_back(static_cast<char16_t>(decoded.code_point));
        }
        i += decoded.byte_length;
    }
    return out;
}

/// A finite, non-integral (or beyond 2^53) double as JavaScript's `Number.prototype.toString`
/// writes it: the fewest significant digits that read back as the same double, the closest such
/// decimal, laid out by ECMA-262's Number::toString rules. At each precision the correctly
/// rounded `%.*e` is tried, then its neighbours one unit in the last digit away: at a power of
/// two the gap below is half the gap above, so a farther decimal can round-trip where the
/// nearest does not. Candidates are read back as `<integer>e<exponent>` and only digits are
/// taken from the formatted text, so the locale's decimal separator does not matter. `value`
/// must be finite and nonzero (zero is written as an integer before it gets here).
std::string format_double(double value) {
    std::string sign;
    if (value < 0) {
        sign = "-";
        value = -value;
    }
    std::uint64_t mantissa = 0;
    int scale = 0; // value = mantissa × 10^scale
    for (int precision = 1; precision <= 17; ++precision) {
        char buffer[64];
        std::snprintf(buffer, sizeof buffer, "%.*e", precision - 1, value);
        std::uint64_t nearest = 0;
        int exponent = 0;
        const char* c = buffer;
        for (; *c != '\0' && *c != 'e' && *c != 'E'; ++c) {
            if (*c >= '0' && *c <= '9') {
                nearest = nearest * 10 + static_cast<std::uint64_t>(*c - '0');
            }
        }
        if (*c != '\0') {
            ++c;
            const bool negative = *c == '-';
            if (*c == '-' || *c == '+') {
                ++c;
            }
            for (; *c >= '0' && *c <= '9'; ++c) {
                exponent = exponent * 10 + (*c - '0');
            }
            exponent = negative ? -exponent : exponent;
        }
        scale = exponent - (precision - 1);
        const auto round_trips = [&](std::uint64_t candidate) {
            if (candidate == 0) {
                return false;
            }
            const std::string text = std::to_string(candidate) + "e" + std::to_string(scale);
            return std::strtod(text.c_str(), nullptr) == value;
        };
        if (round_trips(nearest) || precision == 17) {
            mantissa = nearest;
            break;
        }
        if (round_trips(nearest - 1)) {
            mantissa = nearest - 1;
            break;
        }
        if (round_trips(nearest + 1)) {
            mantissa = nearest + 1;
            break;
        }
    }
    std::string digits = std::to_string(mantissa);
    // value = 0.<digits> × 10^n.
    const int n = static_cast<int>(digits.size()) + scale;
    digits.erase(digits.find_last_not_of('0') + 1);
    const int k = static_cast<int>(digits.size());

    std::string out = sign;
    if (k <= n && n <= 21) {
        out += digits;
        out.append(static_cast<std::size_t>(n - k), '0');
    } else if (0 < n && n <= 21) {
        out += digits.substr(0, static_cast<std::size_t>(n));
        out += '.';
        out += digits.substr(static_cast<std::size_t>(n));
    } else if (-6 < n && n <= 0) {
        out += "0.";
        out.append(static_cast<std::size_t>(-n), '0');
        out += digits;
    } else {
        out += digits.front();
        if (k > 1) {
            out += '.';
            out += digits.substr(1);
        }
        const int e = n - 1;
        out += e < 0 ? "e-" : "e+";
        out += std::to_string(e < 0 ? -e : e);
    }
    return out;
}

/// What `encode` does with an integer beyond 2^53 − 1 that JavaScript would write differently.
enum class UnsafeIntegers {
    /// Refuse it (an approval binding).
    refuse,
    /// Write the double JavaScript reads it as (the journal's context cap).
    nearest,
};

/// An integer written as `text`, whose nearest double is `nearest`. Beyond 2^53 − 1 JavaScript
/// holds only the double, which it writes with as few digits as identify it (2^60 is
/// `1152921504606847000`). Under `UnsafeIntegers::refuse`, an integer is accepted there only
/// when `text` is that spelling, so two distinct integers can never share one; anything else
/// could not have come from JavaScript, and is refused.
std::optional<std::string> encode_integer(const std::string& text, double nearest, bool safe,
                                          UnsafeIntegers unsafe, std::string& out) {
    if (!safe) {
        std::string spelled = format_double(nearest);
        if (unsafe == UnsafeIntegers::nearest) {
            out += spelled;
            return std::nullopt;
        }
        if (spelled != text) {
            return std::string(
                "an integer beyond 2^53 - 1 that JavaScript would write differently");
        }
    }
    out += text;
    return std::nullopt;
}

/// Appends the canonical JSON of `value` to `out`; returns why it cannot, if it cannot.
std::optional<std::string> encode(const Json& value, std::string& out, std::size_t depth,
                                  UnsafeIntegers unsafe) {
    if (depth > max_canonical_depth) {
        return std::string("the input is nested deeper than 256 levels");
    }
    switch (value.type()) {
    case Json::value_t::null:
        out += "null";
        return std::nullopt;
    case Json::value_t::boolean:
        out += value.get<bool>() ? "true" : "false";
        return std::nullopt;
    case Json::value_t::number_integer: {
        const auto number = value.get<std::int64_t>();
        return encode_integer(
            std::to_string(number), static_cast<double>(number),
            number <= detail::max_safe_integer && number >= -detail::max_safe_integer, unsafe, out);
    }
    case Json::value_t::number_unsigned: {
        const auto number = value.get<std::uint64_t>();
        return encode_integer(std::to_string(number), static_cast<double>(number),
                              number <= static_cast<std::uint64_t>(detail::max_safe_integer),
                              unsafe, out);
    }
    case Json::value_t::number_float: {
        const auto number = value.get<double>();
        if (!std::isfinite(number)) {
            return std::string("a non-finite number has no JSON form");
        }
        if (std::trunc(number) == number &&
            std::fabs(number) <= static_cast<double>(detail::max_safe_integer)) {
            out += std::to_string(static_cast<std::int64_t>(number)); // -0 is "0", as in JavaScript
        } else {
            out += format_double(number);
        }
        return std::nullopt;
    }
    case Json::value_t::string: {
        const auto& text = value.get_ref<const std::string&>();
        if (!is_valid_utf8(text)) {
            return std::string("a string is not valid UTF-8");
        }
        detail::append_json_string(out, text);
        return std::nullopt;
    }
    case Json::value_t::array: {
        out.push_back('[');
        bool first = true;
        for (const auto& item : value) {
            if (!first) {
                out.push_back(',');
            }
            first = false;
            if (auto failed = encode(item, out, depth + 1, unsafe)) {
                return failed;
            }
        }
        out.push_back(']');
        return std::nullopt;
    }
    case Json::value_t::object: {
        std::vector<std::pair<std::u16string, const std::string*>> keys;
        keys.reserve(value.size());
        for (auto it = value.begin(); it != value.end(); ++it) {
            if (!is_valid_utf8(it.key())) {
                return std::string("an object key is not valid UTF-8");
            }
            keys.emplace_back(to_utf16(it.key()), &it.key());
        }
        std::sort(keys.begin(), keys.end(),
                  [](const auto& a, const auto& b) { return a.first < b.first; });
        out.push_back('{');
        bool first = true;
        for (const auto& [ordering, key] : keys) {
            if (!first) {
                out.push_back(',');
            }
            first = false;
            detail::append_json_string(out, *key);
            out.push_back(':');
            if (auto failed = encode(*value.find(*key), out, depth + 1, unsafe)) {
                return failed;
            }
        }
        out.push_back('}');
        return std::nullopt;
    }
    case Json::value_t::binary:
        return std::string("binary values have no JSON form");
    case Json::value_t::discarded:
        break;
    }
    return std::string("a discarded value has no JSON form");
}

} // namespace

Expected<std::string> canonical_json(const Json& value) {
    std::string out;
    if (auto failed = encode(value, out, 1, UnsafeIntegers::refuse)) {
        return unexpected("Cannot bind an approval to this value: " + *failed);
    }
    return out;
}

namespace detail {

void append_json_string(std::string& out, std::string_view text) {
    static constexpr char hex[] = "0123456789abcdef";
    out.push_back('"');
    for (const char c : text) {
        const auto byte = static_cast<unsigned char>(c);
        switch (c) {
        case '"':
            out += "\\\"";
            break;
        case '\\':
            out += "\\\\";
            break;
        case '\b':
            out += "\\b";
            break;
        case '\f':
            out += "\\f";
            break;
        case '\n':
            out += "\\n";
            break;
        case '\r':
            out += "\\r";
            break;
        case '\t':
            out += "\\t";
            break;
        default:
            if (byte < 0x20) {
                out += "\\u00";
                out.push_back(hex[byte >> 4]);
                out.push_back(hex[byte & 0xFU]);
            } else {
                out.push_back(c);
            }
        }
    }
    out.push_back('"');
}

Expected<std::string> canonical_json_as_read(const Json& value) {
    std::string out;
    if (auto failed = encode(value, out, 1, UnsafeIntegers::nearest)) {
        return unexpected("No canonical JSON for this value: " + *failed);
    }
    return out;
}

std::uint64_t canonical_json_byte_length_as_read(const Json& value) {
    const auto string_length = [](const std::string& text) -> std::uint64_t {
        if (!is_valid_utf8(text)) {
            return static_cast<std::uint64_t>(wire::serialize(Json(text)).size());
        }
        std::uint64_t total = 2; // opening and closing quotes
        for (const char c : text) {
            const auto byte = static_cast<unsigned char>(c);
            switch (c) {
            case '"':
            case '\\':
            case '\b':
            case '\f':
            case '\n':
            case '\r':
            case '\t':
                total += 2;
                break;
            default:
                total += byte < 0x20 ? 6 : 1;
                break;
            }
        }
        return total;
    };

    const auto scalar_length = [&](const Json& node) -> std::uint64_t {
        switch (node.type()) {
        case Json::value_t::null:
            return 4;
        case Json::value_t::boolean:
            return node.get<bool>() ? 4 : 5;
        case Json::value_t::number_integer: {
            const auto number = node.get<std::int64_t>();
            if (number <= detail::max_safe_integer && number >= -detail::max_safe_integer) {
                return static_cast<std::uint64_t>(std::to_string(number).size());
            }
            return static_cast<std::uint64_t>(format_double(static_cast<double>(number)).size());
        }
        case Json::value_t::number_unsigned: {
            const auto number = node.get<std::uint64_t>();
            if (number <= static_cast<std::uint64_t>(detail::max_safe_integer)) {
                return static_cast<std::uint64_t>(std::to_string(number).size());
            }
            return static_cast<std::uint64_t>(format_double(static_cast<double>(number)).size());
        }
        case Json::value_t::number_float: {
            const auto number = node.get<double>();
            if (!std::isfinite(number)) {
                return 4; // JSON.stringify writes null for non-finite numbers
            }
            if (std::trunc(number) == number &&
                std::fabs(number) <= static_cast<double>(detail::max_safe_integer)) {
                return static_cast<std::uint64_t>(
                    std::to_string(static_cast<std::int64_t>(number)).size());
            }
            return static_cast<std::uint64_t>(format_double(number).size());
        }
        case Json::value_t::string:
            return string_length(node.get_ref<const std::string&>());
        case Json::value_t::binary:
        case Json::value_t::discarded:
        case Json::value_t::array:
        case Json::value_t::object:
            break;
        }
        return static_cast<std::uint64_t>(wire::serialize(node).size());
    };

    struct Frame {
        bool is_object = false;
        const Json* array = nullptr;
        std::size_t index = 0;
        Json::const_iterator it;
        Json::const_iterator end;
        bool first = true;
    };

    std::uint64_t total = 0;
    std::vector<Frame> stack;
    const auto visit = [&](const Json& node) {
        if (node.is_array()) {
            total += 1; // '['
            Frame frame;
            frame.is_object = false;
            frame.array = &node;
            frame.index = 0;
            stack.push_back(std::move(frame));
        } else if (node.is_object()) {
            total += 1; // '{'
            Frame frame;
            frame.is_object = true;
            frame.it = node.begin();
            frame.end = node.end();
            frame.first = true;
            stack.push_back(std::move(frame));
        } else {
            total += scalar_length(node);
        }
    };

    visit(value);
    while (!stack.empty()) {
        Frame& top = stack.back();
        if (!top.is_object) {
            if (top.index < top.array->size()) {
                if (top.index > 0) {
                    total += 1; // ','
                }
                const Json& item = (*top.array)[top.index++];
                visit(item);
            } else {
                total += 1; // ']'
                stack.pop_back();
            }
        } else {
            if (top.it != top.end) {
                if (!top.first) {
                    total += 1; // ','
                }
                top.first = false;
                total += string_length(top.it.key()) + 1; // key + ':'
                const Json& member = top.it.value();
                ++top.it;
                visit(member);
            } else {
                total += 1; // '}'
                stack.pop_back();
            }
        }
    }
    return total;
}

} // namespace detail

} // namespace afd
