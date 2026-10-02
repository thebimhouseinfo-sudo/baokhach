import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCallbackBody,
  safeSecretEqual,
  sanitizeAlarmEvent
} from "../src/callback.mjs";

test("callback key comparison rejects empty and mismatched values", () => {
  assert.equal(safeSecretEqual("", ""), false);
  assert.equal(safeSecretEqual("secret-a", "secret-b"), false);
  assert.equal(safeSecretEqual("same-secret", "same-secret"), true);
});

test("callback body accepts an already parsed JSON object", () => {
  const body = { msgType: "human", id: 42 };
  assert.equal(parseCallbackBody(body), body);
});

test("alarm sanitizer keeps evidence but drops sensitive payload values", () => {
  const payload = {
    id: 2447736561,
    appId: "app-123",
    did: "6173BBDPBV6AED4",
    cid: 0,
    msgType: "human",
    time: 1475052555,
    cname: "Hiên nhà",
    token: "cloud-recording-token",
    picUrlArray: ["https://secret.example/picture.jpg"],
    remark: "private remark",
    desc: {
      secretValue: "do-not-log",
      region: "front-door"
    }
  };

  const sanitized = sanitizeAlarmEvent(payload, {
    expectedAppId: "app-123",
    headers: {
      "user-agent": "ImouPush/1.0",
      "x-imou-signature": "secret-signature",
      authorization: "Bearer hidden"
    }
  });

  assert.equal(sanitized.msgType, "human");
  assert.equal(sanitized.humanCandidate, true);
  assert.equal(sanitized.deviceRef, "***AED4");
  assert.equal(sanitized.appIdMatches, true);
  assert.deepEqual(sanitized.descKeys, ["region", "secretValue"]);
  assert.deepEqual(sanitized.securityHeaderNames, [
    "authorization",
    "x-imou-signature"
  ]);
  assert.equal(sanitized.userAgent, "ImouPush/1.0");
  assert.equal("token" in sanitized, false);
  assert.equal("picUrlArray" in sanitized, false);
  assert.equal("remark" in sanitized, false);
  assert.equal(JSON.stringify(sanitized).includes("do-not-log"), false);
  assert.equal(JSON.stringify(sanitized).includes("cloud-recording-token"), false);
});

test("event fingerprint is stable for repeat-delivery measurement", () => {
  const payload = {
    id: 123,
    did: "DEVICE-1",
    cid: 0,
    msgType: "human",
    time: 1700000000
  };

  const first = sanitizeAlarmEvent(payload).eventFingerprint;
  const second = sanitizeAlarmEvent({ ...payload }).eventFingerprint;
  const changed = sanitizeAlarmEvent({ ...payload, id: 124 }).eventFingerprint;

  assert.equal(first, second);
  assert.notEqual(first, changed);
});
