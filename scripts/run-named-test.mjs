#!/usr/bin/env node
// Thin entry only — the logic lives INSIDE the evidence perimeter at
// src/run-named-test.ts (sources: ["src"]), where it is claimed and tested.
import { runNamedTest } from "../src/run-named-test.ts";
process.exit(runNamedTest(process.argv[2]));
