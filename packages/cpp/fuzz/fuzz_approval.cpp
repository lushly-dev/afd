// Approval evidence is caller-influenced: the middleware must reject any bytes that are not a
// token it issued, without crashing. canonical_json must accept or refuse any parsed input, and
// what it writes must parse back to an equal value.
#include "afd/approval.hpp"

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <string_view>

namespace {

const afd::CommandMiddleware& middleware() {
    static const afd::CommandMiddleware instance = *afd::create_approval_middleware({
        .secrets = {std::string(32, 'k')},
        .commands = {afd::ApprovalCommand("todo-delete", afd::ApprovalDecision::required)},
        .clock = afd::fixed_clock(1767225600000),
    });
    return instance;
}

} // namespace

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    if (size == 0) {
        return 0;
    }
    const std::string_view text(reinterpret_cast<const char*>(data) + 1, size - 1);
    if (data[0] % 2 == 0) {
        afd::CommandContext context;
        context.approval = std::string(text);
        bool ran = false;
        const auto result = middleware()("todo-delete", afd::Json{{"id", 1}}, context, [&ran] {
            ran = true;
            return afd::success(nullptr);
        });
        // Forging an HMAC-SHA256 tag is out of reach; a run means verification is broken.
        if (ran || result.success || !result.error || result.error->code != "APPROVAL_REQUIRED") {
            std::abort();
        }
        return 0;
    }
    const auto parsed = afd::parse_bounded(text, {.max_depth = 64, .max_bytes = 1 << 20});
    if (!parsed) {
        return 0;
    }
    const auto canonical = afd::canonical_json(*parsed);
    if (!canonical) {
        return 0;
    }
    const auto again = afd::parse_bounded(*canonical);
    if (!again || *again != *parsed || afd::canonical_json(*again).value() != *canonical) {
        std::abort();
    }
    return 0;
}
