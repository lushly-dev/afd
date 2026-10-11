// Reports successful dispatch scaling without putting a timing threshold in unit tests.
#include "afd/afd.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <iostream>
#include <string>

int main() {
    constexpr int iterations = 20000;
    for (const int count : {1, 1000}) {
        afd::CommandRegistry registry;
        for (int index = 0; index < count; ++index) {
            std::string suffix(4, 'a');
            int remaining = index;
            for (char& letter : suffix) {
                letter = static_cast<char>('a' + remaining % 26);
                remaining /= 26;
            }
            const auto problem =
                registry.register_command({.name = "work-dispatch-command-" + suffix,
                                           .description = "Dispatch benchmark",
                                           .handler = [](const afd::Json&, afd::CommandContext&) {
                                               return afd::success(nullptr);
                                           }});
            if (problem) {
                std::cerr << *problem << '\n';
                return 1;
            }
        }
        std::array<double, 5> samples{};
        for (auto& sample : samples) {
            const auto start = std::chrono::steady_clock::now();
            for (int iteration = 0; iteration < iterations; ++iteration) {
                if (!registry.execute("work-dispatch-command-aaaa").success) {
                    return 1;
                }
            }
            sample =
                std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - start)
                    .count() /
                iterations;
        }
        std::sort(samples.begin(), samples.end());
        std::cout << "commands=" << count << " median_ns_per_call=" << samples[2] << '\n';
    }
}
