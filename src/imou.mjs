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

  let rawDeviceList = data?.deviceList ?? data?.devices;
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
      deviceListSource: data?.deviceList !== undefined ? "deviceList" : data?.devices !== undefined ? "devices" : "missing",
      deviceListType: Array.isArray(rawDeviceList)
        ? "array"
        : rawDeviceList === null
          ? "null"
          : typeof rawDeviceList,
      deviceListKeys:
        rawDeviceList && typeof rawDeviceList === "object" && !Array.isArray(rawDeviceList)
          ? Object.keys(rawDeviceList).sort()
          : []
    }
  };
}


export function sanitizeCallbackUrl(callbackUrl) {
  let url;
  try {
    url = new URL(String(callbackUrl || ""));
  } catch {
    throw new ImouApiError("Invalid callback URL.", {
      code: "INVALID_CALLBACK_URL",
      status: 500
    });
  }

  if (url.protocol !== "https:") {
    throw new ImouApiError("Imou callback URL must use HTTPS.", {
      code: "INVALID_CALLBACK_URL",
      status: 500
    });
  }

  return {
    origin: url.origin,
    pathname: url.pathname,
    hasQuery: Boolean(url.search)
  };
}

export async function registerAlarmCallback({
  appId,
  appSecret,
  callbackUrl,
  dataCenter = "sg",
  fetchImpl = globalThis.fetch
}) {
  const callbackTarget = sanitizeCallbackUrl(callbackUrl);
  const config = { appId, appSecret, dataCenter, fetchImpl };
  const token = await getAccessToken(config);

  await callImou(
    "setMessageCallback",
    {
      token,
      status: "on",
      callbackUrl,
      callbackFlag: "alarm,iot",
      basePush: "1"
    },
    config
  );

  return {
    dataCenter,
    status: "on",
    callbackFlag: "alarm,iot",
    basePush: "1",
    callbackTarget
  };
}

export async function readMessageCallback({
  appId,
  appSecret,
  dataCenter = "sg",
  fetchImpl = globalThis.fetch
}) {
  const config = { appId, appSecret, dataCenter, fetchImpl };
  const token = await getAccessToken(config);
  const data = await callImou("getMessageCallback", { token }, config);

  return {
    status: data?.status ?? null,
    callbackFlag: data?.callbackFlag ?? "",
    callbackTarget: data?.callbackUrl
      ? sanitizeCallbackUrl(data.callbackUrl)
      : null
  };
}


function formatDateInTimeZone(date, timeZone = "Asia/Ho_Chi_Minh") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  return (
    parts.year +
    "-" +
    parts.month +
    "-" +
    parts.day +
    " " +
    parts.hour +
    ":" +
    parts.minute +
    ":" +
    parts.second
  );
}

function sanitizeAlarmMessage(alarm) {
  return {
    alarmRef: alarm?.alarmId
      ? crypto
          .createHash("sha256")
          .update(String(alarm.alarmId), "utf8")
          .digest("hex")
          .slice(0, 16)
      : null,
    time: alarm?.time ?? null,
    localDate: alarm?.localDate ?? null,
    type: alarm?.type ?? null,
    channelId: alarm?.channelId ?? null,
    hasPictures:
      Array.isArray(alarm?.picurlArray) && alarm.picurlArray.length > 0,
    hasThumbnail: Boolean(alarm?.thumbUrl)
  };
}

export async function probeRecentAlarmMessages({
  appId,
  appSecret,
  dataCenter = "sg",
  fetchImpl = globalThis.fetch,
  timeZone = "Asia/Ho_Chi_Minh",
  lookbackMinutes = 180
}) {
  const config = { appId, appSecret, dataCenter, fetchImpl };
  const token = await getAccessToken(config);
  const shared = await callImou(
    "shareDeviceList",
    { token, queryRange: "1-20" },
    config
  );

  let rawDevices = shared?.deviceList ?? shared?.devices;
  if (typeof rawDevices === "string") {
    try {
      rawDevices = JSON.parse(rawDevices);
    } catch {
      rawDevices = [];
    }
  }

  const devices = Array.isArray(rawDevices)
    ? rawDevices
    : rawDevices && typeof rawDevices === "object"
      ? [rawDevices]
      : [];

  const device = devices[0];
  const channel = Array.isArray(device?.channels) ? device.channels[0] : null;

  if (!device?.deviceId || channel?.channelId === undefined || channel?.channelId === null) {
    throw new ImouApiError("No shared camera/channel available for alarm probe.", {
      code: "NO_SHARED_CAMERA",
      status: 502
    });
  }

  const end = new Date();
  const begin = new Date(end.getTime() - Math.max(1, lookbackMinutes) * 60 * 1000);

  const data = await callImou(
    "getAlarmMessage",
    {
      token,
      deviceId: String(device.deviceId),
      channelId: String(channel.channelId),
      beginTime: formatDateInTimeZone(begin, timeZone),
      endTime: formatDateInTimeZone(end, timeZone),
      count: 30,
      nextAlarmId: "-1"
    },
    config
  );

  const alarms = Array.isArray(data?.alarms) ? data.alarms : [];

  return {
    dataCenter,
    timeZone,
    lookbackMinutes,
    count: Number(data?.count ?? alarms.length),
    alarms: alarms.map(sanitizeAlarmMessage)
  };
}


function alarmTimeMs(alarm) {
  const numeric = Number(alarm?.time);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }

  const local = String(alarm?.localDate || "").trim();
  if (!local) return 0;

  const normalized = local.includes("T") ? local : local.replace(" ", "T");
  const parsed = Date.parse(normalized + (/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? "" : "+07:00"));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sanitizeHumanAlarm(alarm) {
  if (String(alarm?.type ?? "") !== "33000") return null;

  const occurredAtMs = alarmTimeMs(alarm);
  const identity = [
    alarm?.alarmId ?? "",
    alarm?.time ?? "",
    alarm?.localDate ?? "",
    alarm?.channelId ?? ""
  ].join("|");

  return {
    eventRef: crypto
      .createHash("sha256")
      .update(identity, "utf8")
      .digest("hex")
      .slice(0, 20),
    occurredAtMs: occurredAtMs || null
  };
}

export async function queryHumanDetections({
  appId,
  appSecret,
  deviceId,
  channelId = "0",
  dataCenter = "sg",
  fetchImpl = globalThis.fetch,
  timeZone = "Asia/Ho_Chi_Minh",
  lookbackSeconds = 120,
  now = new Date()
}) {
  if (!deviceId && deviceId !== 0) {
    throw new ImouApiError("Imou device is not configured.", {
      code: "MISSING_DEVICE_ID",
      status: 503
    });
  }

  const config = { appId, appSecret, dataCenter, fetchImpl };
  const token = await getAccessToken(config);
  const end = new Date(now);
  const begin = new Date(
    end.getTime() - Math.max(30, Number(lookbackSeconds) || 120) * 1000
  );

  const data = await callImou(
    "getAlarmMessage",
    {
      token,
      deviceId: String(deviceId),
      channelId: String(channelId),
      beginTime: formatDateInTimeZone(begin, timeZone),
      endTime: formatDateInTimeZone(end, timeZone),
      count: 20,
      nextAlarmId: "-1"
    },
    config
  );

  const alarms = Array.isArray(data?.alarms) ? data.alarms : [];
  const events = alarms
    .map(sanitizeHumanAlarm)
    .filter(Boolean)
    .sort((a, b) => {
      const at = Number(a.occurredAtMs || 0);
      const bt = Number(b.occurredAtMs || 0);
      if (at !== bt) return at - bt;
      return String(a.eventRef).localeCompare(String(b.eventRef));
    });

  return {
    events,
    checkedAt: end.toISOString(),
    lookbackSeconds: Math.max(30, Number(lookbackSeconds) || 120)
  };
}


export function selectSecureSdLiveStream(data) {
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const candidates = streams.filter((stream) => {
    const hls = String(stream?.hls || "");
    return Number(stream?.streamId) === 1 && /^https:\/\//i.test(hls);
  });

  if (!candidates.length) {
    throw new ImouApiError("No secure standard-definition HLS stream is available.", {
      code: "LIVE_HTTPS_SD_UNAVAILABLE",
      status: 502
    });
  }

  candidates.sort((a, b) => {
    const aLive = String(a?.status ?? "") === "0" ? 0 : 1;
    const bLive = String(b?.status ?? "") === "0" ? 0 : 1;
    return aLive - bLive;
  });

  const selected = candidates[0];
  return {
    hls: String(selected.hls),
    status: String(selected?.status ?? ""),
    streamId: 1
  };
}

function canAttemptLiveBind(error) {
  if (!(error instanceof ImouApiError)) return false;

  return !new Set([
    "MISSING_CREDENTIALS",
    "INVALID_DATA_CENTER",
    "FETCH_UNAVAILABLE",
    "IMOU_NETWORK_ERROR",
    "IMOU_BAD_RESPONSE",
    "TOKEN_MISSING"
  ]).has(error.code);
}

export async function ensureLiveStream({
  appId,
  appSecret,
  deviceId,
  channelId = "0",
  dataCenter = "sg",
  fetchImpl = globalThis.fetch
}) {
  if (!deviceId && deviceId !== 0) {
    throw new ImouApiError("Imou device is not configured.", {
      code: "MISSING_DEVICE_ID",
      status: 503
    });
  }

  const config = { appId, appSecret, dataCenter, fetchImpl };
  const token = await getAccessToken(config);
  const params = {
    token,
    deviceId: String(deviceId),
    channelId: String(channelId)
  };

  try {
    const existing = await callImou("getLiveStreamInfo", params, config);
    return selectSecureSdLiveStream(existing);
  } catch (error) {
    if (!canAttemptLiveBind(error)) throw error;
  }

  await callImou(
    "bindDeviceLive",
    {
      ...params,
      streamId: 1,
      liveMode: "proxy"
    },
    config
  );

  const created = await callImou("getLiveStreamInfo", params, config);
  return selectSecureSdLiveStream(created);
}
