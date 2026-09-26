// The shared todo contract (spec/commands.schema.json), embedded at build time.
#pragma once

#include <string>
#include <string_view>
#include <vector>

#include <afd/json.hpp>

namespace todo {

/// The raw bytes of spec/commands.schema.json.
std::string_view embedded_spec();

/// The parsed contract.
const afd::Json& spec();

/// The command names the contract defines.
std::vector<std::string> spec_command_names();

/// A command's input schema, with the contract's shared `definitions` attached so its `$ref`s
/// resolve.
afd::Json input_schema(std::string_view command);

} // namespace todo
