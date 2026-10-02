import crypto from "node:crypto";
import { ImouApiError, probeSharedDevices } from "../src/imou.mjs";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  const value = req.headers?.authorization || "";
  const [scheme, token] = value.split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : "";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const appId = process.env.IMOU_APP_ID;
  const appSecret = process.env.IMOU_APP_SECRET;
  const probeKey = process.env.IMOU_PROBE_KEY;
  const dataCenter = process.env.IMOU_DATA_CENTER || "sg";

  const missing = [
    !appId && "IMOU_APP_ID",
    !appSecret && "IMOU_APP_SECRET",
    !probeKey && "IMOU_PROBE_KEY"
  ].filter(Boolean);

  if (missing.length) {
    return res.status(503).json({
      ok: false,
      error: "not_configured",
      missing
    });
  }

  if (!safeEqual(bearerToken(req), probeKey)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    const result = await probeSharedDevices({ appId, appSecret, dataCenter });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ImouApiError) {
      return res.status(error.status || 502).json({
        ok: false,
        error: error.code,
        message: error.message
      });
    }

    return res.status(500).json({
      ok: false,
      error: "internal_error",
      message: "Unexpected probe failure."
    });
  }
}
