# goldseam benchmark

Model: `claude` · 4/4 mutations matched expectation.

| Mutation | Selector style | Expected | Outcome | Attempts | Time |
| --- | --- | --- | --- | --- | --- |
| testid-rename | data-testid | healed | ✔ healed | 1 | 22s |
| id-rename-multi-occurrence | id | healed | ✔ healed | 2 | 30s |
| class-rename | css-class | healed | ✔ healed | 1 | 23s |
| copy-change-not-a-selector-break | text-assertion | gave-up | ✔ gave-up | 1 | 22s |
