import { ImouApiError, ensureLiveStream } from "../src/imou.mjs";
import { buildLiveSessionResponse } from "../src/live-api.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");

  try {
    const result = await buildLiveSessionResponse({
      method: req.method,
      headers: req.headers || {},
      env: process.env,
      sessionFn: ensureLiveStream
    });

    for (const [name, value] of Object.entries(result.headers || {})) {
      res.setHeader(name, value);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof ImouApiError) {
      return res.status(error.status || 502).json({
        ok: false,
        error: error.code,
        message: "Không mở được camera trực tiếp."
      });
    }

    return res.status(500).json({
      ok: false,
      error: "internal_error"
    });
  }
}
