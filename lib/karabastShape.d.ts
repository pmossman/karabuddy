// Types for the shared plain-JS karabastShape module (co-located .d.ts, same
// pattern as commentScope). The extension consumes the raw .js; the web app
// gets these types.

export interface ShapeReport {
  ok: boolean;
  issues: string[];
}

export function validateKarabastGamestate(snapshot: unknown): ShapeReport;

// The fixed set of issue codes the beacon may carry — the server validates
// incoming codes against this.
export function knownIssueCodes(): string[];

// The subset of codes that hold even at match start — what the extension
// reports from the first gamestate (avoids early-game false positives).
export function structuralIssueCodes(): string[];
