// The afd-cpp quickstart (packages/cpp/README.md): define a command, execute it directly, then
// call it as an in-process agent. Exits 0 when everything behaves as documented.
#include <cstdio>
#include <memory>

#include <afd/afd.hpp>

int main() {
    auto registry = std::make_shared<afd::CommandRegistry>(afd::CommandRegistryOptions{
        .middleware = afd::default_middleware({.logging = std::nullopt})});

    auto error = registry->register_command(afd::CommandDefinition{
        .name = "todo-create",
        .description = "Create a todo",
        .input_schema = afd::Json::parse(R"({"type": "object",
            "properties": {"title": {"type": "string", "minLength": 1}}, "required": ["title"]})"),
        .handler =
            [](const afd::Json& input, afd::CommandContext&) {
                return afd::success({{"title", input["title"]}}, {.reasoning = "Created"});
            },
        .mutation = true,
    });
    if (error) {
        std::fprintf(stderr, "register_command: %s\n", error->c_str());
        return 1;
    }

    afd::CommandResult result = registry->execute("todo-create", {{"title", "Buy milk"}});
    std::printf("%s\n", afd::wire::serialize(afd::Json(result)).c_str());

    afd::DirectClient agent(registry); // an in-process agent: sees only commands exposed to it
    afd::CommandResult typo = agent.call("todo-crate");
    std::printf("%s\n", typo.error ? typo.error->suggestion.value_or("").c_str() : "");

    const bool ok = result.success && !typo.success && typo.error &&
                    typo.error->suggestion == "Did you mean 'todo-create'?";
    std::printf("afd %s: %s\n", std::string(afd::library_version()).c_str(), ok ? "ok" : "FAILED");
    return ok ? 0 : 1;
}
