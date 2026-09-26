// Private UTF-8 helpers for matching JavaScript string semantics: UTF-16 lengths and the `\s`
// whitespace class. Invalid UTF-8 decodes to U+FFFD one byte at a time.
#pragma once

#include <cstddef>
#include <string_view>

namespace afd::detail {

struct DecodedChar {
    char32_t code_point;
    std::size_t byte_length;
};

/// Decodes the UTF-8 sequence starting at `text[i]` (which must be in range).
inline DecodedChar decode_utf8(std::string_view text, std::size_t i) {
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

/// How many UTF-16 code units `code_point` takes.
inline std::size_t utf16_units(char32_t code_point) {
    return code_point >= 0x10000 ? 2 : 1;
}

/// `text.length` in JavaScript.
inline std::size_t utf16_length(std::string_view text) {
    std::size_t length = 0;
    for (std::size_t i = 0; i < text.size();) {
        const DecodedChar decoded = decode_utf8(text, i);
        i += decoded.byte_length;
        length += utf16_units(decoded.code_point);
    }
    return length;
}

/// Whether `c` is in JavaScript's `\s` class (WhiteSpace and LineTerminator), which `trim()` also
/// removes.
inline bool is_js_whitespace(char32_t c) {
    return c == 0x09 || c == 0x0A || c == 0x0B || c == 0x0C || c == 0x0D || c == 0x20 ||
           c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 ||
           c == 0x202F || c == 0x205F || c == 0x3000 || c == 0xFEFF;
}

/// Whether `text.trim()` would be empty in JavaScript.
inline bool is_blank(std::string_view text) {
    for (std::size_t i = 0; i < text.size();) {
        const DecodedChar decoded = decode_utf8(text, i);
        if (!is_js_whitespace(decoded.code_point)) {
            return false;
        }
        i += decoded.byte_length;
    }
    return true;
}

} // namespace afd::detail
