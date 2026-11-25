# Step 0.1

No rule decides this step: it records what goes wrong. Shares are of each screen's checks passed.

| Arm | Screen | Runs | Mean | SD | Least | Most |
| --- | --- | --- | --- | --- | --- | --- |
| a0 | t1-lend-a-packet | 2 | 98.8 % | 1.7 points | 97.6 % | 100.0 % |
| a0 | t2-take-in-a-donation | 2 | 98.2 % | 0.9 points | 97.6 % | 98.8 % |
| a0 | t3-a-variety | 1 | 80.6 % | n/a | 80.6 % | 80.6 % |
| a1 | t1-lend-a-packet | 2 | 94.6 % | 6.0 points | 90.4 % | 98.8 % |
| a1 | t2-take-in-a-donation | 2 | 91.6 % | 8.5 points | 85.5 % | 97.6 % |
| a1 | t3-a-variety | 1 | 83.9 % | n/a | 83.9 % | 83.9 % |
| bare | t1-lend-a-packet | 2 | 62.0 % | 4.3 points | 59.0 % | 65.1 % |
| bare | t2-take-in-a-donation | 2 | 34.3 % | 6.0 points | 30.1 % | 38.6 % |
| bare | t3-a-variety | 1 | 61.3 % | n/a | 61.3 % | 61.3 % |

- **a0:** mean 94.9 %, median tokens 1157288, $7.68 at list prices.
- **a1:** mean 91.2 %, median tokens 1021431, $8.11 at list prices.
- **a0 at nine checks in ten?** Yes (94.9 %). If arms 0 and 1 both are, the owner decides whether to go on.
- **a1 at nine checks in ten?** Yes (91.2 %). If arms 0 and 1 both are, the owner decides whether to go on.
- **Can fifteen runs resolve 15 points, as a0's runs differ?** A true gain of that size reaches p < 0.05 in 100.0 % of simulated studies (five runs a screen an arm, both arms drawn from a0's own runs). If this is low, the owner chooses, before arm 2 runs, whether both arms get more runs.
- **Can fifteen runs resolve 15 points, as a1's runs differ?** A true gain of that size reaches p < 0.05 in 100.0 % of simulated studies (five runs a screen an arm, both arms drawn from a1's own runs). If this is low, the owner chooses, before arm 2 runs, whether both arms get more runs.

**The bare arm** (ruling 3, scored on which states have a story): 5 of 5 builds read.

- s0.1-t1-bare-1: 12 of 14 states
- s0.1-t1-bare-2: 13 of 14 states
- s0.1-t2-bare-1: 9 of 13 states
- s0.1-t2-bare-2: 9 of 13 states
- s0.1-t3-bare-1: 10 of 10 states
