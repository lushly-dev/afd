if(NOT DEFINED AFD_SOURCE_DIR OR NOT DEFINED AFD_TEST_BINARY_DIR)
    message(FATAL_ERROR "AFD_SOURCE_DIR and AFD_TEST_BINARY_DIR are required")
endif()

function(run_configure scenario expect_success)
    set(build_dir "${AFD_TEST_BINARY_DIR}/${scenario}")
    file(REMOVE_RECURSE "${build_dir}")
    execute_process(
        COMMAND
            ${CMAKE_COMMAND} -S ${CMAKE_CURRENT_LIST_DIR}/compiler-policy -B ${build_dir}
            -DAFD_SOURCE_DIR=${AFD_SOURCE_DIR} -DAFD_TEST_SCENARIO=${scenario}
        RESULT_VARIABLE result
        OUTPUT_VARIABLE output
        ERROR_VARIABLE error)
    set(log "${output}${error}")

    if(expect_success AND NOT result EQUAL 0)
        message(FATAL_ERROR "${scenario}: configure failed unexpectedly:\n${log}")
    elseif(NOT expect_success AND result EQUAL 0)
        message(FATAL_ERROR "${scenario}: configure succeeded unexpectedly")
    endif()

    if(scenario STREQUAL "msvc-too-old"
       AND NOT log MATCHES "afd-cpp needs MSVC 2022 \\(19\\.30\\) or newer")
        message(FATAL_ERROR "${scenario}: configure did not report the supported floor:\n${log}")
    elseif(scenario STREQUAL "clang-cl-too-old"
           AND NOT log MATCHES "clang-cl regression gate needs Clang 21 or newer")
        message(FATAL_ERROR "${scenario}: configure did not report the regression floor:\n${log}")
    elseif(scenario STREQUAL "clang-cl-unexpected-version"
           AND (NOT log MATCHES "expected Clang 23\\.1\\.2"
                OR NOT log MATCHES "22\\.1\\.8"))
        message(FATAL_ERROR "${scenario}: configure did not report the version mismatch:\n${log}")
    endif()
endfunction()

run_configure(msvc-supported TRUE)
run_configure(msvc-too-old FALSE)
run_configure(clang-cl TRUE)
run_configure(clang-cl-too-old FALSE)
run_configure(clang-cl-unexpected-version FALSE)
run_configure(clang-gnu-frontend TRUE)
run_configure(apple-clang-before-subgroup TRUE)
