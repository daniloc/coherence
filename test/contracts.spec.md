# Executable contracts

Exercises the harness through focused unit contracts and end-to-end fixtures built from
the same public data shapes that consuming repositories use.

Tests are evidence for the source components, but they are their own ownership surface:
a change here should not make staged verification pretend the harness implementation moved.

## works when

- _helpers.ts exists at this node
- verify.test.ts exists at this node
- decisions.test.ts exists at this node
- commands.test.ts exists at this node

## why

The shared fixture builders, verifier tests, journal tests, and command-registry tests are
the suite's load-bearing entry points. Naming them makes the evidence surface visible
without turning hundreds of individual test cases into an agent's component map.
