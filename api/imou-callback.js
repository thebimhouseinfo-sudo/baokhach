import { parseCallbackBody, safeSecretEqual, sanitizeAlarmEvent } from "../src/callback.mjs";

function queryKey(req) {
  const value = req.query?.k;
  return Array.isArray(value) ? value[0] : value || "";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const callbackKey = process.env.IMOU_CALLBACK_KEY;
  const expectedAppId = process.env.IMOU_APP_ID;

  if (!callbackKey || !expectedAppId) {
    return res.status(503).json({ ok: false, error: "not_configured" });
  }

  if (!safeSecretEqual(queryKey(req), callbackKey)) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  let payload;
  try {
    payload = parseCallbackBody(req.body);
  } catch {
    console.info("IMOU_GATE_B_EVENT " + JSON.stringify({
      parsed: false,
      securityHeaderNames: Object.keys(req.headers || {})
        .filter((name) => /(sign|signature|auth|token|imou|easy4ip)/i.test(name))
        .sort()
    }));
    return res.status(200).json({ ok: true });
  }

  if (
    payload?.appId &&
    String(payload.appId) !== String(expectedAppId)
  ) {
    return res.status(403).json({ ok: false, error: "app_mismatch" });
  }

  const event = sanitizeAlarmEvent(payload, {
    expectedAppId,
    headers: req.headers || {}
  });

  console.info("IMOU_GATE_B_EVENT " + JSON.stringify({
    parsed: true,
    ...event
  }));

  return res.status(200).json({ ok: true });
}
