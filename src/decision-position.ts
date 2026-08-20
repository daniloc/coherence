// decision-position.ts — derive ratification and conflict from explicit decision fields.
//
// This module does not guess that two prose labels concern the same question. Only a
// shared `subject` enters the comparison, and only an explicit authority grade outranks
// another record. Historical decisions without those fields remain readable but do not
// become accidental swarm policy.
import { resolve, type DecisionAuthority, type DecisionRecord } from "./decisions.ts";

export type DecisionPositionState = "aligned" | "needs-ratification" | "ratified" | "contested";

export interface DecisionPosition {
  subject: string;
  state: DecisionPositionState;
  /** Distinct standing choices, byte-ordered. */
  choices: string[];
  records: DecisionRecord[];
  /** Present only when one explicitly stronger authority selects one choice. */
  selected: DecisionRecord | null;
  reason: string;
}

const authorityRank: Record<DecisionAuthority, number> = {
  "local-proposal": 1,
  "orchestrator-accepted": 2,
  "user-directed": 3,
};
const byteCompare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** One derived position per machine-addressable subject. Retractions are respected via
 * the journal's canonical resolver. Missing authority remains ungraded and can align,
 * but can never ratify or outrank another record. */
export function analyzeDecisionPositions(records: DecisionRecord[]): DecisionPosition[] {
  const standing = resolve(records).standing.filter((record) => !!record.subject);
  const grouped = new Map<string, DecisionRecord[]>();
  for (const record of standing) {
    const rows = grouped.get(record.subject!) ?? [];
    rows.push(record);
    grouped.set(record.subject!, rows);
  }
  const positions: DecisionPosition[] = [];
  for (const [subject, rows] of grouped) {
    rows.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const choices = [...new Set(rows.map((record) => record.chose))].sort(byteCompare);
    if (choices.length === 1) {
      positions.push({
        subject, state: "aligned", choices, records: rows, selected: rows.at(-1) ?? null,
        reason: `${rows.length} standing record(s) agree on one choice`,
      });
      continue;
    }
    const graded = rows.filter((record): record is DecisionRecord & { authority: DecisionAuthority } => !!record.authority);
    const highest = graded.length ? Math.max(...graded.map((record) => authorityRank[record.authority])) : 0;
    const leaders = graded.filter((record) => authorityRank[record.authority] === highest);
    const leaderChoices = new Set(leaders.map((record) => record.chose));
    if (highest >= authorityRank["orchestrator-accepted"] && leaderChoices.size === 1) {
      const selected = leaders.at(-1) ?? null;
      positions.push({
        subject, state: "ratified", choices, records: rows, selected,
        reason: `${selected!.authority} explicitly selects one choice over lower-authority alternatives`,
      });
    } else if (highest <= authorityRank["local-proposal"]) {
      positions.push({
        subject, state: "needs-ratification", choices, records: rows, selected: null,
        reason: "multiple choices survive with no orchestrator-accepted or user-directed selection",
      });
    } else {
      positions.push({
        subject, state: "contested", choices, records: rows, selected: null,
        reason: `${leaders.length} highest-authority records retain ${leaderChoices.size} incompatible choices`,
      });
    }
  }
  return positions.sort((a, b) => byteCompare(a.subject, b.subject));
}
