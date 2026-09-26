// Private: whether this build has C++ exceptions. Library code catches only when it does.
#pragma once

#if defined(__cpp_exceptions) || defined(_CPPUNWIND)
#define AFD_HAS_EXCEPTIONS 1
#include <exception>
#else
#define AFD_HAS_EXCEPTIONS 0
#endif
