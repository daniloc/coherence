# dbt semantic-boundary stack

This stack extends the dbt adapter from PR #8 with two declarations needed by
property-bearing analytical chokepoints. It deliberately keeps executable SQL
inside the dbt repository: Coherence validates and versions the property surface,
while repository tests define and prove row semantics.

Review and merge bottom-up:

1. **Observer leaves**
   - `observers` selects diagnostic models that may inspect chokepoint shadows.
   - A model dependency on an observer fails; dbt tests may inspect observers.
   - Selectors fail closed and observer classification appears in `coherence log`.
   - Proof: focused observer/shadow fixtures plus the complete harness suite.

2. **Conditional row contracts**
   - `rowContracts` declares a model, discriminator, variants, required columns,
     optional predicate labels, and one exact dbt test oracle.
   - Models, discriminators, variants, required columns, and oracles fail closed.
   - Variant and required-field changes appear in `coherence log`.
   - Coherence executes the named oracle through the existing dbt test runner.

3. **Property documentation**
   - Explain grain, relationships, invariants, row contracts, oracles, shadows,
     and observers as distinct, composable guarantees.
   - Keep documentation examples covered by harness fixtures.

The stack is based on `codex/dbt-poc-01-adapter`, the open PR #8 head used by
the revenue-model package.
