import {
  cooldownRemainingMs,
  ingestHumanEvents,
  markAlertPlayed,
  normalizeClientState
} from "./src/client-state.mjs";
import {
  POLL_INTERVAL_MS,
  shouldPoll,
  shouldPollImmediatelyOnVisibilityChange
} from "./src/polling.mjs";
import {
  LIVE_DIM_IDLE_MS,
  shouldStopLiveForVisibility
} from "./src/live-ui.mjs";

const KEY_STORAGE = "baokhach.appKey.v1";
const STATE_STORAGE = "baokhach.state.v1";
const HLS_JS_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/+esm";

const els = {
  accessPanel: document.querySelector("#access-panel"),
  appPanel: document.querySelector("#app-panel"),
  keyForm: document.querySelector("#key-form"),
  keyInput: document.querySelector("#app-key"),
  forgetKey: document.querySelector("#forget-key"),
  enableAudio: document.querySelector("#enable-audio"),
  statusDot: document.querySelector("#status-dot"),
  statusText: document.querySelector("#status-text"),
  audioState: document.querySelector("#audio-state"),
  lastDetection: document.querySelector("#last-detection"),
  lastAlert: document.querySelector("#last-alert"),
  cooldown: document.querySelector("#cooldown"),
  accessError: document.querySelector("#access-error"),
  activity: document.querySelector("#activity"),
  liveToggle: document.querySelector("#live-toggle"),
  liveStatus: document.querySelector("#live-status"),
  liveFrame: document.querySelector("#live-frame"),
  liveVideo: document.querySelector("#live-video")
};

let appKey = localStorage.getItem(KEY_STORAGE) || "";
let clientState = readState();
let audioEnabled = false;
let pollTimer = null;
let lastVisibility = document.visibilityState;
let pollInFlight = false;

let liveActive = false;
let liveLoading = false;
let liveDimmed = false;
let liveDimTimer = null;
let hlsInstance = null;
let liveGeneration = 0;
let liveAbortController = null;

function readState() {
  try {
    return normalizeClientState(
      JSON.parse(localStorage.getItem(STATE_STORAGE) || "{}")
    );
  } catch {
    return normalizeClientState();
  }
}

function saveState() {
  localStorage.setItem(STATE_STORAGE, JSON.stringify(clientState));
}

function setStatus(kind, text) {
  els.statusDot.dataset.state = kind;
  els.statusText.textContent = text;
}

function setLiveStatus(text) {
  els.liveStatus.textContent = text;
}

function formatTimestamp(value) {
  if (!value) return "Chưa có";
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "Chưa có";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(date);
}

function formatCooldown(ms) {
  if (ms <= 0) return "Sẵn sàng";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}

function renderState() {
  els.accessPanel.hidden = Boolean(appKey);
  els.appPanel.hidden = !appKey;
  els.audioState.textContent = audioEnabled ? "Đã bật" : "Chưa bật";
  els.lastDetection.textContent = formatTimestamp(clientState.lastDetectionAtMs);
  els.lastAlert.textContent = formatTimestamp(clientState.lastAlertAtMs);
  els.cooldown.textContent = formatCooldown(cooldownRemainingMs(clientState));

  els.liveToggle.disabled = liveLoading;
  els.liveToggle.textContent = liveLoading
    ? "Đang mở…"
    : liveActive
      ? "Tắt video"
      : "Xem trực tiếp";
  els.liveToggle.dataset.active = liveActive ? "true" : "false";
  els.liveFrame.hidden = !liveActive;
  els.liveFrame.classList.toggle("is-dimmed", liveDimmed);
}

function speakVisitor() {
  if (!audioEnabled || !("speechSynthesis" in window)) return false;

  try {
    window.speechSynthesis.cancel();
    const message = new SpeechSynthesisUtterance("Có khách");
    message.lang = "vi-VN";
    message.rate = 0.95;
    message.pitch = 1;
    window.speechSynthesis.speak(message);
    return true;
  } catch {
    return false;
  }
}

function clearAppKey(message = "Mã truy cập không đúng. Hãy nhập lại.") {
  appKey = "";
  localStorage.removeItem(KEY_STORAGE);
  stopPolling();
  stopLive({ reason: "auth", statusText: "Đã tắt video" });
  els.accessError.textContent = message;
  setStatus("error", "Cần đăng nhập lại");
  renderState();
}

async function pollOnce() {
  if (!appKey || pollInFlight || !shouldPoll(document.visibilityState)) return;

  pollInFlight = true;
  setStatus("checking", "Đang kiểm tra camera…");

  try {
    const response = await fetch("/api/human-events", {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + appKey
      }
    });

    if (response.status === 401) {
      clearAppKey();
      return;
    }

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "poll_failed");
    }

    const result = ingestHumanEvents(clientState, payload.events, Date.now());
    clientState = result.state;
    saveState();

    if (result.shouldAnnounce) {
      if (speakVisitor()) {
        clientState = markAlertPlayed(clientState, Date.now());
        saveState();
        els.activity.textContent = "Đã phát thông báo: Có khách";
      } else {
        els.activity.textContent =
          "Phát hiện có người nhưng âm thanh chưa được bật trên thiết bị này.";
      }
    } else if (result.unseenCount > 0) {
      els.activity.textContent =
        cooldownRemainingMs(clientState) > 0
          ? "Có phát hiện mới, đang trong thời gian chờ 5 phút."
          : "Đã ghi nhận phát hiện mới.";
    } else if (result.baselineCreated) {
      els.activity.textContent = "Đã đồng bộ trạng thái hiện tại.";
    }

    setStatus("online", "Đang theo dõi · 15 giây/lần");
    renderState();
  } catch {
    setStatus("error", "Lỗi kết nối · sẽ thử lại");
  } finally {
    pollInFlight = false;
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling({ immediate = true } = {}) {
  stopPolling();

  if (!appKey) return;
  if (!shouldPoll(document.visibilityState)) {
    setStatus("paused", "Đã tạm dừng khi app ở nền");
    return;
  }

  if (immediate) pollOnce();
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

function clearDimTimer() {
  if (liveDimTimer) {
    clearTimeout(liveDimTimer);
    liveDimTimer = null;
  }
}

function setLiveDimmed(value) {
  liveDimmed = Boolean(value) && liveActive;
  renderState();
}

function wakeLiveView() {
  if (!liveActive) return;

  setLiveDimmed(false);
  clearDimTimer();
  liveDimTimer = setTimeout(() => {
    if (liveActive) setLiveDimmed(true);
  }, LIVE_DIM_IDLE_MS);
}

function destroyPlayer() {
  clearDimTimer();

  if (liveAbortController) {
    liveAbortController.abort();
    liveAbortController = null;
  }

  if (hlsInstance) {
    try {
      hlsInstance.destroy();
    } catch {}
    hlsInstance = null;
  }

  try {
    els.liveVideo.pause();
    els.liveVideo.removeAttribute("src");
    els.liveVideo.load();
  } catch {}

  liveActive = false;
  liveLoading = false;
  liveDimmed = false;
}

function stopLive({
  reason = "user",
  statusText = reason === "hidden"
    ? "Video đã tắt khi app chuyển sang nền."
    : "Video đang tắt."
} = {}) {
  liveGeneration += 1;
  destroyPlayer();
  setLiveStatus(statusText);
  renderState();
}

async function attachHls(hlsUrl, generation) {
  if (generation !== liveGeneration) return;

  if (els.liveVideo.canPlayType("application/vnd.apple.mpegurl")) {
    els.liveVideo.src = hlsUrl;
    await els.liveVideo.play();
    return;
  }

  const module = await import(HLS_JS_URL);
  if (generation !== liveGeneration) return;

  const Hls = module.default || module.Hls;

  if (!Hls?.isSupported?.()) {
    throw new Error("hls_not_supported");
  }

  const instance = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 0,
    maxBufferLength: 12
  });
  hlsInstance = instance;

  await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("hls_timeout"));
    }, 12000);

    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error("hls_load_failed"));
    };

    instance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (settled) return;
      if (generation !== liveGeneration) {
        settled = true;
        clearTimeout(timeout);
        resolve();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    });

    instance.on(Hls.Events.ERROR, (_event, data) => {
      if (data?.fatal) fail();
    });

    instance.attachMedia(els.liveVideo);
    instance.loadSource(hlsUrl);
  });

  if (generation !== liveGeneration) return;
  await els.liveVideo.play();
}

async function startLive() {
  if (!appKey || liveLoading || liveActive) return;
  if (shouldStopLiveForVisibility(document.visibilityState)) return;

  const generation = ++liveGeneration;
  liveAbortController = new AbortController();
  liveLoading = true;
  setLiveStatus("Đang xin luồng trực tiếp từ camera…");
  renderState();

  try {
    const response = await fetch("/api/live-session", {
      method: "GET",
      cache: "no-store",
      signal: liveAbortController.signal,
      headers: {
        Authorization: "Bearer " + appKey
      }
    });

    if (response.status === 401) {
      clearAppKey();
      return;
    }

    const payload = await response.json();
    if (generation !== liveGeneration) return;

    if (!response.ok || !payload.ok || !payload.hls) {
      throw new Error(payload.error || "live_session_failed");
    }

    liveAbortController = null;
    destroyPlayer();
    liveGeneration = generation;
    liveLoading = true;
    els.liveVideo.muted = true;
    els.liveVideo.playsInline = true;
    await attachHls(payload.hls, generation);
    if (generation !== liveGeneration) {
      destroyPlayer();
      return;
    }

    liveActive = true;
    liveLoading = false;
    setLiveStatus("Đang xem trực tiếp · SD · tắt tiếng");
    wakeLiveView();
    renderState();
  } catch (error) {
    if (generation !== liveGeneration || error?.name === "AbortError") return;
    liveAbortController = null;
    destroyPlayer();
    liveGeneration = generation;
    setLiveStatus("Không mở được video trực tiếp. Hãy thử lại.");
    renderState();
  }
}

els.keyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = els.keyInput.value.trim();
  if (!value) return;

  appKey = value;
  localStorage.setItem(KEY_STORAGE, value);
  els.keyInput.value = "";
  els.accessError.textContent = "";
  renderState();
  startPolling({ immediate: true });
});

els.forgetKey.addEventListener("click", () => {
  appKey = "";
  localStorage.removeItem(KEY_STORAGE);
  stopPolling();
  stopLive({ statusText: "Video đang tắt." });
  setStatus("paused", "Chưa có mã truy cập");
  renderState();
});

els.enableAudio.addEventListener("click", () => {
  if (!("speechSynthesis" in window)) {
    els.audioState.textContent = "Trình duyệt không hỗ trợ";
    return;
  }

  audioEnabled = true;
  renderState();
  speakVisitor();
  els.activity.textContent = "Đã bật âm thanh thử.";
});

els.liveToggle.addEventListener("click", () => {
  if (liveActive || liveLoading) {
    stopLive();
  } else {
    startLive();
  }
});

for (const eventName of ["pointerdown", "touchstart"]) {
  els.liveFrame.addEventListener(eventName, wakeLiveView, { passive: true });
}

window.addEventListener("keydown", wakeLiveView);

document.addEventListener("visibilitychange", () => {
  const nextVisibility = document.visibilityState;
  const immediate = shouldPollImmediatelyOnVisibilityChange(
    lastVisibility,
    nextVisibility
  );
  lastVisibility = nextVisibility;

  if (shouldStopLiveForVisibility(nextVisibility) && (liveActive || liveLoading)) {
    stopLive({ reason: "hidden" });
  }

  if (!shouldPoll(nextVisibility)) {
    stopPolling();
    setStatus("paused", "Đã tạm dừng khi app ở nền");
    return;
  }

  startPolling({ immediate });
});

setInterval(renderState, 1000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

renderState();
setLiveStatus("Video đang tắt.");
if (appKey) {
  startPolling({ immediate: true });
} else {
  setStatus("paused", "Nhập mã truy cập để bắt đầu");
}
