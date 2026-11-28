#include "afd/approval_display.hpp"

#include "afd/approval.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "detail/utf8.hpp"

namespace afd {

namespace {

struct CodePointRange {
    std::uint32_t first;
    std::uint32_t last;
};

// Unicode General Category M (Mn, Mc, Me) code point ranges matching JavaScript `/\p{M}/u`.
constexpr std::array<CodePointRange, 327> combining_mark_ranges{{
    {0x0300U, 0x036FU},   {0x0483U, 0x0489U},   {0x0591U, 0x05BDU},   {0x05BFU, 0x05BFU},
    {0x05C1U, 0x05C2U},   {0x05C4U, 0x05C5U},   {0x05C7U, 0x05C7U},   {0x0610U, 0x061AU},
    {0x064BU, 0x065FU},   {0x0670U, 0x0670U},   {0x06D6U, 0x06DCU},   {0x06DFU, 0x06E4U},
    {0x06E7U, 0x06E8U},   {0x06EAU, 0x06EDU},   {0x0711U, 0x0711U},   {0x0730U, 0x074AU},
    {0x07A6U, 0x07B0U},   {0x07EBU, 0x07F3U},   {0x07FDU, 0x07FDU},   {0x0816U, 0x0819U},
    {0x081BU, 0x0823U},   {0x0825U, 0x0827U},   {0x0829U, 0x082DU},   {0x0859U, 0x085BU},
    {0x0897U, 0x089FU},   {0x08CAU, 0x08E1U},   {0x08E3U, 0x0903U},   {0x093AU, 0x093CU},
    {0x093EU, 0x094FU},   {0x0951U, 0x0957U},   {0x0962U, 0x0963U},   {0x0981U, 0x0983U},
    {0x09BCU, 0x09BCU},   {0x09BEU, 0x09C4U},   {0x09C7U, 0x09C8U},   {0x09CBU, 0x09CDU},
    {0x09D7U, 0x09D7U},   {0x09E2U, 0x09E3U},   {0x09FEU, 0x09FEU},   {0x0A01U, 0x0A03U},
    {0x0A3CU, 0x0A3CU},   {0x0A3EU, 0x0A42U},   {0x0A47U, 0x0A48U},   {0x0A4BU, 0x0A4DU},
    {0x0A51U, 0x0A51U},   {0x0A70U, 0x0A71U},   {0x0A75U, 0x0A75U},   {0x0A81U, 0x0A83U},
    {0x0ABCU, 0x0ABCU},   {0x0ABEU, 0x0AC5U},   {0x0AC7U, 0x0AC9U},   {0x0ACBU, 0x0ACDU},
    {0x0AE2U, 0x0AE3U},   {0x0AFAU, 0x0AFFU},   {0x0B01U, 0x0B03U},   {0x0B3CU, 0x0B3CU},
    {0x0B3EU, 0x0B44U},   {0x0B47U, 0x0B48U},   {0x0B4BU, 0x0B4DU},   {0x0B55U, 0x0B57U},
    {0x0B62U, 0x0B63U},   {0x0B82U, 0x0B82U},   {0x0BBEU, 0x0BC2U},   {0x0BC6U, 0x0BC8U},
    {0x0BCAU, 0x0BCDU},   {0x0BD7U, 0x0BD7U},   {0x0C00U, 0x0C04U},   {0x0C3CU, 0x0C3CU},
    {0x0C3EU, 0x0C44U},   {0x0C46U, 0x0C48U},   {0x0C4AU, 0x0C4DU},   {0x0C55U, 0x0C56U},
    {0x0C62U, 0x0C63U},   {0x0C81U, 0x0C83U},   {0x0CBCU, 0x0CBCU},   {0x0CBEU, 0x0CC4U},
    {0x0CC6U, 0x0CC8U},   {0x0CCAU, 0x0CCDU},   {0x0CD5U, 0x0CD6U},   {0x0CE2U, 0x0CE3U},
    {0x0CF3U, 0x0CF3U},   {0x0D00U, 0x0D03U},   {0x0D3BU, 0x0D3CU},   {0x0D3EU, 0x0D44U},
    {0x0D46U, 0x0D48U},   {0x0D4AU, 0x0D4DU},   {0x0D57U, 0x0D57U},   {0x0D62U, 0x0D63U},
    {0x0D81U, 0x0D83U},   {0x0DCAU, 0x0DCAU},   {0x0DCFU, 0x0DD4U},   {0x0DD6U, 0x0DD6U},
    {0x0DD8U, 0x0DDFU},   {0x0DF2U, 0x0DF3U},   {0x0E31U, 0x0E31U},   {0x0E34U, 0x0E3AU},
    {0x0E47U, 0x0E4EU},   {0x0EB1U, 0x0EB1U},   {0x0EB4U, 0x0EBCU},   {0x0EC8U, 0x0ECEU},
    {0x0F18U, 0x0F19U},   {0x0F35U, 0x0F35U},   {0x0F37U, 0x0F37U},   {0x0F39U, 0x0F39U},
    {0x0F3EU, 0x0F3FU},   {0x0F71U, 0x0F84U},   {0x0F86U, 0x0F87U},   {0x0F8DU, 0x0F97U},
    {0x0F99U, 0x0FBCU},   {0x0FC6U, 0x0FC6U},   {0x102BU, 0x103EU},   {0x1056U, 0x1059U},
    {0x105EU, 0x1060U},   {0x1062U, 0x1064U},   {0x1067U, 0x106DU},   {0x1071U, 0x1074U},
    {0x1082U, 0x108DU},   {0x108FU, 0x108FU},   {0x109AU, 0x109DU},   {0x135DU, 0x135FU},
    {0x1712U, 0x1715U},   {0x1732U, 0x1734U},   {0x1752U, 0x1753U},   {0x1772U, 0x1773U},
    {0x17B4U, 0x17D3U},   {0x17DDU, 0x17DDU},   {0x180BU, 0x180DU},   {0x180FU, 0x180FU},
    {0x1885U, 0x1886U},   {0x18A9U, 0x18A9U},   {0x1920U, 0x192BU},   {0x1930U, 0x193BU},
    {0x1A17U, 0x1A1BU},   {0x1A55U, 0x1A5EU},   {0x1A60U, 0x1A7CU},   {0x1A7FU, 0x1A7FU},
    {0x1AB0U, 0x1ADDU},   {0x1AE0U, 0x1AEBU},   {0x1B00U, 0x1B04U},   {0x1B34U, 0x1B44U},
    {0x1B6BU, 0x1B73U},   {0x1B80U, 0x1B82U},   {0x1BA1U, 0x1BADU},   {0x1BE6U, 0x1BF3U},
    {0x1C24U, 0x1C37U},   {0x1CD0U, 0x1CD2U},   {0x1CD4U, 0x1CE8U},   {0x1CEDU, 0x1CEDU},
    {0x1CF4U, 0x1CF4U},   {0x1CF7U, 0x1CF9U},   {0x1DC0U, 0x1DFFU},   {0x20D0U, 0x20F0U},
    {0x2CEFU, 0x2CF1U},   {0x2D7FU, 0x2D7FU},   {0x2DE0U, 0x2DFFU},   {0x302AU, 0x302FU},
    {0x3099U, 0x309AU},   {0xA66FU, 0xA672U},   {0xA674U, 0xA67DU},   {0xA69EU, 0xA69FU},
    {0xA6F0U, 0xA6F1U},   {0xA802U, 0xA802U},   {0xA806U, 0xA806U},   {0xA80BU, 0xA80BU},
    {0xA823U, 0xA827U},   {0xA82CU, 0xA82CU},   {0xA880U, 0xA881U},   {0xA8B4U, 0xA8C5U},
    {0xA8E0U, 0xA8F1U},   {0xA8FFU, 0xA8FFU},   {0xA926U, 0xA92DU},   {0xA947U, 0xA953U},
    {0xA980U, 0xA983U},   {0xA9B3U, 0xA9C0U},   {0xA9E5U, 0xA9E5U},   {0xAA29U, 0xAA36U},
    {0xAA43U, 0xAA43U},   {0xAA4CU, 0xAA4DU},   {0xAA7BU, 0xAA7DU},   {0xAAB0U, 0xAAB0U},
    {0xAAB2U, 0xAAB4U},   {0xAAB7U, 0xAAB8U},   {0xAABEU, 0xAABFU},   {0xAAC1U, 0xAAC1U},
    {0xAAEBU, 0xAAEFU},   {0xAAF5U, 0xAAF6U},   {0xABE3U, 0xABEAU},   {0xABECU, 0xABEDU},
    {0xFB1EU, 0xFB1EU},   {0xFE00U, 0xFE0FU},   {0xFE20U, 0xFE2FU},   {0x101FDU, 0x101FDU},
    {0x102E0U, 0x102E0U}, {0x10376U, 0x1037AU}, {0x10A01U, 0x10A03U}, {0x10A05U, 0x10A06U},
    {0x10A0CU, 0x10A0FU}, {0x10A38U, 0x10A3AU}, {0x10A3FU, 0x10A3FU}, {0x10AE5U, 0x10AE6U},
    {0x10D24U, 0x10D27U}, {0x10D69U, 0x10D6DU}, {0x10EABU, 0x10EACU}, {0x10EFAU, 0x10EFFU},
    {0x10F46U, 0x10F50U}, {0x10F82U, 0x10F85U}, {0x11000U, 0x11002U}, {0x11038U, 0x11046U},
    {0x11070U, 0x11070U}, {0x11073U, 0x11074U}, {0x1107FU, 0x11082U}, {0x110B0U, 0x110BAU},
    {0x110C2U, 0x110C2U}, {0x11100U, 0x11102U}, {0x11127U, 0x11134U}, {0x11145U, 0x11146U},
    {0x11173U, 0x11173U}, {0x11180U, 0x11182U}, {0x111B3U, 0x111C0U}, {0x111C9U, 0x111CCU},
    {0x111CEU, 0x111CFU}, {0x1122CU, 0x11237U}, {0x1123EU, 0x1123EU}, {0x11241U, 0x11241U},
    {0x112DFU, 0x112EAU}, {0x11300U, 0x11303U}, {0x1133BU, 0x1133CU}, {0x1133EU, 0x11344U},
    {0x11347U, 0x11348U}, {0x1134BU, 0x1134DU}, {0x11357U, 0x11357U}, {0x11362U, 0x11363U},
    {0x11366U, 0x1136CU}, {0x11370U, 0x11374U}, {0x113B8U, 0x113C0U}, {0x113C2U, 0x113C2U},
    {0x113C5U, 0x113C5U}, {0x113C7U, 0x113CAU}, {0x113CCU, 0x113D0U}, {0x113D2U, 0x113D2U},
    {0x113E1U, 0x113E2U}, {0x11435U, 0x11446U}, {0x1145EU, 0x1145EU}, {0x114B0U, 0x114C3U},
    {0x115AFU, 0x115B5U}, {0x115B8U, 0x115C0U}, {0x115DCU, 0x115DDU}, {0x11630U, 0x11640U},
    {0x116ABU, 0x116B7U}, {0x1171DU, 0x1172BU}, {0x1182CU, 0x1183AU}, {0x11930U, 0x11935U},
    {0x11937U, 0x11938U}, {0x1193BU, 0x1193EU}, {0x11940U, 0x11940U}, {0x11942U, 0x11943U},
    {0x119D1U, 0x119D7U}, {0x119DAU, 0x119E0U}, {0x119E4U, 0x119E4U}, {0x11A01U, 0x11A0AU},
    {0x11A33U, 0x11A39U}, {0x11A3BU, 0x11A3EU}, {0x11A47U, 0x11A47U}, {0x11A51U, 0x11A5BU},
    {0x11A8AU, 0x11A99U}, {0x11B60U, 0x11B67U}, {0x11C2FU, 0x11C36U}, {0x11C38U, 0x11C3FU},
    {0x11C92U, 0x11CA7U}, {0x11CA9U, 0x11CB6U}, {0x11D31U, 0x11D36U}, {0x11D3AU, 0x11D3AU},
    {0x11D3CU, 0x11D3DU}, {0x11D3FU, 0x11D45U}, {0x11D47U, 0x11D47U}, {0x11D8AU, 0x11D8EU},
    {0x11D90U, 0x11D91U}, {0x11D93U, 0x11D97U}, {0x11EF3U, 0x11EF6U}, {0x11F00U, 0x11F01U},
    {0x11F03U, 0x11F03U}, {0x11F34U, 0x11F3AU}, {0x11F3EU, 0x11F42U}, {0x11F5AU, 0x11F5AU},
    {0x13440U, 0x13440U}, {0x13447U, 0x13455U}, {0x1611EU, 0x1612FU}, {0x16AF0U, 0x16AF4U},
    {0x16B30U, 0x16B36U}, {0x16F4FU, 0x16F4FU}, {0x16F51U, 0x16F87U}, {0x16F8FU, 0x16F92U},
    {0x16FE4U, 0x16FE4U}, {0x16FF0U, 0x16FF1U}, {0x1BC9DU, 0x1BC9EU}, {0x1CF00U, 0x1CF2DU},
    {0x1CF30U, 0x1CF46U}, {0x1D165U, 0x1D169U}, {0x1D16DU, 0x1D172U}, {0x1D17BU, 0x1D182U},
    {0x1D185U, 0x1D18BU}, {0x1D1AAU, 0x1D1ADU}, {0x1D242U, 0x1D244U}, {0x1DA00U, 0x1DA36U},
    {0x1DA3BU, 0x1DA6CU}, {0x1DA75U, 0x1DA75U}, {0x1DA84U, 0x1DA84U}, {0x1DA9BU, 0x1DA9FU},
    {0x1DAA1U, 0x1DAAFU}, {0x1E000U, 0x1E006U}, {0x1E008U, 0x1E018U}, {0x1E01BU, 0x1E021U},
    {0x1E023U, 0x1E024U}, {0x1E026U, 0x1E02AU}, {0x1E08FU, 0x1E08FU}, {0x1E130U, 0x1E136U},
    {0x1E2AEU, 0x1E2AEU}, {0x1E2ECU, 0x1E2EFU}, {0x1E4ECU, 0x1E4EFU}, {0x1E5EEU, 0x1E5EFU},
    {0x1E6E3U, 0x1E6E3U}, {0x1E6E6U, 0x1E6E6U}, {0x1E6EEU, 0x1E6EFU}, {0x1E6F5U, 0x1E6F5U},
    {0x1E8D0U, 0x1E8D6U}, {0x1E944U, 0x1E94AU}, {0xE0100U, 0xE01EFU},
}};

bool is_combining_mark(std::uint32_t code) noexcept {
    if (code < 0x0300U) {
        return false;
    }
    const auto it = std::lower_bound(
        combining_mark_ranges.begin(), combining_mark_ranges.end(), code,
        [](const CodePointRange& range, std::uint32_t value) { return range.last < value; });
    return it != combining_mark_ranges.end() && code >= it->first;
}

/// `text` as UTF-16 code units, for ordering object keys as JavaScript's `Array.prototype.sort`.
std::u16string to_utf16_units(std::string_view text) {
    std::u16string out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size();) {
        const detail::DecodedChar decoded = detail::decode_utf8(text, i);
        if (decoded.code_point >= 0x10000U) {
            const char32_t offset = decoded.code_point - 0x10000U;
            out.push_back(static_cast<char16_t>(0xD800U + (offset >> 10)));
            out.push_back(static_cast<char16_t>(0xDC00U + (offset & 0x3FFU)));
        } else {
            out.push_back(static_cast<char16_t>(decoded.code_point));
        }
        i += decoded.byte_length;
    }
    return out;
}

} // namespace

std::string_view approval_display_refusal_name(ApprovalDisplayRefusal refusal) noexcept {
    switch (refusal) {
    case ApprovalDisplayRefusal::not_json:
        return "not-json";
    case ApprovalDisplayRefusal::too_long:
        return "too-long";
    case ApprovalDisplayRefusal::too_many_values:
        return "too-many-values";
    case ApprovalDisplayRefusal::too_deep:
        return "too-deep";
    case ApprovalDisplayRefusal::string_too_long:
        return "string-too-long";
    case ApprovalDisplayRefusal::key_too_long:
        return "key-too-long";
    case ApprovalDisplayRefusal::hidden_characters:
        return "hidden-characters";
    }
    return "not-json";
}

bool is_hidden_code_point(std::uint32_t code) noexcept {
    return (code < 0x20U && code != 0x09U && code != 0x0AU) || (code >= 0x7FU && code <= 0x9FU) ||
           code == 0x00ADU || code == 0x034FU || code == 0x061CU || code == 0x115FU ||
           code == 0x1160U || code == 0x17B4U || code == 0x17B5U ||
           (code >= 0x180BU && code <= 0x180FU) || (code >= 0x200BU && code <= 0x200FU) ||
           code == 0x2028U || code == 0x2029U || (code >= 0x202AU && code <= 0x202EU) ||
           (code >= 0x2060U && code <= 0x206FU) || code == 0x2800U || code == 0x3164U ||
           (code >= 0xD800U && code <= 0xDFFFU) || (code >= 0xFE00U && code <= 0xFE0DU) ||
           code == 0xFEFFU || code == 0xFFA0U || (code >= 0xFFF0U && code <= 0xFFFBU) ||
           (code >= 0x1BCA0U && code <= 0x1BCA3U) || (code >= 0x1D173U && code <= 0x1D17AU) ||
           (code >= 0xE0000U && code <= 0xE0FFFU);
}

bool hides_characters(std::string_view text) noexcept {
    constexpr std::size_t stacked_mark_limit = 6;
    std::size_t marks = 0;
    for (std::size_t i = 0; i < text.size();) {
        const detail::DecodedChar decoded = detail::decode_utf8(text, i);
        i += decoded.byte_length;
        // Invalid UTF-8 decodes to {0xFFFD, 1} (a real U+FFFD is 3 bytes): refuse it.
        if (decoded.code_point == 0xFFFDU && decoded.byte_length == 1) {
            return true;
        }
        const auto code = static_cast<std::uint32_t>(decoded.code_point);
        if (is_hidden_code_point(code)) {
            return true;
        }
        if (is_combining_mark(code)) {
            ++marks;
            if (marks >= stacked_mark_limit) {
                return true;
            }
        } else {
            marks = 0;
        }
    }
    return false;
}

ApprovalDisplay approval_display(const Json& input) {
    const auto text = canonical_json(input);
    if (!text) {
        return unexpected(ApprovalDisplayRefusal::not_json);
    }
    if (detail::utf16_length(*text) > approval_display_limits.max_serialized_length) {
        return unexpected(ApprovalDisplayRefusal::too_long);
    }

    // Depth first with an explicit stack, so deep input cannot overflow the call stack. An
    // object's key is inspected when its member is reached, immediately before the member.
    struct WorkItem {
        bool is_key = false;
        const Json* value = nullptr;
        std::size_t depth = 0;
        std::string_view key;
    };

    std::size_t visited = 0;
    std::vector<WorkItem> pending;
    pending.push_back(WorkItem{.is_key = false, .value = &input, .depth = 0, .key = {}});

    while (!pending.empty()) {
        const WorkItem current = pending.back();
        pending.pop_back();
        if (current.is_key) {
            if (detail::utf16_length(current.key) > approval_display_limits.max_key_length) {
                return unexpected(ApprovalDisplayRefusal::key_too_long);
            }
            if (hides_characters(current.key)) {
                return unexpected(ApprovalDisplayRefusal::hidden_characters);
            }
            continue;
        }

        ++visited;
        if (visited > approval_display_limits.max_values) {
            return unexpected(ApprovalDisplayRefusal::too_many_values);
        }
        if (current.depth > approval_display_limits.max_depth) {
            return unexpected(ApprovalDisplayRefusal::too_deep);
        }

        const Json& node = *current.value;
        if (node.is_string()) {
            const auto& str = node.get_ref<const std::string&>();
            if (detail::utf16_length(str) > approval_display_limits.max_string_length) {
                return unexpected(ApprovalDisplayRefusal::string_too_long);
            }
            if (hides_characters(str)) {
                return unexpected(ApprovalDisplayRefusal::hidden_characters);
            }
        } else if (node.is_array()) {
            for (auto it = node.rbegin(); it != node.rend(); ++it) {
                pending.push_back(WorkItem{
                    .is_key = false, .value = &(*it), .depth = current.depth + 1, .key = {}});
            }
        } else if (node.is_object()) {
            std::vector<std::pair<std::u16string, Json::const_iterator>> entries;
            entries.reserve(node.size());
            for (auto it = node.begin(); it != node.end(); ++it) {
                entries.emplace_back(to_utf16_units(it.key()), it);
            }
            std::sort(entries.begin(), entries.end(),
                      [](const auto& a, const auto& b) { return a.first < b.first; });
            for (auto it = entries.rbegin(); it != entries.rend(); ++it) {
                const Json::const_iterator member = it->second;
                pending.push_back(WorkItem{.is_key = false,
                                           .value = &member.value(),
                                           .depth = current.depth + 1,
                                           .key = {}});
                pending.push_back(WorkItem{
                    .is_key = true, .value = nullptr, .depth = current.depth, .key = member.key()});
            }
        }
    }

    return input;
}

} // namespace afd
