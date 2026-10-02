import test from "node:test";
import assert from "node:assert/strict";

import { createImouSign, resolveApiBase, sanitizeSharedDevice } from "../src/imou.mjs";

test("Imou signature matches the official standard vector", () => {
  const sign = createImouSign(
    1706511734,
    "f5a1ae2d-c09c-4d39-a744-83a5c2c653c2",
    "test123456789test123456789"
  );
  assert.equal(sign, "fd37b62889e4757c58b8f3bf05fb9976");
});

test("East Asia resolves to the Singapore OpenAPI host", () => {
  assert.equal(resolveApiBase("sg"), "https://openapi-sg.easy4ip.com");
});

test("sanitizer excludes sensitive shared-device fields", () => {
  const sanitized = sanitizeSharedDevice({
    deviceId: "6173BBDPBV6AED4",
    name: "Hiện nhà",
    status: 1,
    deviceModel: "IPC-TEST",
    version: "V1",
    ownerUsername: "owner@example.com",
    playToken: "sensitive-play-token",
    ability: "AlarmMD,WLAN",
    channels: [{
      channelId: "0",
      channelName: "Camera",
      channelOnline: true,
      channelPicUrl: "https://secret-thumbnail.example/",
      channelAbility: "AlarmMD,AudioTalk"
    }]
  });

  assert.equal(sanitized.deviceRef, "***AED4");
  assert.equal(sanitized.status, "online");
  assert.deepEqual(sanitized.abilities, ["AlarmMD", "WLAN"]);
  assert.deepEqual(sanitized.channels[0].abilities, ["AlarmMD", "AudioTalk"]);
  assert.equal("ownerUsername" in sanitized, false);
  assert.equal("playToken" in sanitized, false);
  assert.equal("channelPicUrl" in sanitized.channels[0], false);
});
