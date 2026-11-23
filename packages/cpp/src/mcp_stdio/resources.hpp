// Private: MCP resources (R1-R6) and Agent Skills catalog (S1-S7) service for `afd::mcp_stdio`.
// Not installed.
#pragma once

#include "afd/expected.hpp"
#include "afd/json.hpp"
#include "afd/mcp_stdio.hpp"

#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace afd::mcp::surface {

/// Outcome of a resource / skill RPC handler: either a result JSON payload or a JSON-RPC error.
struct RpcOutcome {
    bool ok = false;
    Json result;
    int error_code = 0;
    std::string error_message;
    Json error_data = nullptr;

    static RpcOutcome value(Json payload) { return {.ok = true, .result = std::move(payload)}; }

    static RpcOutcome error(int code, std::string message, Json data = nullptr) {
        return {.ok = false,
                .result = nullptr,
                .error_code = code,
                .error_message = std::move(message),
                .error_data = std::move(data)};
    }
};

/// Validated, immutable-catalog resource and skill service owned by `StdioServer::State`.
class ResourceService {
public:
    static Expected<ResourceService> create(std::optional<ResourceProvider> resources,
                                            std::optional<SkillCatalog> skills);

    [[nodiscard]] bool has_resources() const noexcept { return has_resources_; }
    [[nodiscard]] bool has_skills() const noexcept { return has_skills_; }
    [[nodiscard]] bool has_directory_read() const noexcept { return directory_read_; }

    [[nodiscard]] RpcOutcome list_resources() const;
    [[nodiscard]] RpcOutcome read_resource(std::string_view uri) const;
    [[nodiscard]] RpcOutcome list_templates() const;
    [[nodiscard]] RpcOutcome list_skills() const;
    [[nodiscard]] RpcOutcome get_skill(std::string_view uri) const;
    [[nodiscard]] RpcOutcome read_directory(std::string_view uri) const;

private:
    struct StoredStatic {
        Json entry_json;
        std::string bytes;
        std::optional<std::string> mime_type;
        std::optional<Json> content_meta;
    };

    struct StoredSkillFile {
        std::string uri;
        std::string bytes;
        std::string mime_type;
        Json resource_json;
    };

    bool has_resources_ = false;
    bool has_skills_ = false;
    bool directory_read_ = false;

    std::vector<StoredStatic> static_resources_;
    std::map<std::string, std::size_t, std::less<>> static_index_;
    std::function<Expected<std::vector<ResourceEntry>>()> dynamic_list_;
    std::function<Expected<std::optional<ResourceContents>>(std::string_view)> dynamic_read_;

    Json skills_list_json_ = Json::array();
    std::map<std::string, std::size_t, std::less<>> skill_by_uri_;
    std::vector<StoredSkillFile> skill_files_;
    std::map<std::string, std::size_t, std::less<>> skill_file_by_uri_;
    std::map<std::string, Json, std::less<>> directories_;
};

} // namespace afd::mcp::surface
