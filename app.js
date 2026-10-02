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

const KEY_STORAGE = "baokhach.appKey.v1";
const STATE_STORAGE = "baokhach.state.v1";

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
  activity: document.querySelector("#activity")
};

let appKey = localStorage.getItem(KEY_STORAGE) || "";
let clientState = readState();
let audioEnabled = false;
let pollTimer = null;
let lastVisibility = document.visibilityState;
let pollInFlight = false;

function readState() {
  try {
    return normalizeClientState(JSON.parse(localStorage.getItem(STATE_STORAGE) || "{}"));
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
      appKey = "";
      localStorage.removeItem(KEY_STORAGE);
      stopPolling();
      els.accessError.textContent = "Mã truy cập không đúng. Hãy nhập lại.";
      setStatus("error", "Cần đăng nhập lại");
      renderState();
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

document.addEventListener("visibilitychange", () => {
  const nextVisibility = document.visibilityState;
  const immediate = shouldPollImmediatelyOnVisibilityChange(
    lastVisibility,
    nextVisibility
  );
  lastVisibility = nextVisibility;

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
if (appKey) {
  startPolling({ immediate: true });
} else {
  setStatus("paused", "Nhập mã truy cập để bắt đầu");
}
