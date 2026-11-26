# Step 0.4

## By journal path (original rule)

| Pair | Meets a fault | Clean | Seeded 1 | Seeded 2 | Worse in both |
| --- | --- | --- | --- | --- | --- |
| p1 t1 | yes | done, 0 | not done, 0 | not done, 0 | yes |
| p2 t1 | yes | done, 3 | not done, 0 | not done, 0 | yes |
| p3 t1 | yes | done, 3 | done, 3 | done, 2 | no |
| p4 t1 | no | done, 3 | done, 3 | done, 3 | no |
| p5 t1 | yes | done, 3 | done, 1 | done, 1 | no |
| p1 t2 | yes | not done, 0 | not done, 0 | not done, 0 | no |
| p2 t2 | yes | not done, 0 | not done, 0 | not done, 0 | no |
| p3 t2 | yes | done, 0 | done, 0 | done, 0 | no |
| p4 t2 | no | not done, 0 | not done, 0 | not done, 0 | no |
| p5 t2 | yes | done, 0 | done, 0 | done, 0 | no |
| p1 t3 | yes | done, 0 | done, 0 | done, 0 | no |
| p2 t3 | yes | done, 0 | not done, 0 | not done, 0 | yes |
| p3 t3 | yes | done, 0 | done, 0 | done, 0 | no |
| p4 t3 | no | done, 0 | done, 0 | done, 0 | no |
| p5 t3 | yes | done, 0 | done, 0 | done, 0 | no |
| p1 t4 | no | done, 0 | done, 0 | done, 0 | no |
| p2 t4 | no | done, 0 | done, 0 | done, 0 | no |
| p3 t4 | no | done, 0 | done, 0 | done, 0 | no |
| p4 t4 | yes | done, 0 | done, 0 | done, 0 | no |
| p5 t4 | no | done, 0 | done, 0 | done, 0 | no |

- **Pairs that meet a fault, worse in both seeded walks:** 3 of 13 (23.1 %; the rule asks three quarters).
- **Pairs that meet none:** 7 of 7 within the seeded walks' own spread.
- **The rule (path):** not met.

## By blind report comparison (tuned measure)

| Pair | Meets a fault | Seeded 1 vs clean | Seeded 2 vs clean | Seeded worse in both |
| --- | --- | --- | --- | --- |
| p1 t1 | yes | seeded | seeded | yes |
| p2 t1 | yes | seeded | seeded | yes |
| p3 t1 | yes | seeded | same | no |
| p4 t1 | no | clean | clean | no |
| p5 t1 | yes | seeded | seeded | yes |
| p1 t2 | yes | seeded | seeded | yes |
| p2 t2 | yes | seeded | seeded | yes |
| p3 t2 | yes | seeded | seeded | yes |
| p4 t2 | no | seeded | seeded | yes |
| p5 t2 | yes | seeded | seeded | yes |
| p1 t3 | yes | seeded | seeded | yes |
| p2 t3 | yes | seeded | seeded | yes |
| p3 t3 | yes | seeded | seeded | yes |
| p4 t3 | no | clean | clean | no |
| p5 t3 | yes | seeded | seeded | yes |
| p1 t4 | no | same | same | no |
| p2 t4 | no | clean | clean | no |
| p3 t4 | no | clean | same | no |
| p4 t4 | yes | seeded | seeded | yes |
| p5 t4 | no | same | same | no |

- **Pairs that meet a fault, seeded worse in both walks:** 12 of 13 (92.3 %; three quarters target).
- **Pairs that meet none:** 6 of 7 not worse in both (individual calls: 5 same, 2 seeded, 7 clean).
- **The rule (report):** not met.
