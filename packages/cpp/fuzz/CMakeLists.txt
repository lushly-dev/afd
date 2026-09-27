# libFuzzer targets for code that handles untrusted input (quality review Theme 5).
#
# With a compiler that supports -fsanitize=fuzzer (Clang on Linux), each target is a libFuzzer
# binary; CI runs each for a fixed time. Elsewhere (Apple Clang, GCC, MSVC) each target is built
# with standalone_main.cpp, which replays the seed corpus, so the targets still compile and run.
include(CheckCXXSourceCompiles)
set(CMAKE_REQUIRED_FLAGS "-fsanitize=fuzzer")
check_cxx_source_compiles(
    "#include <cstddef>
     #include <cstdint>
     extern \"C\" int LLVMFuzzerTestOneInput(const std::uint8_t*, std::size_t) { return 0; }"
    AFD_HAS_LIBFUZZER)
unset(CMAKE_REQUIRED_FLAGS)

foreach(target parse_bounded pipeline schema similarity wire)
    set(name afd_fuzz_${target})
    if(AFD_HAS_LIBFUZZER)
        add_executable(${name} fuzz_${target}.cpp)
        target_compile_options(${name} PRIVATE -fsanitize=fuzzer,address,undefined)
        target_link_options(${name} PRIVATE -fsanitize=fuzzer,address,undefined)
    else()
        add_executable(${name} fuzz_${target}.cpp standalone_main.cpp)
    endif()
    target_link_libraries(${name} PRIVATE afd::afd)
    afd_configure_target(${name})
    if(BUILD_TESTING OR AFD_BUILD_TESTS)
        # Replaying the seed corpus is a regression test either way.
        add_test(NAME ${name}_corpus COMMAND ${name} ${CMAKE_CURRENT_SOURCE_DIR}/corpus/${target})
    endif()
endforeach()
