import test from "node:test";
import assert from "node:assert/strict";

import {
  queryHumanDetections,
  sanitizeHumanAlarm
} from "../src/imou.mjs";
import { buildHumanEventsResponse } from "../src/human-api.mjs";

test("human sanitizer accepts only type 33000 and hides raw alarm fields", () => {
  const rejected = sanitizeHumanAlarm({
    alarmId: "motion-1",
    type: 1001,
    time: 1700000000
  });
  assert.equal(rejected, null);

  const accepted = sanitizeHumanAlarm({
    alarmId: "human-secret-id",
    type: 33000,
    time: 1700000000,
    deviceId: "SERIAL-SECRET",
    thumbUrl: "https://secret.example/thumb.jpg",
    picurlArray: ["https://secret.example/full.jpg"]
  });

  assert.equal(typeof accepted.eventRef, "string");
  assert.equal(accepted.eventRef.length, 20);
  assert.equal(accepted.occurredAtMs, 1700000000000);
  assert.equal(JSON.stringify(accepted).includes("human-secret-id"), false);
  assert.equal(JSON.stringify(accepted).includes("SERIAL-SECRET"), false);
  assert.equal(JSON.stringify(accepted).includes("secret.example"), false);
});

test("production human query calls accessToken then getAlarmMessage directly", async () => {
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
              data: { accessToken: "token-pull-test", expireTime: 3600 }
            }
          };
        }
      };
    }

    if (url.endsWith("/openapi/getAlarmMessage")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              code: "0",
              data: {
                count: 2,
                alarms: [
                  {
                    alarmId: "raw-human-id",
                    type: 33000,
                    time: 1700000060,
                    channelId: "0",
                    thumbUrl: "https://secret.example/human.jpg"
                  },
                  {
                    alarmId: "raw-motion-id",
                    type: 1001,
                    time: 1700000000,
                    channelId: "0"
                  }
                ]
              }
            }
          };
        }
      };
    }

    throw new Error("Unexpected URL " + url);
  };

  const result = await queryHumanDetections({
    appId: "pull-app-unique",
    appSecret: "pull-secret",
    deviceId: "TARGET-SERIAL",
    channelId: "0",
    dataCenter: "sg",
    fetchImpl,
    now: new Date("2026-10-02T06:00:00Z")
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.endsWith("/openapi/accessToken"), true);
  assert.equal(calls[1].url.endsWith("/openapi/getAlarmMessage"), true);
  assert.equal(calls.some((call) => call.url.includes("shareDeviceList")), false);
  assert.equal(calls[1].params.deviceId, "TARGET-SERIAL");
  assert.equal(calls[1].params.channelId, "0");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].occurredAtMs, 1700000060000);
  assert.equal(JSON.stringify(result).includes("raw-human-id"), false);
  assert.equal(JSON.stringify(result).includes("secret.example"), false);
});

test("unauthorized pull request is rejected before the Imou query", async () => {
  let queryCalls = 0;
  const response = await buildHumanEventsResponse({
    method: "GET",
    headers: { authorization: "Bearer wrong-key" },
    env: {
      IMOU_APP_ID: "app",
      IMOU_APP_SECRET: "secret",
      IMOU_DEVICE_ID: "device",
      IMOU_CHANNEL_ID: "0",
      BAOKHACH_APP_KEY: "right-key"
    },
    queryFn: async () => {
      queryCalls += 1;
      return { checkedAt: "never", events: [] };
    }
  });

  assert.equal(response.status, 401);
  assert.equal(queryCalls, 0);
});

test("authorized pull request forwards fixed device configuration", async () => {
  let received;
  const response = await buildHumanEventsResponse({
    method: "GET",
    headers: { authorization: "Bearer right-key" },
    env: {
      IMOU_APP_ID: "app",
      IMOU_APP_SECRET: "secret",
      IMOU_DEVICE_ID: "fixed-device",
      IMOU_CHANNEL_ID: "0",
      IMOU_DATA_CENTER: "sg",
      BAOKHACH_APP_KEY: "right-key"
    },
    queryFn: async (input) => {
      received = input;
      return {
        checkedAt: "2026-10-02T06:00:00.000Z",
        events: [{ eventRef: "abc", occurredAtMs: 1700000000000 }]
      };
    }
  });

  assert.equal(response.status, 200);
  assert.equal(received.deviceId, "fixed-device");
  assert.equal(received.channelId, "0");
  assert.equal(response.body.events.length, 1);
});
