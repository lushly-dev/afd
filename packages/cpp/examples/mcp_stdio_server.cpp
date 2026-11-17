// An MCP server over stdio with afd::mcp_stdio (packages/cpp/README.md, "MCP over stdio").
//
//   afd_mcp_stdio_server               serve MCP on stdin and stdout
//   afd_mcp_stdio_server --self-test   answer a scripted client and check the replies (exit 0)
#include <cstdio>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>

#include <afd/afd.hpp>
#include <afd/mcp_stdio.hpp>

int main(int argc, char** argv) {
    afd::CommandRegistry registry;
    auto error = registry.register_command(afd::CommandDefinition{
        .name = "note-clear",
        .description = "Delete every note",
        .handler = [](const afd::Json&,
                      afd::CommandContext&) { return afd::success({{"cleared", 3}}); },
        .mutation = true,
        .destructive = true,
        .confirm_prompt = "Delete every note?",
        .expose = {.mcp = true}, // commands are not exposed to MCP by default
    });
    if (error) {
        std::fprintf(stderr, "register_command: %s\n", error->c_str());
        return 1;
    }

    auto server = afd::mcp::StdioServer::create(
        registry, {.name = "notes",
                   .version = "1.0.0",
                   // Ask the user before note-clear runs, or take `confirm: true`.
                   .confirmations = afd::mcp::ConfirmationMode::enforce});
    if (!server) {
        std::fprintf(stderr, "StdioServer::create: %s\n", server.error().c_str());
        return 1;
    }

    if (argc > 1 && std::strcmp(argv[1], "--self-test") == 0) {
        std::istringstream in(
            R"({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}})"
            "\n"
            R"({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"note-clear"}})"
            "\n"
            R"({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"note-clear","arguments":{"confirm":true}}})"
            "\n");
        std::ostringstream out;
        (*server)->serve(in, out);
        std::istringstream lines(out.str());
        std::string initialize;
        std::string refused;
        std::string ran;
        std::getline(lines, initialize);
        std::getline(lines, refused);
        std::getline(lines, ran);
        std::printf("%s\n%s\n", refused.c_str(), ran.c_str());
        const bool ok = refused.find("CONFIRMATION_REQUIRED") != std::string::npos &&
                        ran.find(R"(\"cleared\":3)") != std::string::npos;
        return ok ? 0 : 1;
    }

    std::ios::sync_with_stdio(false);
    (*server)->serve(std::cin, std::cout);
    return 0;
}
