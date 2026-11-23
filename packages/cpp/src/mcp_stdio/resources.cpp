#include "mcp_stdio/resources.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <map>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "detail/base64.hpp"
#include "detail/meta_keys.hpp"
#include "detail/sha256.hpp"
#include "detail/utf8.hpp"
#include "mcp_stdio/frontmatter.hpp"

#if defined(_WIN32)
// Guard macro-hygiene prelude collisions around Windows SDK headers.
#pragma push_macro("min")
#pragma push_macro("max")
#pragma push_macro("interface")
#undef min
#undef max
#undef interface
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#pragma pop_macro("interface")
#pragma pop_macro("max")
#pragma pop_macro("min")
#else
#include <cerrno>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace afd::mcp {
namespace {

constexpr std::size_t max_skill_files = 512U;
constexpr std::uint64_t max_skill_bytes = std::uint64_t{16} << 20;
constexpr std::size_t max_skill_name_len = 64U;
constexpr std::size_t max_skill_description_chars = 1024U;
constexpr std::string_view mcp_app_mime_type = "text/html;profile=mcp-app";

bool is_ascii_alpha(char c) noexcept {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

bool is_ascii_digit(char c) noexcept {
    return c >= '0' && c <= '9';
}

bool is_ascii_lower_alnum(char c) noexcept {
    return (c >= 'a' && c <= 'z') || is_ascii_digit(c);
}

int hex_digit(char c) noexcept {
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

char to_upper_hex(int v) noexcept {
    return v < 10 ? static_cast<char>('0' + v) : static_cast<char>('A' + (v - 10));
}

std::string ascii_lower(std::string_view text) {
    std::string out;
    out.reserve(text.size());
    for (const char c : text) {
        out.push_back((c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c);
    }
    return out;
}

bool is_rfc3986_unreserved(unsigned char c) noexcept {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' ||
           c == '.' || c == '_' || c == '~';
}

bool is_rfc3986_allowed_uri_char(unsigned char c) noexcept {
    if (is_rfc3986_unreserved(c)) {
        return true;
    }
    switch (static_cast<char>(c)) {
    case ':':
    case '/':
    case '?':
    case '#':
    case '[':
    case ']':
    case '@':
    case '!':
    case '$':
    case '&':
    case '\'':
    case '(':
    case ')':
    case '*':
    case '+':
    case ',':
    case ';':
    case '=':
    case '%':
        return true;
    default:
        return false;
    }
}

bool has_whitespace_or_control(std::string_view text) noexcept {
    for (std::size_t i = 0; i < text.size();) {
        const auto ch = afd::detail::decode_utf8(text, i);
        const char32_t cp = ch.code_point;
        if (cp <= 0x20U || cp == 0x7FU || (cp >= 0x80U && cp <= 0x9FU) ||
            afd::detail::is_js_whitespace(cp)) {
            return true;
        }
        i += ch.byte_length;
    }
    return false;
}

std::size_t utf8_code_point_count(std::string_view text) noexcept {
    std::size_t count = 0;
    for (std::size_t i = 0; i < text.size();) {
        const auto ch = afd::detail::decode_utf8(text, i);
        i += ch.byte_length;
        ++count;
    }
    return count;
}

/// Validates an Agent Skills name / skill-path segment (S2): 1..64 chars of `[a-z0-9-]`,
/// no leading or trailing `-`, no `--`.
bool is_valid_skill_segment(std::string_view segment) noexcept {
    if (segment.empty() || segment.size() > max_skill_name_len) {
        return false;
    }
    if (segment.front() == '-' || segment.back() == '-') {
        return false;
    }
    bool prev_dash = false;
    for (const char c : segment) {
        if (c == '-') {
            if (prev_dash) {
                return false;
            }
            prev_dash = true;
        } else if (is_ascii_lower_alnum(c)) {
            prev_dash = false;
        } else {
            return false;
        }
    }
    return true;
}

/// Returns the lowercase RFC 3986 scheme of `uri` if it starts with `<scheme>:`.
std::optional<std::string> uri_scheme_lower(std::string_view uri) {
    const std::size_t colon = uri.find(':');
    if (colon == std::string_view::npos || colon == 0U || !is_ascii_alpha(uri[0])) {
        return std::nullopt;
    }
    for (std::size_t i = 1U; i < colon; ++i) {
        const char c = uri[i];
        if (!is_ascii_alpha(c) && !is_ascii_digit(c) && c != '+' && c != '-' && c != '.') {
            return std::nullopt;
        }
    }
    return ascii_lower(uri.substr(0, colon));
}

/// Validates a URI for R2: absolute RFC 3986 URI with a valid scheme, no whitespace/control
/// characters, legal RFC 3986 URI characters, valid UTF-8, and valid `%XX` escapes.
Expected<std::string> validate_resource_uri(std::string_view uri) {
    if (uri.empty()) {
        return unexpected(std::string("URI must not be empty"));
    }
    if (!afd::detail::is_valid_utf8(uri)) {
        return unexpected(std::string("URI is not valid UTF-8"));
    }
    if (has_whitespace_or_control(uri)) {
        return unexpected(std::string("URI must not contain whitespace or control characters"));
    }
    auto scheme = uri_scheme_lower(uri);
    if (!scheme) {
        return unexpected(std::string("URI must be an absolute RFC 3986 URI with a scheme"));
    }
    const std::size_t colon = uri.find(':');
    for (std::size_t i = colon + 1U; i < uri.size(); ++i) {
        const auto byte = static_cast<unsigned char>(uri[i]);
        if (byte == '%') {
            if (i + 2U >= uri.size() || hex_digit(uri[i + 1U]) < 0 || hex_digit(uri[i + 2U]) < 0) {
                return unexpected(std::string("URI contains an invalid percent-encoding"));
            }
            i += 2U;
            continue;
        }
        if (byte < 0x80U && !is_rfc3986_allowed_uri_char(byte)) {
            return unexpected(std::string("URI contains a character not allowed by RFC 3986"));
        }
    }
    return *scheme;
}

/// Validates and normalizes a skill file path under the S2 file-path and RFC 3986 §6.2.2 manifest
/// boundary rules. Returns the normalized URI `skill://<skill_path>/<normalized_rel>`.
Expected<std::string> normalize_skill_file_uri(std::string_view skill_path,
                                               std::string_view file_path) {
    if (file_path.empty()) {
        return unexpected("file path '" + std::string(file_path) + "' must not be empty");
    }
    if (!afd::detail::is_valid_utf8(file_path)) {
        return unexpected("file path '" + std::string(file_path) + "' is not valid UTF-8");
    }
    if (has_whitespace_or_control(file_path)) {
        return unexpected("file path '" + std::string(file_path) +
                          "' must not contain whitespace or control characters");
    }
    if (file_path.front() == '/' || file_path.back() == '/') {
        return unexpected("file path '" + std::string(file_path) + "' must be relative");
    }
    // Check raw segments: no empty, `.` or `..` segment.
    {
        std::size_t start = 0;
        while (start <= file_path.size()) {
            const std::size_t slash = file_path.find('/', start);
            const std::string_view seg = slash == std::string_view::npos
                                             ? file_path.substr(start)
                                             : file_path.substr(start, slash - start);
            if (seg.empty() || seg == "." || seg == "..") {
                return unexpected("file path '" + std::string(file_path) +
                                  "' contains an empty, '.' or '..' segment");
            }
            if (slash == std::string_view::npos) {
                break;
            }
            start = slash + 1U;
        }
    }

    // RFC 3986 §6.2.2 percent-encoding normalization:
    // - valid `%XX` escapes of unreserved bytes decode to the unreserved character;
    // - valid `%XX` escapes of other bytes normalize hex digits to uppercase;
    // - literal `%` not followed by two hex digits encodes as `%25` (so `50%-off.md` is valid);
    // - non-ASCII UTF-8 bytes and non-URI ASCII characters percent-encode to uppercase `%XX`
    //   (so `café.md` and `caf%C3%A9.md` normalize identically and collide).
    const auto normalize_pct = [](std::string_view part) -> std::string {
        std::string out;
        out.reserve(part.size());
        for (std::size_t i = 0; i < part.size(); ++i) {
            const auto byte = static_cast<unsigned char>(part[i]);
            if (byte == '%') {
                if (i + 2U < part.size()) {
                    const int hi = hex_digit(part[i + 1U]);
                    const int lo = hex_digit(part[i + 2U]);
                    if (hi >= 0 && lo >= 0) {
                        const auto decoded = static_cast<unsigned char>((hi << 4) | lo);
                        if (is_rfc3986_unreserved(decoded)) {
                            out.push_back(static_cast<char>(decoded));
                        } else {
                            out.push_back('%');
                            out.push_back(to_upper_hex(hi));
                            out.push_back(to_upper_hex(lo));
                        }
                        i += 2U;
                        continue;
                    }
                }
                out.append("%25");
                continue;
            }
            if (byte >= 0x80U || !is_rfc3986_allowed_uri_char(byte)) {
                out.push_back('%');
                out.push_back(to_upper_hex(static_cast<int>(byte >> 4)));
                out.push_back(to_upper_hex(static_cast<int>(byte & 0x0FU)));
                continue;
            }
            out.push_back(static_cast<char>(byte));
        }
        return out;
    };

    const std::size_t q_or_h = file_path.find_first_of("?#");
    const std::string_view raw_path =
        q_or_h == std::string_view::npos ? file_path : file_path.substr(0, q_or_h);
    const std::string_view raw_tail =
        q_or_h == std::string_view::npos ? std::string_view{} : file_path.substr(q_or_h);

    const std::string norm_path = normalize_pct(raw_path);
    const std::string norm_tail = normalize_pct(raw_tail);

    // Inspect decoded segments before dot removal: last segment must not be empty, `.` or `..`,
    // and resolving `.` and `..` must never leave the skill's directory.
    std::vector<std::string> resolved;
    std::string_view last_seg;
    {
        std::size_t start = 0;
        while (start <= norm_path.size()) {
            const std::size_t slash = norm_path.find('/', start);
            const std::string_view seg =
                slash == std::string_view::npos
                    ? std::string_view(norm_path).substr(start)
                    : std::string_view(norm_path).substr(start, slash - start);
            last_seg = seg;
            if (seg == "..") {
                if (resolved.empty()) {
                    return unexpected("file path '" + std::string(file_path) +
                                      "' escapes the skill directory after RFC 3986 normalization");
                }
                resolved.pop_back();
            } else if (seg == ".") {
                // Current directory segment: no-op unless it is the last segment (checked below).
            } else if (!seg.empty()) {
                resolved.emplace_back(seg);
            } else {
                return unexpected("file path '" + std::string(file_path) +
                                  "' has an empty path segment");
            }
            if (slash == std::string_view::npos) {
                break;
            }
            start = slash + 1U;
        }
    }
    if (last_seg.empty() || last_seg == "." || last_seg == ".." || resolved.empty()) {
        return unexpected("file path '" + std::string(file_path) +
                          "' has a trailing empty, '.' or '..' segment");
    }

    std::string uri = "skill://" + std::string(skill_path);
    for (const auto& seg : resolved) {
        uri.push_back('/');
        uri.append(seg);
    }
    uri.append(norm_tail);
    return uri;
}

/// MIME type for a skill file by suffix, compared case-insensitively (`spec/mcp-resources.md`, S5).
std::string skill_file_mime_type(std::string_view path) {
    const std::size_t slash = path.rfind('/');
    const std::string_view filename =
        slash == std::string_view::npos ? path : path.substr(slash + 1U);
    const std::size_t dot = filename.rfind('.');
    if (dot == std::string_view::npos || dot + 1U >= filename.size()) {
        return "application/octet-stream";
    }
    const std::string ext = ascii_lower(filename.substr(dot));
    if (ext == ".md") {
        return "text/markdown";
    }
    if (ext == ".txt") {
        return "text/plain";
    }
    if (ext == ".json") {
        return "application/json";
    }
    if (ext == ".yaml" || ext == ".yml") {
        return "application/yaml";
    }
    if (ext == ".toml") {
        return "application/toml";
    }
    if (ext == ".csv") {
        return "text/csv";
    }
    if (ext == ".html") {
        return "text/html";
    }
    if (ext == ".css") {
        return "text/css";
    }
    if (ext == ".js" || ext == ".mjs") {
        return "text/javascript";
    }
    if (ext == ".ts") {
        return "text/x-typescript";
    }
    if (ext == ".py") {
        return "text/x-python";
    }
    if (ext == ".sh") {
        return "text/x-shellscript";
    }
    if (ext == ".svg") {
        return "image/svg+xml";
    }
    if (ext == ".png") {
        return "image/png";
    }
    if (ext == ".jpg" || ext == ".jpeg") {
        return "image/jpeg";
    }
    if (ext == ".gif") {
        return "image/gif";
    }
    if (ext == ".pdf") {
        return "application/pdf";
    }
    return "application/octet-stream";
}

std::optional<std::string> validate_icons(std::string_view label, const Json& icons) {
    if (!icons.is_array() || !afd::detail::is_valid_json_value(icons)) {
        return std::string(label) + ": icons must be a valid JSON array";
    }
    for (const auto& icon : icons) {
        if (!icon.is_object()) {
            return std::string(label) + ": each icon must be a JSON object";
        }
        const auto src = icon.find("src");
        if (src == icon.end() || !src->is_string() || src->get_ref<const std::string&>().empty()) {
            return std::string(label) + ": each icon must have a non-empty string 'src'";
        }
        if (const auto mime = icon.find("mimeType"); mime != icon.end() && !mime->is_string()) {
            return std::string(label) + ": icon 'mimeType' must be a string";
        }
        if (const auto sizes = icon.find("sizes"); sizes != icon.end()) {
            if (!sizes->is_array()) {
                return std::string(label) + ": icon 'sizes' must be an array of strings";
            }
            for (const auto& sz : *sizes) {
                if (!sz.is_string()) {
                    return std::string(label) + ": icon 'sizes' must contain only strings";
                }
            }
        }
        if (const auto theme = icon.find("theme"); theme != icon.end()) {
            if (!theme->is_string() || (theme->get_ref<const std::string&>() != "light" &&
                                        theme->get_ref<const std::string&>() != "dark")) {
                return std::string(label) + ": icon 'theme' must be \"light\" or \"dark\"";
            }
        }
    }
    return std::nullopt;
}

std::optional<std::string> validate_annotations(std::string_view label, const Json& annotations) {
    if (!annotations.is_object() || !afd::detail::is_valid_json_value(annotations)) {
        return std::string(label) + ": annotations must be a valid JSON object";
    }
    if (const auto audience = annotations.find("audience"); audience != annotations.end()) {
        if (!audience->is_array()) {
            return std::string(label) + ": annotations.audience must be an array";
        }
        for (const auto& role : *audience) {
            if (!role.is_string() || (role.get_ref<const std::string&>() != "user" &&
                                      role.get_ref<const std::string&>() != "assistant")) {
                return std::string(label) +
                       ": annotations.audience items must be \"user\" or \"assistant\"";
            }
        }
    }
    if (const auto priority = annotations.find("priority"); priority != annotations.end()) {
        if (!priority->is_number()) {
            return std::string(label) + ": annotations.priority must be a number in [0, 1]";
        }
        const double p = priority->get<double>();
        if (!std::isfinite(p) || p < 0.0 || p > 1.0) {
            return std::string(label) + ": annotations.priority must be between 0 and 1";
        }
    }
    if (const auto modified = annotations.find("lastModified"); modified != annotations.end()) {
        if (!modified->is_string() || modified->get_ref<const std::string&>().empty()) {
            return std::string(label) + ": annotations.lastModified must be a non-empty string";
        }
    }
    return std::nullopt;
}

/// Validates one provider `ResourceEntry` against R2 and serializes it to JSON.
/// When `computed_digest` is provided, sets `size` and `_meta["dev.afd/digest"]`.
Expected<Json> validate_and_serialize_entry(const ResourceEntry& entry,
                                            std::optional<std::uint64_t> known_size,
                                            std::optional<std::string_view> computed_digest) {
    const std::string label =
        "Resource entry '" + (entry.uri.empty() ? entry.name : entry.uri) + "'";
    auto scheme = validate_resource_uri(entry.uri);
    if (!scheme) {
        return unexpected(label + ": " + scheme.error());
    }
    if (*scheme == "skill") {
        return unexpected(label + ": provider entries must not use the 'skill://' scheme");
    }
    if (*scheme == "ui" && (!entry.mime_type || *entry.mime_type != mcp_app_mime_type)) {
        return unexpected(label + ": 'ui://' entries must have mimeType '" +
                          std::string(mcp_app_mime_type) + "'");
    }
    if (entry.name.empty() || !afd::detail::is_valid_utf8(entry.name)) {
        return unexpected(label + ": name must be a non-empty UTF-8 string");
    }
    if (entry.title && !afd::detail::is_valid_utf8(*entry.title)) {
        return unexpected(label + ": title must be valid UTF-8");
    }
    if (entry.description && !afd::detail::is_valid_utf8(*entry.description)) {
        return unexpected(label + ": description must be valid UTF-8");
    }
    if (entry.mime_type && !afd::detail::is_valid_utf8(*entry.mime_type)) {
        return unexpected(label + ": mimeType must be valid UTF-8");
    }
    if (entry.icons) {
        if (auto problem = validate_icons(label, *entry.icons)) {
            return unexpected(std::move(*problem));
        }
    }
    if (entry.annotations) {
        if (auto problem = validate_annotations(label, *entry.annotations)) {
            return unexpected(std::move(*problem));
        }
    }
    if (entry.meta) {
        if (auto problem = afd::detail::validate_meta_object(label, *entry.meta, false)) {
            return unexpected(std::move(*problem));
        }
    }
    if (known_size && entry.size && *entry.size != *known_size) {
        return unexpected(label + ": declared size (" + std::to_string(*entry.size) +
                          ") does not match content length (" + std::to_string(*known_size) + ")");
    }

    Json out{{"uri", entry.uri}, {"name", entry.name}};
    if (entry.title) {
        out["title"] = *entry.title;
    }
    if (entry.description) {
        out["description"] = *entry.description;
    }
    if (entry.mime_type) {
        out["mimeType"] = *entry.mime_type;
    }
    if (known_size) {
        out["size"] = *known_size;
    } else if (entry.size) {
        out["size"] = *entry.size;
    }
    if (entry.icons) {
        out["icons"] = *entry.icons;
    }
    if (entry.annotations) {
        out["annotations"] = *entry.annotations;
    }
    Json meta = Json::object();
    if (entry.meta && entry.meta->is_object()) {
        meta = *entry.meta;
    }
    if (computed_digest) {
        meta[std::string(digest_meta_key)] = std::string(*computed_digest);
    }
    if (!meta.empty()) {
        out["_meta"] = std::move(meta);
    }
    return out;
}

Json build_content_item(std::string_view uri, const std::optional<std::string>& mime_type,
                        std::string_view bytes, const std::optional<Json>& content_meta) {
    Json item{{"uri", std::string(uri)}};
    if (mime_type) {
        item["mimeType"] = *mime_type;
    }
    if (afd::detail::is_valid_utf8(bytes)) {
        item["text"] = std::string(bytes);
    } else {
        item["blob"] = afd::detail::base64_encode(bytes);
    }
    if (content_meta && content_meta->is_object() && !content_meta->empty()) {
        item["_meta"] = *content_meta;
    }
    return item;
}

bool path_is_within(const std::filesystem::path& target, const std::filesystem::path& root) {
    auto root_it = root.begin();
    auto target_it = target.begin();
    for (; root_it != root.end(); ++root_it, ++target_it) {
        if (target_it == target.end() || *target_it != *root_it) {
            return false;
        }
    }
    return true;
}

std::string u8path_to_string(const std::filesystem::path& path) {
    const auto u8 = path.generic_u8string();
    return std::string(reinterpret_cast<const char*>(u8.data()), u8.size());
}

#if defined(_WIN32)
/// Returns the normalized Win32 final path of an open handle, or `std::nullopt` on failure.
std::optional<std::filesystem::path> handle_final_path(HANDLE handle) {
    const DWORD needed = GetFinalPathNameByHandleW(handle, nullptr, 0, FILE_NAME_NORMALIZED);
    if (needed == 0) {
        return std::nullopt;
    }
    std::wstring buf(needed, L'\0');
    const DWORD written =
        GetFinalPathNameByHandleW(handle, buf.data(), needed, FILE_NAME_NORMALIZED);
    if (written == 0 || written >= needed) {
        return std::nullopt;
    }
    buf.resize(written);
    return std::filesystem::path(std::move(buf));
}

/// Opens `resolved` without following reparse points, verifies containment and regular-file type
/// on the opened handle itself (closing TOCTOU), and reads up to `remaining_bytes`.
Expected<std::string> read_confined_file(const std::filesystem::path& resolved,
                                         const std::filesystem::path& root_final,
                                         std::uint64_t remaining_bytes, std::string_view skill_path,
                                         std::string_view rel) {
    const HANDLE handle =
        CreateFileW(resolved.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (handle == INVALID_HANDLE_VALUE) {
        return unexpected("Skill '" + std::string(skill_path) + "' entry '" + std::string(rel) +
                          "': failed to open file");
    }
    struct HandleGuard {
        HANDLE h;
        ~HandleGuard() { CloseHandle(h); }
    } const guard{handle};

    if (GetFileType(handle) != FILE_TYPE_DISK) {
        return unexpected("Skill '" + std::string(skill_path) + "' entry '" + std::string(rel) +
                          "': only regular files are allowed in a skill directory");
    }
    BY_HANDLE_FILE_INFORMATION info{};
    if (!GetFileInformationByHandle(handle, &info)) {
        return unexpected("Skill '" + std::string(skill_path) + "' entry '" + std::string(rel) +
                          "': failed to inspect opened file");
    }
    if ((info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
        (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
        return unexpected("Skill '" + std::string(skill_path) + "' entry '" + std::string(rel) +
                          "': only regular files are allowed in a skill directory");
    }
    const auto opened_path = handle_final_path(handle);
    if (!opened_path || !path_is_within(*opened_path, root_final)) {
        return unexpected("Skill '" + std::string(skill_path) + "' entry '" + std::string(rel) +
                          "': file leaves the skill directory");
    }
    const std::uint64_t file_size = (static_cast<std::uint64_t>(info.nFileSizeHigh) << 32) |
                                    static_cast<std::uint64_t>(info.nFileSizeLow);
    if (file_size > remaining_bytes) {
        return unexpected("Skill '" + std::string(skill_path) + "': exceeds the limit of 16 MiB");
    }

    std::string bytes;
    bytes.reserve(static_cast<std::size_t>(file_size));
    char buf[8192];
    std::uint64_t read_total = 0;
    while (true) {
        DWORD got = 0;
        if (!ReadFile(handle, buf, static_cast<DWORD>(sizeof(buf)), &got, nullptr)) {
            return unexpected("Skill '" + std::string(skill_path) + "' entry '" + std::string(rel) +
                              "': failed while reading file");
        }
        if (got == 0) {
            break;
        }
        const auto chunk = static_cast<std::uint64_t>(got);
        if (chunk > remaining_bytes - read_total) {
            return unexpected("Skill '" + std::string(skill_path) +
                              "': exceeds the limit of 16 MiB");
        }
        bytes.append(buf, static_cast<std::size_t>(got));
        read_total += chunk;
    }
    return bytes;
}
#else
/// Opens `resolved` without following symlinks (`O_NOFOLLOW`), verifies regular-file type and
/// inode identity via `fstat` on the opened descriptor (closing TOCTOU), and reads directly from
/// that descriptor.
Expected<std::string> read_confined_file(const std::filesystem::path& resolved,
                                         const std::filesystem::path& root,
                                         std::uint64_t remaining_bytes, std::string_view skill_path,
                                         std::string_view rel) {
    const int fd = ::open(resolved.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    if (fd < 0) {
        return unexpected("Skill '" + std::string(skill_path) + "' entry '" + std::string(rel) +
                          "': failed to open regular file inside skill directory");
    }
    struct FdGuard {
        int descriptor;
        ~FdGuard() { ::close(descriptor); }
    } const guard{fd};

    struct stat st{};
    if (::fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
        return unexpected("Skill '" + std::string(skill_path) + "' entry '" + std::string(rel) +
                          "': only regular files are allowed in a skill directory");
    }
    // Re-verify the canonical path stays within root and resolves to the exact same inode.
    std::error_code ec;
    const auto rechecked = std::filesystem::canonical(resolved, ec);
    struct stat path_st{};
    if (ec || !path_is_within(rechecked, root) || ::lstat(rechecked.c_str(), &path_st) != 0 ||
        path_st.st_dev != st.st_dev || path_st.st_ino != st.st_ino) {
        return unexpected("Skill '" + std::string(skill_path) + "' entry '" + std::string(rel) +
                          "': file changed or left the skill directory during read");
    }
    const auto file_size = st.st_size > 0 ? static_cast<std::uint64_t>(st.st_size) : 0U;
    if (file_size > remaining_bytes) {
        return unexpected("Skill '" + std::string(skill_path) + "': exceeds the limit of 16 MiB");
    }

    std::string bytes;
    bytes.reserve(static_cast<std::size_t>(file_size));
    char buf[8192];
    std::uint64_t read_total = 0;
    while (true) {
        const ssize_t got = ::read(fd, buf, sizeof(buf));
        if (got < 0) {
            if (errno == EINTR) {
                continue;
            }
            return unexpected("Skill '" + std::string(skill_path) + "' entry '" + std::string(rel) +
                              "': failed while reading file");
        }
        if (got == 0) {
            break;
        }
        const auto chunk = static_cast<std::uint64_t>(got);
        if (chunk > remaining_bytes - read_total) {
            return unexpected("Skill '" + std::string(skill_path) +
                              "': exceeds the limit of 16 MiB");
        }
        bytes.append(buf, static_cast<std::size_t>(got));
        read_total += chunk;
    }
    return bytes;
}
#endif

} // namespace

Expected<Skill> skill_from_directory(std::string_view skill_path, std::string_view directory) {
    if (!afd::detail::is_valid_utf8(skill_path)) {
        return unexpected(std::string("Skill path is not valid UTF-8"));
    }
    if (directory.empty() || !afd::detail::is_valid_utf8(directory)) {
        return unexpected("Skill '" + std::string(skill_path) +
                          "': directory path must be non-empty valid UTF-8");
    }
    std::error_code ec;
    const std::filesystem::path dir_path(
        std::u8string_view(reinterpret_cast<const char8_t*>(directory.data()), directory.size()));
    const auto root = std::filesystem::canonical(dir_path, ec);
    if (ec || !std::filesystem::is_directory(root, ec) || ec) {
        return unexpected("Skill '" + std::string(skill_path) +
                          "': directory does not exist or is not readable");
    }

#if defined(_WIN32)
    // Resolve the Win32 normalized handle path of root once for handle-level containment checks.
    const HANDLE root_handle = CreateFileW(
        root.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (root_handle == INVALID_HANDLE_VALUE) {
        return unexpected("Skill '" + std::string(skill_path) +
                          "': failed to inspect skill root directory");
    }
    const auto root_final = handle_final_path(root_handle);
    CloseHandle(root_handle);
    if (!root_final) {
        return unexpected("Skill '" + std::string(skill_path) +
                          "': failed to resolve skill root directory");
    }
#endif

    Skill skill;
    skill.path = std::string(skill_path);
    std::uint64_t total_bytes = 0;

    std::vector<std::filesystem::path> stack{root};
    while (!stack.empty()) {
        const std::filesystem::path current = std::move(stack.back());
        stack.pop_back();

        std::filesystem::directory_iterator it(current, ec);
        if (ec) {
            return unexpected("Skill '" + std::string(skill_path) +
                              "': failed to read skill directory");
        }
        for (const std::filesystem::directory_iterator end; it != end; it.increment(ec)) {
            if (ec) {
                return unexpected("Skill '" + std::string(skill_path) +
                                  "': error iterating skill directory");
            }
            const std::filesystem::path entry_path = it->path();
            const std::filesystem::path rel_path = entry_path.lexically_relative(root);
            const std::string rel = u8path_to_string(rel_path);

            const auto sym_status = std::filesystem::symlink_status(entry_path, ec);
            if (ec) {
                return unexpected("Skill '" + std::string(skill_path) + "' entry '" + rel +
                                  "': failed to stat entry");
            }
            const bool is_link = std::filesystem::is_symlink(sym_status);
            const auto resolved = std::filesystem::canonical(entry_path, ec);
            if (ec || !path_is_within(resolved, root)) {
                return unexpected("Skill '" + std::string(skill_path) + "' entry '" + rel +
                                  "': symbolic link or reparse point leaves the skill directory");
            }
            const auto target_status = std::filesystem::status(resolved, ec);
            if (ec) {
                return unexpected("Skill '" + std::string(skill_path) + "' entry '" + rel +
                                  "': failed to inspect target");
            }
            if (std::filesystem::is_directory(target_status)) {
                // Deterministically refuse any symlink or junction pointing to a directory
                // (matching Rust and TypeScript).
                if (is_link || resolved != entry_path) {
                    return unexpected("Skill '" + std::string(skill_path) + "' entry '" + rel +
                                      "': symbolic link or junction to a directory is not allowed");
                }
                stack.push_back(resolved);
                continue;
            }
            if (!std::filesystem::is_regular_file(target_status)) {
                return unexpected("Skill '" + std::string(skill_path) + "' entry '" + rel +
                                  "': only regular files are allowed in a skill directory");
            }
            if (skill.files.size() >= max_skill_files) {
                return unexpected("Skill '" + std::string(skill_path) +
                                  "': exceeds the limit of 512 files");
            }

            auto bytes = read_confined_file(resolved,
#if defined(_WIN32)
                                            *root_final,
#else
                                            root,
#endif
                                            max_skill_bytes - total_bytes, skill_path, rel);
            if (!bytes) {
                return unexpected(bytes.error());
            }
            total_bytes += static_cast<std::uint64_t>(bytes->size());
            skill.files.push_back(SkillFile{.path = rel, .bytes = std::move(*bytes)});
        }
        // Check `ec` after the loop in case `it.increment(ec)` set an error and moved `it` to
        // `end`.
        if (ec) {
            return unexpected("Skill '" + std::string(skill_path) +
                              "': error iterating skill directory");
        }
    }
    return skill;
}

namespace surface {

Expected<ResourceService> ResourceService::create(std::optional<ResourceProvider> resources,
                                                  std::optional<SkillCatalog> skills) {
    ResourceService svc;
    svc.has_resources_ = resources.has_value() || skills.has_value();
    svc.has_skills_ = skills.has_value();
    svc.directory_read_ = skills.has_value() && skills->directory_read;

    // 1. Validate static and dynamic resource providers (R2, R6).
    std::set<std::string> seen_uris;
    if (resources) {
        for (auto& sr : resources->static_resources) {
            const std::string digest = "sha256:" + afd::detail::sha256_hex(sr.bytes);
            auto entry_json = validate_and_serialize_entry(
                sr.entry, static_cast<std::uint64_t>(sr.bytes.size()), digest);
            if (!entry_json) {
                return unexpected(entry_json.error());
            }
            if (sr.content_meta) {
                if (auto problem = afd::detail::validate_meta_object(
                        "Resource content '" + sr.entry.uri + "'", *sr.content_meta, true)) {
                    return unexpected(std::move(*problem));
                }
            }
            if (!seen_uris.insert(sr.entry.uri).second) {
                return unexpected("Duplicate resource URI '" + sr.entry.uri + "'");
            }
            const std::size_t idx = svc.static_resources_.size();
            svc.static_index_.emplace(sr.entry.uri, idx);
            svc.static_resources_.push_back(StoredStatic{
                .entry_json = std::move(*entry_json),
                .bytes = std::move(sr.bytes),
                .mime_type = sr.entry.mime_type,
                .content_meta = std::move(sr.content_meta),
            });
        }
        svc.dynamic_list_ = std::move(resources->list);
        svc.dynamic_read_ = std::move(resources->read);
        if (svc.dynamic_list_) {
            auto listed = svc.dynamic_list_();
            if (!listed) {
                return unexpected("Resource provider list failed at startup: " + listed.error());
            }
            for (const auto& entry : *listed) {
                auto entry_json = validate_and_serialize_entry(entry, std::nullopt, std::nullopt);
                if (!entry_json) {
                    return unexpected(entry_json.error());
                }
                if (!seen_uris.insert(entry.uri).second) {
                    return unexpected("Duplicate resource URI '" + entry.uri + "'");
                }
            }
        }
    }

    // 2. Validate and freeze the SkillCatalog (S2, S3, S5, S6).
    if (skills) {
        std::set<std::string> seen_skill_paths;
        std::set<std::string> seen_skill_names;
        std::set<std::string> catalog_normalized_uris;
        std::set<std::string> catalog_file_uris;
        std::set<std::string> catalog_dir_uris;

        for (auto& skill : skills->skills) {
            const std::string skill_label = "Skill '" + skill.path + "'";
            if (skill.path.empty() || !afd::detail::is_valid_utf8(skill.path)) {
                return unexpected(skill_label + ": skill path must be non-empty UTF-8");
            }
            // Validate every segment of skill.path and extract the last segment.
            std::string_view last_segment;
            {
                std::size_t start = 0;
                while (start <= skill.path.size()) {
                    const std::size_t slash = skill.path.find('/', start);
                    const std::string_view seg =
                        slash == std::string_view::npos
                            ? std::string_view(skill.path).substr(start)
                            : std::string_view(skill.path).substr(start, slash - start);
                    if (!is_valid_skill_segment(seg)) {
                        return unexpected(skill_label + ": invalid skill path segment '" +
                                          std::string(seg) + "'");
                    }
                    last_segment = seg;
                    if (slash == std::string_view::npos) {
                        break;
                    }
                    start = slash + 1U;
                }
            }
            if (!seen_skill_paths.insert(skill.path).second) {
                return unexpected(skill_label + ": duplicate skill path in catalog");
            }
            if (skill.files.size() > max_skill_files) {
                return unexpected(skill_label + ": exceeds the limit of 512 files");
            }

            // Validate every file path, manifest boundary, total bytes, and locate SKILL.md.
            std::uint64_t total_bytes = 0;
            std::set<std::string> seen_file_paths;
            std::map<std::string, std::string> skill_norm_to_path;
            const SkillFile* skill_md = nullptr;

            for (const auto& file : skill.files) {
                if (!seen_file_paths.insert(file.path).second) {
                    return unexpected(skill_label + ": duplicate file path '" + file.path + "'");
                }
                auto normalized_uri = normalize_skill_file_uri(skill.path, file.path);
                if (!normalized_uri) {
                    return unexpected(skill_label + ": " + normalized_uri.error());
                }
                if (const auto dup = skill_norm_to_path.find(*normalized_uri);
                    dup != skill_norm_to_path.end()) {
                    return unexpected(skill_label + ": file '" + file.path + "' collides with '" +
                                      dup->second + "' after RFC 3986 normalization");
                }
                if (!catalog_normalized_uris.insert(*normalized_uri).second) {
                    return unexpected(skill_label + ": file '" + file.path +
                                      "' collides with another skill URI after RFC 3986 "
                                      "normalization");
                }
                skill_norm_to_path.emplace(*normalized_uri, file.path);

                const auto sz = static_cast<std::uint64_t>(file.bytes.size());
                if (sz > max_skill_bytes || sz > max_skill_bytes - total_bytes) {
                    return unexpected(skill_label + ": exceeds the limit of 16 MiB");
                }
                total_bytes += sz;

                if (file.path == "SKILL.md") {
                    skill_md = &file;
                }
            }
            if (skill_md == nullptr) {
                return unexpected(skill_label + ": missing required SKILL.md at root");
            }

            // Parse and validate frontmatter (S2).
            auto frontmatter = parse_skill_frontmatter(skill_md->bytes);
            if (!frontmatter) {
                return unexpected(skill_label + ": " + frontmatter.error());
            }
            const auto name_it = frontmatter->find("name");
            if (name_it == frontmatter->end() || !name_it->is_string()) {
                return unexpected(skill_label + ": frontmatter 'name' must be a string");
            }
            const std::string& fm_name = name_it->get_ref<const std::string&>();
            if (!is_valid_skill_segment(fm_name)) {
                return unexpected(skill_label + ": invalid frontmatter name '" + fm_name + "'");
            }
            if (fm_name != last_segment) {
                return unexpected(skill_label + ": frontmatter name '" + fm_name +
                                  "' does not match path's last segment '" +
                                  std::string(last_segment) + "'");
            }
            if (!seen_skill_names.insert(fm_name).second) {
                return unexpected("Duplicate skill name '" + fm_name + "' in catalog (" +
                                  skill.path + ")");
            }

            const auto desc_it = frontmatter->find("description");
            if (desc_it == frontmatter->end() || !desc_it->is_string()) {
                return unexpected(skill_label + ": frontmatter 'description' must be a string");
            }
            const std::string& fm_desc = desc_it->get_ref<const std::string&>();
            if (fm_desc.empty() || utf8_code_point_count(fm_desc) > max_skill_description_chars) {
                return unexpected(skill_label +
                                  ": frontmatter 'description' must be 1 to 1024 characters");
            }

            // Check file-vs-directory and cross-skill directory URI collisions regardless of
            // whether `directory_read` is enabled (S2, S6).
            const std::string skill_root_uri = "skill://" + skill.path;
            std::set<std::string> skill_dir_uris{skill_root_uri};
            std::set<std::string> skill_file_uris;
            for (const auto& file : skill.files) {
                const std::string uri = skill_root_uri + "/" + file.path;
                skill_file_uris.insert(uri);
                std::size_t slash = file.path.rfind('/');
                while (slash != std::string::npos) {
                    const std::string prefix = file.path.substr(0, slash);
                    skill_dir_uris.insert(skill_root_uri + "/" + prefix);
                    slash = prefix.rfind('/');
                }
            }
            for (const auto& dir_uri : skill_dir_uris) {
                if (skill_file_uris.count(dir_uri) > 0U || catalog_file_uris.count(dir_uri) > 0U) {
                    return unexpected(skill_label + ": directory URI '" + dir_uri +
                                      "' collides with a file URI");
                }
                if (!catalog_dir_uris.insert(dir_uri).second) {
                    return unexpected(skill_label + ": directory URI '" + dir_uri +
                                      "' collides with another skill's directory");
                }
            }
            for (const auto& file_uri : skill_file_uris) {
                if (catalog_dir_uris.count(file_uri) > 0U) {
                    return unexpected(skill_label + ": file URI '" + file_uri +
                                      "' collides with a directory URI");
                }
                catalog_file_uris.insert(file_uri);
            }

            // Sort files: SKILL.md first, then ascending UTF-8 byte order of file path (S3, S5).
            std::vector<SkillFile*> ordered;
            ordered.reserve(skill.files.size());
            for (auto& file : skill.files) {
                ordered.push_back(&file);
            }
            std::sort(ordered.begin(), ordered.end(), [](const SkillFile* a, const SkillFile* b) {
                if (a->path == "SKILL.md") {
                    return b->path != "SKILL.md";
                }
                if (b->path == "SKILL.md") {
                    return false;
                }
                return a->path < b->path;
            });

            Json manifest = Json::array();
            // Directory map for S6: dir_uri -> (segment_name -> child resource JSON).
            std::map<std::string, std::map<std::string, Json>> skill_dirs;

            for (auto* file : ordered) {
                const std::string uri = skill_root_uri + "/" + file->path;
                const std::string digest = "sha256:" + afd::detail::sha256_hex(file->bytes);
                const auto size = static_cast<std::uint64_t>(file->bytes.size());
                const std::string mime = skill_file_mime_type(file->path);

                manifest.push_back(Json{{"uri", uri}, {"digest", digest}, {"size", size}});

                Json resource{
                    {"uri", uri},
                    {"name", file->path == "SKILL.md" ? fm_name : file->path},
                    {"mimeType", mime},
                    {"size", size},
                    {"_meta", {{std::string(digest_meta_key), digest}}},
                };
                if (file->path == "SKILL.md") {
                    resource["description"] = fm_desc;
                }

                // Register file and intermediate subdirectories in S6 directory map.
                if (svc.directory_read_) {
                    std::size_t slash = file->path.rfind('/');
                    if (slash == std::string::npos) {
                        skill_dirs[skill_root_uri][file->path] = resource;
                    } else {
                        const std::string parent_rel = file->path.substr(0, slash);
                        const std::string leaf = file->path.substr(slash + 1U);
                        skill_dirs[skill_root_uri + "/" + parent_rel][leaf] = resource;

                        // Ensure every ancestor directory lists its child subdirectory.
                        std::string cur_rel = parent_rel;
                        while (!cur_rel.empty()) {
                            const std::size_t pslash = cur_rel.rfind('/');
                            const std::string dir_uri = skill_root_uri + "/" + cur_rel;
                            const std::string seg_name =
                                pslash == std::string::npos ? cur_rel : cur_rel.substr(pslash + 1U);
                            const std::string up_uri =
                                pslash == std::string::npos
                                    ? skill_root_uri
                                    : skill_root_uri + "/" + cur_rel.substr(0, pslash);
                            skill_dirs[up_uri].emplace(seg_name,
                                                       Json{{"uri", dir_uri},
                                                            {"name", seg_name},
                                                            {"mimeType", "inode/directory"}});
                            if (pslash == std::string::npos) {
                                break;
                            }
                            cur_rel = cur_rel.substr(0, pslash);
                        }
                    }
                }

                const std::size_t file_idx = svc.skill_files_.size();
                svc.skill_file_by_uri_.emplace(uri, file_idx);
                svc.skill_files_.push_back(StoredSkillFile{
                    .uri = uri,
                    .bytes = std::move(file->bytes),
                    .mime_type = mime,
                    .resource_json = std::move(resource),
                });
            }

            if (svc.directory_read_) {
                for (auto& [dir_uri, children] : skill_dirs) {
                    Json arr = Json::array();
                    // std::map<std::string, Json> iterates in ascending UTF-8 byte order of
                    // segment.
                    for (auto& [seg_name, child] : children) {
                        (void)seg_name;
                        arr.push_back(std::move(child));
                    }
                    if (!svc.directories_.emplace(dir_uri, std::move(arr)).second) {
                        return unexpected(skill_label + ": duplicate directory URI '" + dir_uri +
                                          "'");
                    }
                }
            }

            const std::string skill_uri = skill_root_uri + "/SKILL.md";
            const std::size_t skill_idx = svc.skills_list_json_.size();
            svc.skill_by_uri_.emplace(skill_uri, skill_idx);
            svc.skills_list_json_.push_back(Json{
                {"uri", skill_uri},
                {"frontmatter", std::move(*frontmatter)},
                {"resources", std::move(manifest)},
            });
        }
    }

    return svc;
}

RpcOutcome ResourceService::list_resources() const {
    Json list = Json::array();
    std::set<std::string> seen_uris;
    for (const auto& sr : static_resources_) {
        list.push_back(sr.entry_json);
        seen_uris.insert(sr.entry_json["uri"].get<std::string>());
    }
    if (dynamic_list_) {
        auto listed = dynamic_list_();
        if (!listed) {
            return RpcOutcome::error(-32603, "Resource provider list failed: " + listed.error());
        }
        for (const auto& entry : *listed) {
            auto entry_json = validate_and_serialize_entry(entry, std::nullopt, std::nullopt);
            if (!entry_json) {
                return RpcOutcome::error(-32603, entry_json.error());
            }
            if (!seen_uris.insert(entry.uri).second) {
                return RpcOutcome::error(-32603, "Duplicate resource URI '" + entry.uri + "'");
            }
            list.push_back(std::move(*entry_json));
        }
    }
    for (const auto& sf : skill_files_) {
        list.push_back(sf.resource_json);
    }
    return RpcOutcome::value(Json{{"resources", std::move(list)}});
}

RpcOutcome ResourceService::read_resource(std::string_view uri) const {
    if (const auto it = static_index_.find(uri); it != static_index_.end()) {
        const auto& sr = static_resources_[it->second];
        return RpcOutcome::value(Json{
            {"contents",
             Json::array({build_content_item(uri, sr.mime_type, sr.bytes, sr.content_meta)})}});
    }
    if (const auto it = skill_file_by_uri_.find(uri); it != skill_file_by_uri_.end()) {
        const auto& sf = skill_files_[it->second];
        return RpcOutcome::value(
            Json{{"contents",
                  Json::array({build_content_item(uri, sf.mime_type, sf.bytes, std::nullopt)})}});
    }
    // R2 & R4: `skill://` belongs exclusively to the skill catalog and must never fall through
    // to a dynamic resource provider.
    if (const auto scheme = uri_scheme_lower(uri); scheme && *scheme == "skill") {
        return RpcOutcome::error(-32602, "Resource not found", Json{{"uri", std::string(uri)}});
    }
    if (dynamic_read_) {
        auto read_res = dynamic_read_(uri);
        if (!read_res) {
            return RpcOutcome::error(-32603, "Resource provider read failed: " + read_res.error());
        }
        if (read_res->has_value()) {
            const auto& content = **read_res;
            if (content.meta) {
                if (auto problem = afd::detail::validate_meta_object(
                        "Resource content '" + std::string(uri) + "'", *content.meta, true)) {
                    return RpcOutcome::error(-32603, std::move(*problem));
                }
            }
            // R4: the listed entry's `mimeType` takes precedence when set.
            std::optional<std::string> mime = content.mime_type;
            if (dynamic_list_) {
                auto listed = dynamic_list_();
                if (!listed) {
                    return RpcOutcome::error(-32603,
                                             "Resource provider list failed: " + listed.error());
                }
                for (const auto& entry : *listed) {
                    if (entry.uri == uri) {
                        if (entry.size &&
                            static_cast<std::uint64_t>(content.bytes.size()) != *entry.size) {
                            return RpcOutcome::error(
                                -32603, "Resource '" + std::string(uri) + "' returned " +
                                            std::to_string(content.bytes.size()) +
                                            " bytes, expected listed size " +
                                            std::to_string(*entry.size));
                        }
                        if (entry.mime_type) {
                            mime = entry.mime_type;
                        }
                        break;
                    }
                }
            }
            return RpcOutcome::value(
                Json{{"contents",
                      Json::array({build_content_item(uri, mime, content.bytes, content.meta)})}});
        }
    }
    return RpcOutcome::error(-32602, "Resource not found", Json{{"uri", std::string(uri)}});
}

RpcOutcome ResourceService::list_templates() const {
    return RpcOutcome::value(Json{{"resourceTemplates", Json::array()}});
}

RpcOutcome ResourceService::list_skills() const {
    return RpcOutcome::value(Json{{"skills", skills_list_json_}});
}

RpcOutcome ResourceService::get_skill(std::string_view uri) const {
    if (const auto it = skill_by_uri_.find(uri); it != skill_by_uri_.end()) {
        return RpcOutcome::value(Json{{"skill", skills_list_json_[it->second]}});
    }
    return RpcOutcome::error(-32602, "Skill not found", Json{{"uri", std::string(uri)}});
}

RpcOutcome ResourceService::read_directory(std::string_view uri) const {
    if (const auto it = directories_.find(uri); it != directories_.end()) {
        return RpcOutcome::value(Json{{"resources", it->second}});
    }
    return RpcOutcome::error(-32602, "Directory not found", Json{{"uri", std::string(uri)}});
}

} // namespace surface
} // namespace afd::mcp
