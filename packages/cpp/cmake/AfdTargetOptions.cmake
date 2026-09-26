# Compiler options shared by every afd-cpp target (the library and its tests).

set(AFD_MACRO_HYGIENE_PRELUDE ${CMAKE_CURRENT_LIST_DIR}/macro_hygiene_prelude.hpp)

function(afd_configure_target target)
    if(MSVC)
        target_compile_options(${target} PRIVATE /W4 /permissive- /utf-8 /Zc:__cplusplus)
        if(AFD_WARNINGS_AS_ERRORS)
            target_compile_options(${target} PRIVATE /WX)
        endif()
    else()
        target_compile_options(
            ${target}
            PRIVATE -Wall
                    -Wextra
                    -Wpedantic
                    -Wshadow
                    -Wconversion
                    -Wsign-conversion
                    -Wold-style-cast
                    -Wnon-virtual-dtor
                    -Woverloaded-virtual)
        if(AFD_WARNINGS_AS_ERRORS)
            target_compile_options(${target} PRIVATE -Werror)
        endif()
    endif()
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
