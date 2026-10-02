import test from "node:test";
import assert from "node:assert/strict";

import { createImouSign, readMessageCallback, registerAlarmCallback, resolveApiBase, sanitizeCallbackUrl, sanitizeSharedDevice } from "../src/imou.mjs";

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


test("callback URL sanitizer never returns query-string secrets", () => {
  const target = sanitizeCallbackUrl(
    "https://baokhach.example/api/imou-callback?k=very-secret-value"
  );

  assert.deepEqual(target, {
    origin: "https://baokhach.example",
    pathname: "/api/imou-callback",
    hasQuery: true
  });
  assert.equal(JSON.stringify(target).includes("very-secret-value"), false);
});

test("alarm callback registration uses alarm-only push and sanitized verification", async () => {
  const calls = [];

  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, params: body.params });

    if (url.endsWith("/openapi/accessToken")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              code: "0",
              data: {
                accessToken: "test-access-token",
                expireTime: 3600
              }
            }
          };
        }
      };
    }

    if (url.endsWith("/openapi/setMessageCallback")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { result: { code: "0", msg: "ok" } };
        }
      };
    }

    if (url.endsWith("/openapi/getMessageCallback")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              code: "0",
              data: {
                status: "on",
                callbackFlag: "alarm",
                callbackUrl:
                  "https://baokhach.example/api/imou-callback?k=test-callback-key"
              }
            }
          };
        }
      };
    }

    throw new Error("Unexpected mock URL: " + url);
  };

  const config = {
    appId: "test-app-gate-b",
    appSecret: "test-secret-gate-b",
    callbackUrl:
      "https://baokhach.example/api/imou-callback?k=test-callback-key",
    dataCenter: "sg",
    fetchImpl
  };

  const registered = await registerAlarmCallback(config);
  const current = await readMessageCallback(config);

  const setCall = calls.find((entry) =>
    entry.url.endsWith("/openapi/setMessageCallback")
  );

  assert.equal(setCall.params.status, "on");
  assert.equal(setCall.params.callbackFlag, "alarm");
  assert.equal(setCall.params.basePush, "1");
  assert.equal(setCall.params.token, "test-access-token");
  assert.equal(registered.callbackTarget.hasQuery, true);
  assert.equal(current.status, "on");
  assert.equal(current.callbackFlag, "alarm");
  assert.equal(current.callbackTarget.hasQuery, true);
  assert.equal(
    JSON.stringify({ registered, current }).includes("test-callback-key"),
    false
  );
});
