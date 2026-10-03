export const COOLDOWN_MS = 300000;

export function normalizeClientState(value = {}) {
  return {
    lastSeenEventRef:
      typeof value.lastSeenEventRef === "string" ? value.lastSeenEventRef : null,
    lastSeenAtMs: Number.isFinite(Number(value.lastSeenAtMs))
      ? Number(value.lastSeenAtMs)
      : 0,
    lastDetectionAtMs: Number.isFinite(Number(value.lastDetectionAtMs))
      ? Number(value.lastDetectionAtMs)
      : 0,
    lastAlertAtMs: Number.isFinite(Number(value.lastAlertAtMs))
      ? Number(value.lastAlertAtMs)
      : 0
  };
}

function normalizeEvent(event) {
  const eventRef =
    typeof event?.eventRef === "string" && event.eventRef
      ? event.eventRef
      : null;
  const occurredAtMs = Number(event?.occurredAtMs || 0);

  if (!eventRef) return null;

  return {
    eventRef,
    occurredAtMs: Number.isFinite(occurredAtMs) ? occurredAtMs : 0
  };
}

export function ingestHumanEvents(currentState, inputEvents, nowMs = Date.now()) {
  const state = normalizeClientState(currentState);
  const events = (Array.isArray(inputEvents) ? inputEvents : [])
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.occurredAtMs !== b.occurredAtMs) {
        return a.occurredAtMs - b.occurredAtMs;
      }
      return a.eventRef.localeCompare(b.eventRef);
    });

  if (!events.length) {
    return { state, shouldAnnounce: false, baselineCreated: false, unseenCount: 0 };
  }

  if (!state.lastSeenEventRef) {
    const newest = events[events.length - 1];
    return {
      state: {
        ...state,
        lastSeenEventRef: newest.eventRef,
        lastSeenAtMs: newest.occurredAtMs,
        lastDetectionAtMs: newest.occurredAtMs
      },
      shouldAnnounce: false,
      baselineCreated: true,
      unseenCount: 0
    };
  }

  const seenIndex = events.findIndex(
    (event) => event.eventRef === state.lastSeenEventRef
  );

  let unseen;
  if (seenIndex >= 0) {
    unseen = events.slice(seenIndex + 1);
  } else if (state.lastSeenAtMs > 0) {
    unseen = events.filter((event) => event.occurredAtMs > state.lastSeenAtMs);
  } else {
    unseen = events.filter((event) => event.eventRef !== state.lastSeenEventRef);
  }

  if (!unseen.length) {
    return { state, shouldAnnounce: false, baselineCreated: false, unseenCount: 0 };
  }

  const newest = unseen[unseen.length - 1];
  const nextState = {
    ...state,
    lastSeenEventRef: newest.eventRef,
    lastSeenAtMs: newest.occurredAtMs,
    lastDetectionAtMs: newest.occurredAtMs
  };

  const cooldownElapsed =
    !state.lastAlertAtMs || nowMs - state.lastAlertAtMs >= COOLDOWN_MS;

  return {
    state: nextState,
    shouldAnnounce: cooldownElapsed,
    baselineCreated: false,
    unseenCount: unseen.length
  };
}

export function markAlertPlayed(currentState, nowMs = Date.now()) {
  return {
    ...normalizeClientState(currentState),
    lastAlertAtMs: nowMs
  };
}

export function cooldownRemainingMs(currentState, nowMs = Date.now()) {
  const state = normalizeClientState(currentState);
  if (!state.lastAlertAtMs) return 0;
  return Math.max(0, COOLDOWN_MS - (nowMs - state.lastAlertAtMs));
}


export function finalizeAlertAttempt(
  previousState,
  ingestResult,
  played,
  nowMs = Date.now()
) {
  if (!ingestResult?.shouldAnnounce) {
    return normalizeClientState(ingestResult?.state ?? previousState);
  }

  if (!played) {
    return normalizeClientState(previousState);
  }

  return markAlertPlayed(ingestResult.state, nowMs);
}
