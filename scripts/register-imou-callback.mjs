import {
  readMessageCallback,
  registerAlarmCallback
} from "../src/imou.mjs";

const appId = process.env.IMOU_APP_ID;
const appSecret = process.env.IMOU_APP_SECRET;
const callbackUrl = process.env.IMOU_CALLBACK_URL;
const dataCenter = process.env.IMOU_DATA_CENTER || "sg";

if (!appId || !appSecret || !callbackUrl) {
  console.error("Gate B registration is not configured.");
  process.exitCode = 2;
} else {
  try {
    const registered = await registerAlarmCallback({
      appId,
      appSecret,
      callbackUrl,
      dataCenter
    });

    const current = await readMessageCallback({
      appId,
      appSecret,
      dataCenter
    });

    console.log(JSON.stringify({
      ok: true,
      registered,
      current
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error?.code || "REGISTER_FAILED",
      message: error?.message || "Callback registration failed."
    }, null, 2));
    process.exitCode = 1;
  }
}
