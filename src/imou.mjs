import crypto from "node:crypto";

const DATA_CENTERS = Object.freeze({
  sg: "https://openapi-sg.easy4ip.com",
  fk: "https://openapi-fk.easy4ip.com",
  or: "https://openapi-or.easy4ip.com"
});

let cachedToken = null;

export class ImouApiError extends Error {
  constructor(message, { code = "IMOU_ERROR", status = 502 } = {}) {
    super(message);
    this.name = "ImouApiError";
    this.code = code;
    this.status = status;
  }
}

export function resolveApiBase(dataCenter = "sg") {
  const normalized = String(dataCenter || "sg").trim().toLowerCase();
  const base = DATA_CENTERS[normalized];
  if (!base) {
    throw new ImouApiError("Unsupported Imou data center.", {
      code: "INVALID_DATA_CENTER",
      status: 500
    });
  }
  return base;
}

export function createImouSign(time, nonce, appSecret) {
  const source = "time:" + time + ",nonce:" + nonce + ",appSecret:" + appSecret;
  return crypto.createHash("md5").update(source, "utf8").digest("hex");
}

export function createRequestEnvelope(appId, appSecret, params = {}, nowSeconds) {
  if (!appId || !appSecret) {
    throw new ImouApiError("Imou credentials are not configured.", {
      code: "MISSING_CREDENTIALS",
      status: 503
    });
  }

  const time = nowSeconds ?? Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();

  return {
    id: crypto.randomUUID(),
    system: {
      ver: "1.0",
      appId,
      sign: createImouSign(time, nonce, appSecret),
      time,
      nonce
    },
    params
  };
}

async function callImou(method, params, config) {
  const { appId, appSecret, dataCenter = "sg", fetchImpl = globalThis.fetch } = config;

  if (typeof fetchImpl !== "function") {
    throw new ImouApiError("Fetch implementation is unavailable.", {
      code: "FETCH_UNAVAILABLE",
      status: 500
    });
  }

  const base = resolveApiBase(dataCenter);
  const envelope = createRequestEnvelope(appId, appSecret, params);

  let response;
  try {
    response = await fetchImpl(base + "/openapi/" + method, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw new ImouApiError("Could not reach Imou Open Platform.", {
      code: "IMOU_NETWORK_ERROR",
      status: 502
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ImouApiError("Imou returned an unreadable response.", {
      code: "IMOU_BAD_RESPONSE",
      status: 502
    });
  }

  const result = payload?.result;
  if (!response.ok || !result || String(result.code) !== "0") {
    const code = result?.code ? String(result.code) : "HTTP_" + response.status;
    throw new ImouApiError("Imou request failed.", { code, status: 502 });
  }

  return result.data ?? {};
}

async function getAccessToken(config) {
  const now = Date.now();
  if (
    cachedToken &&
    cachedToken.dataCenter === config.dataCenter &&
    cachedToken.appId === config.appId &&
    cachedToken.expiresAt > now + 5 * 60 * 1000
  ) {
    return cachedToken.value;
  }

  const data = await callImou("accessToken", {}, config);
  const token = data?.accessToken;
  const expireSeconds = Number(data?.expireTime || 0);

  if (!token) {
    throw new ImouApiError("Imou did not return an access token.", {
      code: "TOKEN_MISSING",
      status: 502
    });
  }

  cachedToken = {
    value: token,
    appId: config.appId,
    dataCenter: config.dataCenter,
    expiresAt: now + Math.max(expireSeconds, 300) * 1000
  };

  return token;
}

function splitAbilities(value) {
  if (!value || typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function serialHint(deviceId) {
  if (!deviceId) return null;
  const text = String(deviceId);
  return "***" + text.slice(-4);
}

export function sanitizeSharedDevice(device) {
  return {
    deviceRef: serialHint(device?.deviceId),
    name: device?.name ?? null,
    status:
      device?.status === 1 ? "online" : device?.status === 0 ? "offline" : "unknown",
    baseline: device?.baseline ?? null,
    deviceModel: device?.deviceModel ?? null,
    deviceCatalog: device?.deviceCatalog ?? null,
    brand: device?.brand ?? null,
    version: device?.version ?? null,
    platform: device?.platForm ?? null,
    abilities: splitAbilities(device?.ability),
    channels: Array.isArray(device?.channels)
      ? device.channels.map((channel) => ({
          channelId: channel?.channelId ?? null,
          channelName: channel?.channelName ?? null,
          online: Boolean(channel?.channelOnline),
          abilities: splitAbilities(channel?.channelAbility),
          resolutions: Array.isArray(channel?.resolutions)
            ? channel.resolutions.map((resolution) => ({
                name: resolution?.name ?? null,
                imageSize: resolution?.imageSize ?? null,
                streamType: resolution?.streamType ?? null
              }))
            : []
        }))
      : []
  };
}

export async function probeSharedDevices({
  appId,
  appSecret,
  dataCenter = "sg",
  fetchImpl = globalThis.fetch
}) {
  const config = { appId, appSecret, dataCenter, fetchImpl };
  const token = await getAccessToken(config);
  const data = await callImou(
    "shareDeviceList",
    { token, queryRange: "1-20" },
    config
  );

  let rawDeviceList = data?.deviceList;
  if (typeof rawDeviceList === "string") {
    try {
      rawDeviceList = JSON.parse(rawDeviceList);
    } catch {
      rawDeviceList = null;
    }
  }

  const devices = Array.isArray(rawDeviceList)
    ? rawDeviceList
    : rawDeviceList && typeof rawDeviceList === "object"
      ? [rawDeviceList]
      : [];

  return {
    dataCenter,
    count: Number(data?.count ?? devices.length),
    devices: devices.map(sanitizeSharedDevice),
    diagnostics: {
      dataKeys: Object.keys(data || {}).sort(),
      deviceListType: Array.isArray(data?.deviceList)
        ? "array"
        : data?.deviceList === null
          ? "null"
          : typeof data?.deviceList,
      deviceListKeys:
        data?.deviceList && typeof data.deviceList === "object" && !Array.isArray(data.deviceList)
          ? Object.keys(data.deviceList).sort()
          : []
    }
  };
}
