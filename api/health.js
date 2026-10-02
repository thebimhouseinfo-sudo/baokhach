export default function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");

  const configured = {
    appId: Boolean(process.env.IMOU_APP_ID),
    appSecret: Boolean(process.env.IMOU_APP_SECRET),
    deviceId: Boolean(process.env.IMOU_DEVICE_ID),
    channelId: process.env.IMOU_CHANNEL_ID !== undefined,
    appKey: Boolean(process.env.BAOKHACH_APP_KEY)
  };

  res.status(200).json({
    ok: true,
    mode: "pull",
    pullReady: Object.values(configured).every(Boolean),
    configured,
    dataCenter: process.env.IMOU_DATA_CENTER || "sg"
  });
}
