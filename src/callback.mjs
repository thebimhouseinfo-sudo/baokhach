import crypto from "node:crypto";

function toBuffer(value) {
  return Buffer.from(String(value ?? ""), "utf8");
}

export function safeSecretEqual(left, right) {
  const a = toBuffer(left);
  const b = toBuffer(right);
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function parseCallbackBody(body) {
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    return body;
  }

  const text = Buffer.isBuffer(body)
    ? body.toString("utf8")
    : String(body ?? "").trim();

  if (!text) return {};

  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Callback body must be a JSON object.");
  }

  return parsed;
}

function maskDeviceId(value) {
  if (!value) return null;
  const text = String(value);
  return "***" + text.slice(-4);
}

function eventFingerprint(payload) {
  const deviceId = payload?.did ?? payload?.deviceId ?? payload?.msgDeviceId ?? "";
  const channelId = payload?.cid ?? payload?.channelId ?? payload?.msgChannelId ?? "";
  const source = [
    payload?.id ?? "",
    payload?.msgType ?? "",
    deviceId,
    channelId,
    payload?.time ?? ""
  ].join("|");

  return crypto.createHash("sha256").update(source, "utf8").digest("hex").slice(0, 20);
}

function securityHeaderNames(headers = {}) {
  return Object.keys(headers)
    .filter((name) => /(sign|signature|auth|token|imou|easy4ip)/i.test(name))
    .sort();
}

function safeUserAgent(headers = {}) {
  const value = headers["user-agent"];
  const text = Array.isArray(value) ? value[0] : value;
  return text ? String(text).slice(0, 180) : null;
}

export function sanitizeAlarmEvent(payload, { expectedAppId, headers = {} } = {}) {
  const deviceId = payload?.did ?? payload?.deviceId ?? payload?.msgDeviceId ?? null;
  const channelId = payload?.cid ?? payload?.channelId ?? payload?.msgChannelId ?? null;
  const desc = payload?.desc;

  return {
    eventFingerprint: eventFingerprint(payload),
    eventId: payload?.id ?? null,
    msgType: payload?.msgType ?? null,
    humanCandidate: payload?.msgType === "human",
    deviceRef: maskDeviceId(deviceId),
    channelId,
    channelName: payload?.cname ?? null,
    eventTime: payload?.time ?? null,
    appIdMatches:
      expectedAppId && payload?.appId
        ? String(payload.appId) === String(expectedAppId)
        : null,
    payloadKeys: Object.keys(payload || {}).sort(),
    descKeys:
      desc && typeof desc === "object" && !Array.isArray(desc)
        ? Object.keys(desc).sort()
        : [],
    securityHeaderNames: securityHeaderNames(headers),
    userAgent: safeUserAgent(headers)
  };
}
