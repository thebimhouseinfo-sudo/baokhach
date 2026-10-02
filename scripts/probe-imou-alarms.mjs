import { ImouApiError, probeRecentAlarmMessages } from "../src/imou.mjs";

const appId = process.env.IMOU_APP_ID;
const appSecret = process.env.IMOU_APP_SECRET;
const dataCenter = process.env.IMOU_DATA_CENTER || "sg";

if (!appId || !appSecret) {
  console.error("Gate B alarm-history secrets are not configured.");
  process.exit(2);
}

try {
  const result = await probeRecentAlarmMessages({
    appId,
    appSecret,
    dataCenter
  });
  process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + "\n");
} catch (error) {
  if (error instanceof ImouApiError) {
    console.error(JSON.stringify({
      ok: false,
      error: error.code,
      message: error.message
    }));
    process.exit(1);
  }
  console.error(JSON.stringify({ ok: false, error: "internal_error" }));
  process.exit(1);
}
