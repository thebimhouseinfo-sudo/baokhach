import test from "node:test";
import assert from "node:assert/strict";

import {
  ImouApiError,
  ensureLiveStream,
  selectSecureSdLiveStream
} from "../src/imou.mjs";
import { buildLiveSessionResponse } from "../src/live-api.mjs";
import {
  LIVE_DIM_IDLE_MS,
  shouldDimLive,
  shouldStopLiveForVisibility,
  liveToggleLabel
} from "../src/live-ui.mjs";

function jsonResponse(result, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return { result };
    }
  };
}

test("secure live selector prefers HTTPS SD stream", () => {
  const selected = selectSecureSdLiveStream({
    streams: [
      { streamId: 1, hls: "http://example.invalid/sd.m3u8", status: "0" },
      { streamId: 0, hls: "https://example.invalid/hd.m3u8", status: "0" },
      { streamId: 1, hls: "https://example.invalid/sd.m3u8", status: "0" }
    ]
  });

  assert.deepEqual(selected, {
    hls: "https://example.invalid/sd.m3u8",
    status: "0",
    streamId: 1
  });
});

test("existing live stream is reused without bindDeviceLive", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);

    if (url.endsWith("/openapi/accessToken")) {
      return jsonResponse({
        code: "0",
        data: { accessToken: "live-token-a", expireTime: 3600 }
      });
    }

    if (url.endsWith("/openapi/getLiveStreamInfo")) {
      return jsonResponse({
        code: "0",
        data: {
          streams: [
            {
              streamId: 1,
              hls: "https://media.example/live-sd.m3u8",
              status: "0",
              liveToken: "must-not-leak",
              coverUrl: "https://secret.example/cover.jpg"
            }
          ]
        }
      });
    }

    throw new Error("Unexpected URL " + url);
  };

  const result = await ensureLiveStream({
    appId: "live-existing-app",
    appSecret: "secret",
    deviceId: "fixed-device",
    channelId: "0",
    fetchImpl
  });

  assert.equal(result.hls, "https://media.example/live-sd.m3u8");
  assert.equal(calls.some((url) => url.endsWith("/openapi/bindDeviceLive")), false);
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(result).includes("cover.jpg"), false);
});

test("missing live info binds SD stream then re-queries", async () => {
  const calls = [];
  let infoCalls = 0;

  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, params: body.params });

    if (url.endsWith("/openapi/accessToken")) {
      return jsonResponse({
        code: "0",
        data: { accessToken: "live-token-b", expireTime: 3600 }
      });
    }

    if (url.endsWith("/openapi/getLiveStreamInfo")) {
      infoCalls += 1;
      if (infoCalls === 1) {
        return jsonResponse({ code: "LIVE_NOT_FOUND", msg: "not found" });
      }

      return jsonResponse({
        code: "0",
        data: {
          streams: [
            {
              streamId: 1,
              hls: "https://media.example/created-sd.m3u8",
              status: "0"
            }
          ]
        }
      });
    }

    if (url.endsWith("/openapi/bindDeviceLive")) {
      assert.equal(body.params.deviceId, "fixed-device");
      assert.equal(body.params.channelId, "0");
      assert.equal(body.params.streamId, 1);
      assert.equal(body.params.liveMode, "proxy");
      return jsonResponse({ code: "0", data: {} });
    }

    throw new Error("Unexpected URL " + url);
  };

  const result = await ensureLiveStream({
    appId: "live-create-app",
    appSecret: "secret",
    deviceId: "fixed-device",
    channelId: "0",
    fetchImpl
  });

  assert.equal(result.hls, "https://media.example/created-sd.m3u8");
  assert.equal(
    calls.filter((call) => call.url.endsWith("/openapi/bindDeviceLive")).length,
    1
  );
  assert.equal(infoCalls, 2);
});

test("HTTP-only live info is rejected without rebinding", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);

    if (url.endsWith("/openapi/accessToken")) {
      return jsonResponse({
        code: "0",
        data: { accessToken: "live-token-c", expireTime: 3600 }
      });
    }

    if (url.endsWith("/openapi/getLiveStreamInfo")) {
      return jsonResponse({
        code: "0",
        data: {
          streams: [
            { streamId: 1, hls: "http://media.example/insecure.m3u8", status: "0" }
          ]
        }
      });
    }

    throw new Error("Unexpected URL " + url);
  };

  await assert.rejects(
    ensureLiveStream({
      appId: "live-http-only-app",
      appSecret: "secret",
      deviceId: "fixed-device",
      channelId: "0",
      fetchImpl
    }),
    (error) =>
      error instanceof ImouApiError &&
      error.code === "LIVE_HTTPS_SD_UNAVAILABLE"
  );

  assert.equal(calls.some((url) => url.endsWith("/openapi/bindDeviceLive")), false);
});

test("unauthorized live-session request stops before Imou", async () => {
  let calls = 0;
  const response = await buildLiveSessionResponse({
    method: "GET",
    headers: { authorization: "Bearer wrong" },
    env: {
      BAOKHACH_APP_KEY: "right",
      IMOU_APP_ID: "app",
      IMOU_APP_SECRET: "secret",
      IMOU_DEVICE_ID: "device",
      IMOU_CHANNEL_ID: "0"
    },
    sessionFn: async () => {
      calls += 1;
      return {};
    }
  });

  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("authorized live-session response exposes only minimal player fields", async () => {
  const response = await buildLiveSessionResponse({
    method: "GET",
    headers: { authorization: "Bearer right" },
    env: {
      BAOKHACH_APP_KEY: "right",
      IMOU_APP_ID: "app",
      IMOU_APP_SECRET: "secret",
      IMOU_DEVICE_ID: "device-secret",
      IMOU_CHANNEL_ID: "0"
    },
    sessionFn: async () => ({
      hls: "https://media.example/live.m3u8",
      status: "0",
      streamId: 1,
      liveToken: "live-secret",
      deviceId: "device-secret",
      coverUrl: "https://secret.example/cover.jpg"
    })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "hls",
    "ok",
    "status",
    "streamId"
  ]);
  assert.equal(JSON.stringify(response.body).includes("live-secret"), false);
  assert.equal(JSON.stringify(response.body).includes("device-secret"), false);
  assert.equal(JSON.stringify(response.body).includes("cover.jpg"), false);
});

test("live dimming starts after 45 seconds only while active", () => {
  assert.equal(LIVE_DIM_IDLE_MS, 45000);
  assert.equal(
    shouldDimLive({ active: true, lastInteractionAt: 1000, now: 45999 }),
    false
  );
  assert.equal(
    shouldDimLive({ active: true, lastInteractionAt: 1000, now: 46000 }),
    true
  );
  assert.equal(
    shouldDimLive({ active: false, lastInteractionAt: 1000, now: 999999 }),
    false
  );
});

test("live playback must stop whenever document is not visible", () => {
  assert.equal(shouldStopLiveForVisibility("visible"), false);
  assert.equal(shouldStopLiveForVisibility("hidden"), true);
  assert.equal(shouldStopLiveForVisibility("prerender"), true);
});


test("empty live stream list binds SD stream then re-queries", async () => {
  let infoCalls = 0;
  let bindCalls = 0;

  const fetchImpl = async (url) => {
    if (url.endsWith("/openapi/accessToken")) {
      return jsonResponse({
        code: "0",
        data: { accessToken: "live-token-d", expireTime: 3600 }
      });
    }

    if (url.endsWith("/openapi/getLiveStreamInfo")) {
      infoCalls += 1;
      return jsonResponse({
        code: "0",
        data: infoCalls === 1
          ? { streams: [] }
          : {
              streams: [
                {
                  streamId: 1,
                  hls: "https://media.example/empty-created-sd.m3u8",
                  status: "0"
                }
              ]
            }
      });
    }

    if (url.endsWith("/openapi/bindDeviceLive")) {
      bindCalls += 1;
      return jsonResponse({ code: "0", data: {} });
    }

    throw new Error("Unexpected URL " + url);
  };

  const result = await ensureLiveStream({
    appId: "live-empty-app",
    appSecret: "secret",
    deviceId: "fixed-device",
    channelId: "0",
    fetchImpl
  });

  assert.equal(bindCalls, 1);
  assert.equal(infoCalls, 2);
  assert.equal(result.hls, "https://media.example/empty-created-sd.m3u8");
});


test("live toggle remains an explicit cancel action while opening", () => {
  assert.equal(liveToggleLabel({ active: false, loading: false }), "Xem trực tiếp");
  assert.equal(liveToggleLabel({ active: false, loading: true }), "Hủy mở video");
  assert.equal(liveToggleLabel({ active: true, loading: false }), "Tắt video");
});
