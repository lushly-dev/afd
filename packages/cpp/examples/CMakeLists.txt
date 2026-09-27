# The README quickstart, built with the library so the documented code always compiles and runs.
add_executable(afd_quickstart quickstart.cpp)
target_link_libraries(afd_quickstart PRIVATE afd::afd)
afd_configure_target(afd_quickstart)
if(AFD_BUILD_TESTS)
    add_test(NAME afd_quickstart COMMAND afd_quickstart)
endif()
if(EMSCRIPTEN)
    # Node loads .js as an ES module under the repository's "type": "module"; emit CommonJS.
    set_target_properties(afd_quickstart PROPERTIES SUFFIX ".cjs")
endif()
