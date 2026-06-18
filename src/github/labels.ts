// src/github/labels.ts — Krites's OWN isolated label namespace, defined as a typed const exactly the
// way koine defines PRAKTOR_LABELS. These are on-wire contracts written to GitHub; change only with a
// migration. Kept local (not in koine) so Krites ships independently; promote to koine if shared.
export const KRITES_LABELS = {
  reviewing: "krites:reviewing", // claimed and under review
  approved: "krites:approved", // approved; gated auto-merge enabled
  changesRequested: "krites:changes-requested", // review asked for changes
} as const;

export type KritesLabel = (typeof KRITES_LABELS)[keyof typeof KRITES_LABELS];
