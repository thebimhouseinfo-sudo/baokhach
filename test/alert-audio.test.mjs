import test from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_VOLUME_LEVELS,
  DEFAULT_ALERT_VOLUME_LEVEL,
  normalizeAlertVolumeLevel,
  alertVolumeForLevel,
  alertVolumeLabel
} from "../src/alert-audio.mjs";

test("alert volume defaults to Vừa lớn", () => {
  assert.equal(DEFAULT_ALERT_VOLUME_LEVEL, "loud");
  assert.equal(normalizeAlertVolumeLevel("unknown"), "loud");
  assert.equal(alertVolumeLabel("loud"), "Vừa lớn");
});

test("alert volume offers only Vừa lớn and Rất lớn levels", () => {
  assert.deepEqual(Object.keys(ALERT_VOLUME_LEVELS).sort(), ["loud", "max"]);
  assert.equal(alertVolumeForLevel("loud"), 0.68);
  assert.equal(alertVolumeForLevel("max"), 1);
  assert.equal(alertVolumeLabel("max"), "Rất lớn");
});
