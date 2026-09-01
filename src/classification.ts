import { readFile } from "node:fs/promises";

export const CLASSIFICATION_SCHEMA_VERSION = 1;
const EVIDENCE_STATUSES = new Set(["supported", "declared-unwired", "stale-authority", "ambiguous", "out-of-evidence"]);
const DISPOSITION_STATUSES = new Set(["satisfied", "violated", "unresolved", "inapplicable"]);

export interface ClassificationDiagnostic { code: string; message: string; guarantee?: string }
interface GuaranteeDefinition { mandatory: boolean; falsifier: string; allowInapplicable?: boolean }
interface CatalogEntry { activates: string[] }
export interface ClassificationCatalog {
  schemaVersion: number; catalog: string;
  classes: Record<string, CatalogEntry>; facets: Record<string, CatalogEntry>;
  guarantees: Record<string, GuaranteeDefinition>;
}
interface Disposition { status: string; evidence?: string[] }
export interface ClassificationFixture {
  schemaVersion: number; component: string; evidenceStatus: string; primary: string;
  facets: string[]; authority?: string; evidence?: string[];
  dispositions: Record<string, Disposition>;
}
export interface ClassificationResult {
  ok: boolean; catalog: string; component: string; primary: string; facets: string[];
  activatedGuarantees: Array<{ id: string; activatedBy: string[]; status: string | null; evidence: string[]; falsifier: string }>;
  diagnostics: ClassificationDiagnostic[];
}

export const PHASE_ZERO_CATALOG: ClassificationCatalog = {
  schemaVersion: 1,
  catalog: "software-components@0.0.1",
  classes: { "derived-state": { activates: ["G-AUTHORITY"] } },
  facets: { rebuildable: { activates: ["G-AUTHORITY.reconstruction"] } },
  guarantees: {
    "G-AUTHORITY.authority-named": {
      mandatory: true,
      falsifier: "Delete or mutate the representation and reconstruct it from the named authority.",
    },
    "G-AUTHORITY.reconstruction": {
      mandatory: true,
      falsifier: "Exercise the declared rebuild path after representation loss or mutation.",
    },
  },
};

const add = (out: ClassificationDiagnostic[], code: string, message: string, guarantee?: string): void => {
  out.push({ code, message, ...(guarantee ? { guarantee } : {}) });
};
const expand = (activation: string, catalog: ClassificationCatalog): string[] =>
  catalog.guarantees[activation] ? [activation] : Object.keys(catalog.guarantees).filter((id) => id.startsWith(`${activation}.`));

export function checkClassification(fixture: ClassificationFixture, catalog = PHASE_ZERO_CATALOG): ClassificationResult {
  const diagnostics: ClassificationDiagnostic[] = [];
  if (catalog.schemaVersion !== CLASSIFICATION_SCHEMA_VERSION) add(diagnostics, "CATALOG_SCHEMA_UNKNOWN", `catalog schemaVersion ${catalog.schemaVersion} is unsupported`);
  if (fixture.schemaVersion !== CLASSIFICATION_SCHEMA_VERSION) add(diagnostics, "FIXTURE_SCHEMA_UNKNOWN", `fixture schemaVersion ${fixture.schemaVersion} is unsupported`);
  if (!EVIDENCE_STATUSES.has(fixture.evidenceStatus)) add(diagnostics, "EVIDENCE_STATUS_UNKNOWN", `evidenceStatus ${JSON.stringify(fixture.evidenceStatus)} is unsupported`);
  const primary = catalog.classes[fixture.primary];
  if (!primary) add(diagnostics, "CLASS_UNKNOWN", `primary class ${JSON.stringify(fixture.primary)} is not in ${catalog.catalog}`);
  const knownFacets = fixture.facets.filter((facet) => {
    if (catalog.facets[facet]) return true;
    add(diagnostics, "FACET_UNKNOWN", `facet ${JSON.stringify(facet)} is not in ${catalog.catalog}`);
    return false;
  });
  if (fixture.evidenceStatus === "supported" && !fixture.evidence?.length) add(diagnostics, "SUPPORTED_WITHOUT_EVIDENCE", "supported classifications require at least one evidence address");
  if (fixture.primary === "derived-state" && !fixture.authority?.trim()) add(diagnostics, "AUTHORITY_MISSING", "derived-state requires a named upstream authority");

  const sources = new Map<string, Set<string>>();
  const activate = (activation: string, source: string): void => {
    const ids = expand(activation, catalog);
    if (!ids.length) { add(diagnostics, "ACTIVATION_UNKNOWN", `${source} activates unknown guarantee or bundle ${JSON.stringify(activation)}`); return; }
    for (const id of ids) { const set = sources.get(id) ?? new Set<string>(); set.add(source); sources.set(id, set); }
  };
  for (const activation of primary?.activates ?? []) activate(activation, `class:${fixture.primary}`);
  for (const facet of knownFacets) for (const activation of catalog.facets[facet]!.activates) activate(activation, `facet:${facet}`);

  const active = new Set(sources.keys());
  for (const id of Object.keys(fixture.dispositions ?? {}).sort()) {
    const disposition = fixture.dispositions[id]!;
    if (!catalog.guarantees[id]) add(diagnostics, "GUARANTEE_UNKNOWN", `disposition names unknown guarantee ${JSON.stringify(id)}`, id);
    else if (!active.has(id)) add(diagnostics, "GUARANTEE_NOT_ACTIVATED", `disposition names guarantee ${id} but no class or facet activates it`, id);
    if (!DISPOSITION_STATUSES.has(disposition.status)) add(diagnostics, "DISPOSITION_STATUS_UNKNOWN", `guarantee ${id} has unsupported status ${JSON.stringify(disposition.status)}`, id);
  }
  for (const id of [...active].sort()) {
    const definition = catalog.guarantees[id]!;
    const disposition = fixture.dispositions?.[id];
    if (definition.mandatory && !disposition) { add(diagnostics, "MANDATORY_DISPOSITION_MISSING", `mandatory guarantee ${id} has no disposition`, id); continue; }
    if (!disposition) continue;
    if (definition.mandatory && disposition.status === "inapplicable" && !definition.allowInapplicable) add(diagnostics, "MANDATORY_INAPPLICABLE", `mandatory guarantee ${id} cannot be inapplicable`, id);
    if ((disposition.status === "satisfied" || disposition.status === "inapplicable") && !disposition.evidence?.length) add(diagnostics, "DISPOSITION_EVIDENCE_MISSING", `${disposition.status} guarantee ${id} requires evidence`, id);
    if (definition.mandatory && (disposition.status === "violated" || disposition.status === "unresolved")) add(diagnostics, disposition.status === "violated" ? "MANDATORY_VIOLATED" : "MANDATORY_UNRESOLVED", `mandatory guarantee ${id} is ${disposition.status}`, id);
  }
  const activatedGuarantees = [...active].sort().map((id) => ({
    id, activatedBy: [...sources.get(id)!].sort(), status: fixture.dispositions?.[id]?.status ?? null,
    evidence: [...(fixture.dispositions?.[id]?.evidence ?? [])].sort(), falsifier: catalog.guarantees[id]!.falsifier,
  }));
  diagnostics.sort((a, b) => a.code.localeCompare(b.code) || (a.guarantee ?? "").localeCompare(b.guarantee ?? "") || a.message.localeCompare(b.message));
  return { ok: diagnostics.length === 0, catalog: catalog.catalog, component: fixture.component, primary: fixture.primary, facets: [...fixture.facets].sort(), activatedGuarantees, diagnostics };
}

export async function checkClassificationFile(path: string): Promise<ClassificationResult> {
  return checkClassification(JSON.parse(await readFile(path, "utf8")) as ClassificationFixture);
}
export function renderClassificationResult(result: ClassificationResult): string {
  const lines = [`classification ${result.ok ? "PASS" : "FAIL"}: ${result.component}`, `catalog: ${result.catalog}`, `primary: ${result.primary}`, `facets: ${result.facets.length ? result.facets.join(", ") : "none"}`, "activated guarantees:"];
  for (const g of result.activatedGuarantees) {
    lines.push(`  ${g.id}  ${g.status ?? "missing"}  <- ${g.activatedBy.join(", ")}`, `    falsifier: ${g.falsifier}`);
    for (const evidence of g.evidence) lines.push(`    evidence: ${evidence}`);
  }
  if (result.diagnostics.length) { lines.push("diagnostics:"); for (const d of result.diagnostics) lines.push(`  ${d.code}: ${d.message}`); }
  return `${lines.join("\n")}\n`;
}
