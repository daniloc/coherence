# Adapter and structural ledger

- Read dbt's `manifest.json`; do not parse SQL.
- Normalize it into a deterministic snapshot that works across git refs.
- Add dbt resources and dependency edges to the Coherence graph.
- Load roles, grain, multiplicity, and filtering declarations from a separate
  Coherence JSON file and fail closed on dangling declarations.
- Diff resources, dependencies, declared columns, materialization, roles, grain,
  and relationship contracts in `coherence log`.

