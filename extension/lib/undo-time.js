export const UNDO_DURATION = 60_000;
export const undoExpiry = (batch) => batch.expiresAt ?? batch.at + UNDO_DURATION;
