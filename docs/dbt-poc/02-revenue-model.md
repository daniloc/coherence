# Revenue-model application

- Keep dbt metadata untouched.
- Add Coherence specs at the existing architectural directories.
- Treat each entry family as its own chokepoint with its existing dbt test oracle.
- Declare the important row relationships in `coherence.dbt.json`.
- Generate the dbt snapshot, then run `coherence graph`, `verify --fast`, and
  `log` against the result.

