// Private: standard RFC 4648 base64 encoding (with `=` padding) and strict decoding, for MCP
// resource blobs (spec/mcp-resources.md, R4). Not installed.
#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace afd::detail {

/// Standard RFC 4648 base64 encoding with `=` padding.
inline std::string base64_encode(std::string_view bytes) {
    static constexpr char alphabet[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((bytes.size() + 2U) / 3U) * 4U);
    const auto byte = [&](std::size_t k) {
        return static_cast<std::uint32_t>(static_cast<unsigned char>(bytes[k]));
    };
    std::size_t i = 0;
    for (; i + 3U <= bytes.size(); i += 3U) {
        const std::uint32_t n = (byte(i) << 16) | (byte(i + 1U) << 8) | byte(i + 2U);
        out.push_back(alphabet[(n >> 18) & 63U]);
        out.push_back(alphabet[(n >> 12) & 63U]);
        out.push_back(alphabet[(n >> 6) & 63U]);
        out.push_back(alphabet[n & 63U]);
    }
    const std::size_t rem = bytes.size() - i;
    if (rem == 1U) {
        const std::uint32_t n = byte(i) << 16;
        out.push_back(alphabet[(n >> 18) & 63U]);
        out.push_back(alphabet[(n >> 12) & 63U]);
        out.push_back('=');
        out.push_back('=');
    } else if (rem == 2U) {
        const std::uint32_t n = (byte(i) << 16) | (byte(i + 1U) << 8);
        out.push_back(alphabet[(n >> 18) & 63U]);
        out.push_back(alphabet[(n >> 12) & 63U]);
        out.push_back(alphabet[(n >> 6) & 63U]);
        out.push_back('=');
    }
    return out;
}

/// Strict RFC 4648 padded base64 decoding.
inline std::optional<std::string> base64_decode(std::string_view text) {
    const auto value = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') {
            return c - 'A';
        }
        if (c >= 'a' && c <= 'z') {
            return c - 'a' + 26;
        }
        if (c >= '0' && c <= '9') {
            return c - '0' + 52;
        }
        if (c == '+') {
            return 62;
        }
        if (c == '/') {
            return 63;
        }
        return -1;
    };
    if (text.size() % 4U != 0U) {
        return std::nullopt;
    }
    if (text.empty()) {
        return std::string{};
    }
    std::size_t pad = 0;
    if (text.back() == '=') {
        ++pad;
        if (text.size() >= 2U && text[text.size() - 2U] == '=') {
            ++pad;
        }
    }
    std::string out;
    out.reserve((text.size() / 4U) * 3U - pad);
    const std::size_t limit = text.size() - pad;
    std::uint32_t buffer = 0;
    int bits = 0;
    for (std::size_t i = 0; i < limit; ++i) {
        const int v = value(text[i]);
        if (v < 0) {
            return std::nullopt;
        }
        buffer = (buffer << 6) | static_cast<std::uint32_t>(v);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<char>((buffer >> bits) & 0xFFU));
        }
    }
    if (bits >= 6 || (buffer & ((1U << bits) - 1U)) != 0U) {
        return std::nullopt;
    }
    return out;
}

} // namespace afd::detail
