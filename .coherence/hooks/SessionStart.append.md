COHERENCE MAINTAINER CONTRACT — keep the project hook and packaged hook in step.

If a change adds or changes a public agent-facing command or coordination function,
review whether the global lifecycle instructions must expose it. This includes changes
to command registration, orientation, work, experiments, consequences, and the exact
actions an owner can take from a work order.

Before finishing that change:

- compare the new behavior with `agentInstructions` and `assignedWorkInstructions` in
  `src/hooks.ts`; bounded startup context may omit a capability only by explicit choice;
- when emitted meaning changes, bump `HOOK_BODY_PROTOCOL_VERSION` in `src/control.ts`;
- regenerate both tracked controls with `{{cli}} hooks install --host codex` and
  `{{cli}} hooks install --host claude`;
- update the exact hook/control tests, packed-consumer smoke, README, and generated docs,
  then run both host checks.

Record an intentional omission in the decision journal. Silence must not be the way the
project decides that a new capability does not belong in the global hook.
