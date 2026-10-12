# Compiler options shared by every afd-cpp target (the library and its tests).

set(AFD_MACRO_HYGIENE_PRELUDE ${CMAKE_CURRENT_LIST_DIR}/macro_hygiene_prelude.hpp)

function(afd_require_supported_compiler compiler_id compiler_version)
    # clang-cl sets MSVC because it uses the Microsoft command-line frontend, but its compiler ID
    # is Clang. The 19.30 floor guards a known cl.exe ICE and must not reject clang-cl using older
    # Visual Studio headers.
    if(compiler_id STREQUAL "MSVC" AND compiler_version VERSION_LESS 19.30)
        message(
            FATAL_ERROR
                "afd-cpp needs MSVC 2022 (19.30) or newer; found ${compiler_version}. "
                "Use Visual Studio 2022, or clang-cl with an older Visual Studio's headers.")
    endif()
endfunction()

function(afd_require_clang_cl_regression_toolchain compiler_id compiler_version frontend_variant
         expected_version)
    if(NOT compiler_id STREQUAL "Clang" OR NOT frontend_variant STREQUAL "MSVC"
       OR compiler_version VERSION_LESS 21)
        message(
            FATAL_ERROR
                "The clang-cl regression gate needs Clang 21 or newer with the MSVC frontend; "
                "CMake found ${compiler_id} ${compiler_version} with frontend "
                "'${frontend_variant}'.")
    endif()
    if(expected_version AND NOT compiler_version VERSION_EQUAL expected_version)
        message(
            FATAL_ERROR
                "The clang-cl regression gate expected Clang ${expected_version}, but CMake "
                "selected ${compiler_version}.")
    endif()
endfunction()

function(afd_compiler_options output compiler_id compiler_version uses_msvc_frontend
         warnings_as_errors)
    set(options)
    if(uses_msvc_frontend)
        list(APPEND options /W4 /permissive- /utf-8 /Zc:__cplusplus)
        if(warnings_as_errors)
            list(APPEND options /WX)
        endif()
    else()
        list(
            APPEND
            options
            -Wall
            -Wextra
            -Wpedantic
            -Wshadow
            -Wconversion
            -Wsign-conversion
            -Wold-style-cast
            -Wnon-virtual-dtor
            -Woverloaded-virtual
            -Wno-missing-field-initializers)
        if(warnings_as_errors)
            list(APPEND options -Werror)
        endif()
    endif()

    # Partial designated initializers (`ErrorOptions{.suggestion = "..."}`) are the intended
    # style for option structs (proposal D1). Clang 21+ diagnoses omitted fields under the more
    # specific subgroup even when it uses the Microsoft command-line frontend.
    if(compiler_id MATCHES "Clang")
        if(uses_msvc_frontend)
            list(APPEND options -Wno-missing-field-initializers)
        endif()
        if(compiler_version VERSION_GREATER_EQUAL 21)
            list(APPEND options -Wno-missing-designated-field-initializers)
        endif()
    endif()

    set(${output} ${options} PARENT_SCOPE)
endfunction()

function(afd_configure_target target)
    afd_compiler_options(options "${CMAKE_CXX_COMPILER_ID}" "${CMAKE_CXX_COMPILER_VERSION}"
                         "${MSVC}" "${AFD_WARNINGS_AS_ERRORS}")
    target_compile_options(${target} PRIVATE ${options})
endfunction()

# Force-include the macro-hygiene prelude. Applied to afd-cpp's own code only (the library and
# a translation unit that includes the whole public API), never to third-party test frameworks.
function(afd_apply_macro_hygiene target)
    if(MSVC)
        target_compile_options(${target} PRIVATE /FI${AFD_MACRO_HYGIENE_PRELUDE})
    else()
        target_compile_options(${target} PRIVATE -include ${AFD_MACRO_HYGIENE_PRELUDE})
    endif()
endfunction()
