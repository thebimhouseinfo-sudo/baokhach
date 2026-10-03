export const LIVE_DIM_IDLE_MS = 45000;

export function shouldDimLive({
  active,
  lastInteractionAt,
  now = Date.now(),
  idleMs = LIVE_DIM_IDLE_MS
}) {
  if (!active) return false;
  const last = Number(lastInteractionAt || 0);
  if (!last) return false;
  return now - last >= idleMs;
}

export function shouldStopLiveForVisibility(visibilityState) {
  return visibilityState !== "visible";
}
