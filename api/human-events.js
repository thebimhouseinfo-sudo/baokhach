import { queryHumanDetections, ImouApiError } from "../src/imou.mjs";
import { buildHumanEventsResponse } from "../src/human-api.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const result = await buildHumanEventsResponse({
      method: req.method,
      headers: req.headers || {},
      env: process.env,
      queryFn: queryHumanDetections
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
        message: "Imou query failed."
      });
    }

    return res.status(500).json({
      ok: false,
      error: "internal_error"
    });
  }
}
