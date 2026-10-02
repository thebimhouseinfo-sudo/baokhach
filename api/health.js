export default function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");

  const appId = Boolean(process.env.IMOU_APP_ID);
  const appSecret = Boolean(process.env.IMOU_APP_SECRET);
  const probeKey = Boolean(process.env.IMOU_PROBE_KEY);
  const callbackKey = Boolean(process.env.IMOU_CALLBACK_KEY);

  res.status(200).json({
    ok: true,
    gate: "B",
    callbackReady: appId && callbackKey,
    probeReady: appId && appSecret && probeKey,
    configured: {
      appId,
      callbackKey
    },
    dataCenter: process.env.IMOU_DATA_CENTER || "sg"
  });
}
