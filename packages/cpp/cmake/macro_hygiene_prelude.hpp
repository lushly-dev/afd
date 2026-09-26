// Force-included into every translation unit when AFD_MACRO_HYGIENE_CHECK is ON.
//
// These are the macro collisions any portable C++ library meets. afd-cpp must compile with
// them defined: write `(std::min)(a, b)`, and never name anything check, verify or require.
// Host- or engine-specific macros are the host's concern (see the proposal's scope principle).
#pragma once

// <windows.h> without NOMINMAX.
#define min(a, b) (((a) < (b)) ? (a) : (b))
#define max(a, b) (((a) > (b)) ? (a) : (b))

// Apple AssertMacros.h (the lowercase variants).
#define check(assertion) ((void)(assertion))
#define verify(assertion) ((void)(assertion))
#define require(assertion, exceptionLabel) ((void)(assertion))
