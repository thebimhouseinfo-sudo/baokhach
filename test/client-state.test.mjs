import test from "node:test";
import assert from "node:assert/strict";

import {
  COOLDOWN_MS,
  cooldownRemainingMs,
  ingestHumanEvents,
  markAlertPlayed,
  normalizeClientState
} from "../src/client-state.mjs";
import {
  POLL_INTERVAL_MS,
  shouldPoll,
  shouldPollImmediatelyOnVisibilityChange
} from "../src/polling.mjs";

const event = (eventRef, occurredAtMs) => ({ eventRef, occurredAtMs });

test("first response creates a baseline without announcing old history", () => {
  const result = ingestHumanEvents(
    normalizeClientState(),
    [event("old-1", 1000), event("old-2", 2000)],
    5000
  );

  assert.equal(result.baselineCreated, true);
  assert.equal(result.shouldAnnounce, false);
  assert.equal(result.state.lastSeenEventRef, "old-2");
  assert.equal(result.state.lastDetectionAtMs, 2000);
});

test("duplicate event is ignored", () => {
  const initial = {
    lastSeenEventRef: "same",
    lastSeenAtMs: 1000,
    lastDetectionAtMs: 1000,
    lastAlertAtMs: 0
  };

  const result = ingestHumanEvents(initial, [event("same", 1000)], 5000);
  assert.equal(result.unseenCount, 0);
  assert.equal(result.shouldAnnounce, false);
});

test("new event is suppressed at 299 seconds without extending cooldown", () => {
  const lastAlertAtMs = 1000000;
  const nowMs = lastAlertAtMs + 299000;
  const initial = {
    lastSeenEventRef: "seen",
    lastSeenAtMs: 1000,
    lastDetectionAtMs: 1000,
    lastAlertAtMs
  };

  const result = ingestHumanEvents(
    initial,
    [event("seen", 1000), event("new", 2000)],
    nowMs
  );

  assert.equal(result.shouldAnnounce, false);
  assert.equal(result.state.lastSeenEventRef, "new");
  assert.equal(result.state.lastAlertAtMs, lastAlertAtMs);
  assert.equal(cooldownRemainingMs(result.state, nowMs), 1000);
});

test("new event can announce at 300 seconds and alert time changes only after playback mark", () => {
  const lastAlertAtMs = 1000000;
  const nowMs = lastAlertAtMs + COOLDOWN_MS;
  const initial = {
    lastSeenEventRef: "seen",
    lastSeenAtMs: 1000,
    lastDetectionAtMs: 1000,
    lastAlertAtMs
  };

  const result = ingestHumanEvents(
    initial,
    [event("seen", 1000), event("new", 2000)],
    nowMs
  );

  assert.equal(result.shouldAnnounce, true);
  assert.equal(result.state.lastAlertAtMs, lastAlertAtMs);

  const played = markAlertPlayed(result.state, nowMs);
  assert.equal(played.lastAlertAtMs, nowMs);
});

test("multiple unseen events collapse to the newest seen marker and one alert candidate", () => {
  const initial = {
    lastSeenEventRef: "seen",
    lastSeenAtMs: 1000,
    lastDetectionAtMs: 1000,
    lastAlertAtMs: 0
  };

  const result = ingestHumanEvents(
    initial,
    [event("seen", 1000), event("new-1", 2000), event("new-2", 3000)],
    5000
  );

  assert.equal(result.unseenCount, 2);
  assert.equal(result.shouldAnnounce, true);
  assert.equal(result.state.lastSeenEventRef, "new-2");
  assert.equal(result.state.lastDetectionAtMs, 3000);
});

test("serialized state fields restore without resetting cooldown", () => {
  const restored = normalizeClientState(
    JSON.parse(JSON.stringify({
      lastSeenEventRef: "saved",
      lastSeenAtMs: 2000,
      lastDetectionAtMs: 2000,
      lastAlertAtMs: 3000
    }))
  );

  assert.equal(restored.lastSeenEventRef, "saved");
  assert.equal(restored.lastAlertAtMs, 3000);
});

test("polling policy is 15 seconds and only active in visible pages", () => {
  assert.equal(POLL_INTERVAL_MS, 15000);
  assert.equal(shouldPoll("visible"), true);
  assert.equal(shouldPoll("hidden"), false);
  assert.equal(shouldPollImmediatelyOnVisibilityChange("hidden", "visible"), true);
  assert.equal(shouldPollImmediatelyOnVisibilityChange("visible", "visible"), false);
});
