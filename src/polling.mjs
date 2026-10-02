export const POLL_INTERVAL_MS = 15000;

export function shouldPoll(visibilityState) {
  return visibilityState === "visible";
}

export function shouldPollImmediatelyOnVisibilityChange(previous, next) {
  return previous !== "visible" && next === "visible";
}
