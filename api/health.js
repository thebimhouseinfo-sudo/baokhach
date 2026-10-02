export default function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    gate: "A",
    configured: {
      appId: Boolean(process.env.IMOU_APP_ID),
      appSecret: Boolean(process.env.IMOU_APP_SECRET),
      probeKey: Boolean(process.env.IMOU_PROBE_KEY)
    },
    dataCenter: process.env.IMOU_DATA_CENTER || "sg"
  });
}
