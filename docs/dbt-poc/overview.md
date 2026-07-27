# dbt PoC

Teach original Coherence to understand a dbt DAG without parsing SQL or putting
Coherence metadata into dbt models.

1. `01-adapter-and-ledger.md` adds a dbt graph contributor, a normalized committed
   snapshot, fail-closed semantic declarations, and dbt-aware structural diffs.
2. `02-revenue-model.md` applies it to revenue-model with specs around the event
   spine, allocation, entry-family chokepoints, ledger, projections, and diagnostics.

