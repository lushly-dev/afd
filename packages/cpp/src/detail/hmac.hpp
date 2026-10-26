// Private: HMAC-SHA256 (RFC 2104), unpadded base64url (RFC 4648 §5) and constant-time equality,
// for approval tokens (approval.cpp). Built on sha256.hpp rather than a crypto dependency; the
// tests check it against the RFC 4231 vectors. Not installed.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

#include "detail/sha256.hpp"

namespace afd::detail {

inline Sha256Digest hmac_sha256(std::string_view key, std::string_view data) {
    constexpr std::size_t block_size = 64;
    std::array<std::uint8_t, block_size> block{};
    if (key.size() > block_size) {
        const Sha256Digest hashed = sha256(key);
        for (std::size_t i = 0; i < hashed.size(); ++i) {
            block[i] = hashed[i];
        }
    } else {
        for (std::size_t i = 0; i < key.size(); ++i) {
            block[i] = static_cast<std::uint8_t>(key[i]);
        }
    }
    std::string inner(block_size, '\0');
    std::string outer(block_size + 32, '\0');
    for (std::size_t i = 0; i < block_size; ++i) {
        inner[i] = static_cast<char>(block[i] ^ 0x36U);
        outer[i] = static_cast<char>(block[i] ^ 0x5cU);
    }
    inner.append(data);
    const Sha256Digest inner_digest = sha256(inner);
    for (std::size_t i = 0; i < inner_digest.size(); ++i) {
        outer[block_size + i] = static_cast<char>(inner_digest[i]);
    }
    return sha256(outer);
}

/// Unpadded base64url, as Node.js `Buffer.toString('base64url')` writes it.
inline std::string base64url_encode(std::string_view bytes) {
    static constexpr char alphabet[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    std::string out;
    out.reserve((bytes.size() * 4 + 2) / 3);
    std::size_t i = 0;
    const auto byte = [&](std::size_t k) {
        return static_cast<std::uint32_t>(static_cast<unsigned char>(bytes[k]));
    };
    for (; i + 3 <= bytes.size(); i += 3) {
        const std::uint32_t n = (byte(i) << 16) | (byte(i + 1) << 8) | byte(i + 2);
        out.push_back(alphabet[(n >> 18) & 63U]);
        out.push_back(alphabet[(n >> 12) & 63U]);
        out.push_back(alphabet[(n >> 6) & 63U]);
        out.push_back(alphabet[n & 63U]);
    }
    if (bytes.size() - i == 1) {
        const std::uint32_t n = byte(i) << 16;
        out.push_back(alphabet[(n >> 18) & 63U]);
        out.push_back(alphabet[(n >> 12) & 63U]);
    } else if (bytes.size() - i == 2) {
        const std::uint32_t n = (byte(i) << 16) | (byte(i + 1) << 8);
        out.push_back(alphabet[(n >> 18) & 63U]);
        out.push_back(alphabet[(n >> 12) & 63U]);
        out.push_back(alphabet[(n >> 6) & 63U]);
    }
    return out;
}

inline std::string base64url_encode(const Sha256Digest& digest) {
    return base64url_encode(
        std::string_view(reinterpret_cast<const char*>(digest.data()), digest.size()));
}

/// Strict unpadded base64url: only the 64 alphabet characters, no padding, and zero bits after
/// the last full byte, so every byte string has exactly one accepted spelling.
inline std::optional<std::string> base64url_decode(std::string_view text) {
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
        if (c == '-') {
            return 62;
        }
        if (c == '_') {
            return 63;
        }
        return -1;
    };
    if (text.size() % 4 == 1) {
        return std::nullopt;
    }
    std::string out;
    out.reserve(text.size() * 3 / 4);
    std::uint32_t buffer = 0;
    int bits = 0;
    for (const char c : text) {
        const int v = value(c);
        if (v < 0) {
            return std::nullopt;
        }
        buffer = (buffer << 6) | static_cast<std::uint32_t>(v);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<char>((buffer >> bits) & 0xffU));
        }
    }
    if ((buffer & ((1U << bits) - 1U)) != 0) {
        return std::nullopt;
    }
    return out;
}

/// Equality whose running time depends only on the lengths, which are never secret here.
inline bool constant_time_equal(std::string_view a, std::string_view b) {
    if (a.size() != b.size()) {
        return false;
    }
    unsigned char difference = 0;
    for (std::size_t i = 0; i < a.size(); ++i) {
        difference = static_cast<unsigned char>(
            difference | (static_cast<unsigned char>(a[i]) ^ static_cast<unsigned char>(b[i])));
    }
    return difference == 0;
}

} // namespace afd::detail
