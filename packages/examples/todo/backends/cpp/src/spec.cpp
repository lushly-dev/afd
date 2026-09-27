#include "spec.hpp"

#include <cstdio>
#include <cstdlib>

namespace todo {

const afd::Json& spec() {
    static const afd::Json parsed = [] {
        auto result = afd::parse_bounded(embedded_spec());
        if (!result) {
            std::fprintf(stderr, "embedded commands.schema.json is invalid: %s\n",
                         result.error().message.c_str());
            std::abort();
        }
        return *result;
    }();
    return parsed;
}

std::vector<std::string> spec_command_names() {
    std::vector<std::string> names;
    for (auto it = spec()["commands"].begin(); it != spec()["commands"].end(); ++it) {
        names.push_back(it.key());
    }
    return names;
}

afd::Json input_schema(std::string_view command) {
    const auto& commands = spec()["commands"];
    const auto entry = commands.find(std::string(command));
    afd::Json schema = entry != commands.end() ? (*entry)["input"] : afd::Json{{"type", "object"}};
    schema["definitions"] = spec()["definitions"];
    return schema;
}

} // namespace todo
