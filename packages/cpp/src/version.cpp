#include "afd/version.hpp"

namespace afd {

std::string_view library_version() noexcept {
    return AFD_VERSION_STRING;
}

} // namespace afd
