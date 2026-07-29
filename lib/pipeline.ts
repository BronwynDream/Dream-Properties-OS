// Deal lifecycle vocabulary for the Pipeline kanban.
//
// Order matches the SA estate-agency progression per the estate-agency-
// design skill: mandate → active → viewings → offer → under-offer →
// conditions → transfer → registered. Our transfer_status enum
// (migration 0001) folds a few of those stages together but the
// left-to-right ordering below is the canonical flow. The kanban
// renders one column per PIPELINE_STAGES entry (terminal states —
// registered, cancelled, lapsed — get their own compact "done" strip).

export type PipelineStage =
  | "preparing"
  | "mandate"
  | "listed"
  | "under_offer"
  | "sale_agreed"
  | "in_conveyancing";

export type TerminalStage = "registered" | "cancelled" | "lapsed";

export type AnyStage = PipelineStage | TerminalStage;

// Live stages (rendered as kanban columns) in the order Bronwyn thinks
// about them. Left → right = time flowing toward registration.
export const PIPELINE_STAGES: PipelineStage[] = [
  "preparing",
  "mandate",
  "listed",
  "under_offer",
  "sale_agreed",
  "in_conveyancing",
];

// Terminal states — either successfully closed or dead.
export const TERMINAL_STAGES: TerminalStage[] = ["registered", "cancelled", "lapsed"];

export const STAGE_LABEL: Record<AnyStage, string> = {
  preparing:       "Preparing",
  mandate:         "Mandate signed",
  listed:          "Active listing",
  under_offer:     "Under offer",
  sale_agreed:     "Sale agreed",
  in_conveyancing: "Conveyancing",
  registered:      "Registered",
  cancelled:       "Cancelled",
  lapsed:          "Lapsed",
};

// Short description shown under each column head so an unfamiliar reader
// knows what's meant to happen in the stage.
export const STAGE_HELP: Record<AnyStage, string> = {
  preparing:       "Take-on in progress — no mandate yet",
  mandate:         "Signed mandate, not yet on the market",
  listed:          "On the market — chasing offers",
  under_offer:     "OTP signed, suspensive conditions outstanding",
  sale_agreed:     "Conditions fulfilled, awaiting conveyancer instruction",
  in_conveyancing: "With the conveyancer — awaiting lodgment / registration",
  registered:      "Transfer registered — commission earned",
  cancelled:       "Deal fell over — buyer or seller withdrew",
  lapsed:          "Time expired — no live offer / no signed mandate renewal",
};

// Colour tokens per column — left edge of each card + column stripe.
// Matches the estate-agency-design skill's stage progression:
//   grey (early) → accent (active) → caution (offer) → positive (registered).
export const STAGE_STRIPE: Record<AnyStage, string> = {
  preparing:       "var(--ink-400, #8C8172)",
  mandate:         "var(--ink-400, #8C8172)",
  listed:          "var(--accent-600, #132B84)",
  under_offer:     "var(--caution, #A9772F)",
  sale_agreed:     "var(--caution, #A9772F)",
  in_conveyancing: "#566B4E",
  registered:      "var(--positive, #4B6B4A)",
  cancelled:       "var(--critical, #9A3B34)",
  lapsed:          "var(--ink-500, #6B6153)",
};

// Given a stage, what's the "advance" (next) stage? Kanban's inline
// "advance →" button uses this. Registered / cancelled / lapsed are
// terminal — no advance from them.
export function nextStage(stage: AnyStage): AnyStage | null {
  const idx = PIPELINE_STAGES.indexOf(stage as PipelineStage);
  if (idx === -1) return null; // terminal
  if (idx === PIPELINE_STAGES.length - 1) return "registered";
  return PIPELINE_STAGES[idx + 1];
}

// And the reverse — "back to previous stage" for the ← button.
export function prevStage(stage: AnyStage): AnyStage | null {
  const idx = PIPELINE_STAGES.indexOf(stage as PipelineStage);
  if (idx <= 0) return null;
  return PIPELINE_STAGES[idx - 1];
}
