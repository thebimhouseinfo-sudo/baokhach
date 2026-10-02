import { bearerToken, safeSecretEqual } from "./access.mjs";

export async function buildHumanEventsResponse({
  method,
  headers = {},
  env,
  queryFn
}) {
  if (method !== "GET") {
    return {
      status: 405,
      headers: { Allow: "GET" },
      body: { ok: false, error: "method_not_allowed" }
    };
  }

  if (!env?.BAOKHACH_APP_KEY) {
    return {
      status: 503,
      body: { ok: false, error: "not_configured" }
    };
  }

  if (!safeSecretEqual(bearerToken(headers), env.BAOKHACH_APP_KEY)) {
    return {
      status: 401,
      body: { ok: false, error: "unauthorized" }
    };
  }

  const required = [
    "IMOU_APP_ID",
    "IMOU_APP_SECRET",
    "IMOU_DEVICE_ID",
    "IMOU_CHANNEL_ID"
  ];
  const missing = required.filter((name) => !env?.[name]);

  if (missing.length) {
    return {
      status: 503,
      body: { ok: false, error: "not_configured", missing }
    };
  }

  const result = await queryFn({
    appId: env.IMOU_APP_ID,
    appSecret: env.IMOU_APP_SECRET,
    deviceId: env.IMOU_DEVICE_ID,
    channelId: env.IMOU_CHANNEL_ID,
    dataCenter: env.IMOU_DATA_CENTER || "sg",
    lookbackSeconds: 120
  });

  return {
    status: 200,
    body: {
      ok: true,
      pollIntervalMs: 15000,
      checkedAt: result.checkedAt,
      events: result.events
    }
  };
}
