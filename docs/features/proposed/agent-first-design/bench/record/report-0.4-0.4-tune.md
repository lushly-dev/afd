# Step 0.4

## By journal path (original rule)

| Pair | Meets a fault | Clean | Seeded 1 | Seeded 2 | Worse in both |
| --- | --- | --- | --- | --- | --- |
| p5 t1 | yes | done, 2 | done, 1 | done, 1 | no |
| p2 t2 | yes | done, 0 | not done, 0 | not done, 1 | yes |
| p3 t3 | yes | done, 0 | done, 0 | done, 0 | no |
| p1 t4 | no | done, 0 | done, 0 | done, 0 | no |
| p4 t4 | yes | done, 0 | done, 0 | done, 0 | no |

- **Pairs that meet a fault, worse in both seeded walks:** 1 of 4 (25.0 %; the rule asks three quarters).
- **Pairs that meet none:** 1 of 1 within the seeded walks' own spread.
- **The rule (path):** not met.

## By blind report comparison (tuned measure)

| Pair | Meets a fault | Seeded 1 vs clean | Seeded 2 vs clean | Seeded worse in both |
| --- | --- | --- | --- | --- |
| p5 t1 | yes | seeded | seeded | yes |
| p2 t2 | yes | seeded | seeded | yes |
| p3 t3 | yes | seeded | seeded | yes |
| p1 t4 | no | clean | same | no |
| p4 t4 | yes | seeded | seeded | yes |

- **Pairs that meet a fault, seeded worse in both walks:** 4 of 4 (100.0 %; three quarters target).
- **Pairs that meet none:** 1 of 1 not worse in both (individual calls: 1 same, 0 seeded, 1 clean).
- **The rule (report):** met.
