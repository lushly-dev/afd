// Built only when AFD_MACRO_HYGIENE_CHECK is ON, with cmake/macro_hygiene_prelude.hpp
// force-included. It includes the whole public API, so a header that uses min/max unguarded, or
// an identifier named check, verify or require, fails the build.
#include "afd/afd.hpp"
