import {
  ingestHumanEvents,
  finalizeAlertAttempt,
  normalizeClientState
} from "./src/client-state.mjs";
import {
  POLL_INTERVAL_MS,
  shouldPoll,
  shouldPollImmediatelyOnVisibilityChange
} from "./src/polling.mjs";
import {
  shouldStopLiveForVisibility,
  liveToggleLabel,
  streamAudioLabel
} from "./src/live-ui.mjs";
import {
  DEFAULT_ALERT_VOLUME_LEVEL,
  normalizeAlertVolumeLevel,
  alertVolumeForLevel
} from "./src/alert-audio.mjs";

const KEY_STORAGE = "baokhach.appKey.v1";
const STATE_STORAGE = "baokhach.state.v1";
const ALERT_VOLUME_STORAGE = "baokhach.alertVolume.v1";
const ALERT_AUDIO_URL = "/src/có_khách_kìa_bà_chủ.mp3";
const HLS_JS_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/+esm";

const els = {
  accessPanel: document.querySelector("#access-panel"),
  viewer: document.querySelector("#viewer"),
  keyForm: document.querySelector("#key-form"),
  keyInput: document.querySelector("#app-key"),
  accessError: document.querySelector("#access-error"),

  settingsButton: document.querySelector("#settings-button"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsClose: document.querySelector("#settings-close"),
  connectionState: document.querySelector("#connection-state"),
  connectionIcon: document.querySelector("#connection-icon"),
  connectionText: document.querySelector("#connection-text"),
  volumeOptions: [...document.querySelectorAll("[data-volume-level]")],

  liveVideo: document.querySelector("#live-video"),
  videoMessage: document.querySelector("#video-message"),
  videoToggle: document.querySelector("#video-toggle"),
  streamAudioToggle: document.querySelector("#stream-audio-toggle")
};

let appKey = localStorage.getItem(KEY_STORAGE) || "";
let clientState = readState();
let alertVolumeLevel = normalizeAlertVolumeLevel(
  localStorage.getItem(ALERT_VOLUME_STORAGE) || DEFAULT_ALERT_VOLUME_LEVEL
);

let pollTimer = null;
let pollInFlight = false;
let lastVisibility = document.visibilityState;

let alertAudio = null;
let alertAudioPrimed = false;

let liveActive = false;
let liveLoading = false;
let liveMuted = true;
let liveGeneration = 0;
let liveAbortController = null;
let hlsInstance = null;

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

function getAlertAudio() {
  if (!alertAudio) {
    alertAudio = new Audio(ALERT_AUDIO_URL);
    alertAudio.preload = "auto";
  }

  alertAudio.volume = alertVolumeForLevel(alertVolumeLevel);
  return alertAudio;
}

function setConnected(value) {
  const connected = Boolean(value);
  els.connectionState.dataset.connected = connected ? "true" : "false";
  els.connectionIcon.textContent = connected ? "✓" : "✕";
  els.connectionText.textContent = connected ? "Đã kết nối" : "Chưa kết nối";
}

function setVideoMessage(text = "", visible = true) {
  els.videoMessage.textContent = text;
  els.videoMessage.hidden = !visible;
}

function render() {
  els.accessPanel.hidden = Boolean(appKey);
  els.viewer.hidden = !appKey;

  els.videoToggle.textContent = liveToggleLabel({
    active: liveActive,
    loading: liveLoading
  });
  els.videoToggle.dataset.active = liveActive || liveLoading ? "true" : "false";

  els.streamAudioToggle.textContent = streamAudioLabel(liveMuted);
  els.streamAudioToggle.disabled = !liveActive;

  for (const button of els.volumeOptions) {
    button.setAttribute(
      "aria-pressed",
      button.dataset.volumeLevel === alertVolumeLevel ? "true" : "false"
    );
  }
}

async function primeAlertAudio() {
  if (alertAudioPrimed) return;

  const audio = getAlertAudio();
  const intendedVolume = alertVolumeForLevel(alertVolumeLevel);

  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    alertAudioPrimed = true;
  } catch {
    // A later direct interaction may succeed; keep retryable.
  } finally {
    audio.volume = intendedVolume;
  }
}

async function playVisitorAlert() {
  const audio = getAlertAudio();

  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = alertVolumeForLevel(alertVolumeLevel);
    await audio.play();
    alertAudioPrimed = true;
    return true;
  } catch {
    return false;
  }
}

function clearAppKey() {
  appKey = "";
  localStorage.removeItem(KEY_STORAGE);
  stopPolling();
  stopLive({ message: "Video đang tắt" });
  setConnected(false);
  els.accessError.textContent = "Mã truy cập không đúng. Hãy nhập lại.";
  render();
}

async function pollOnce() {
  if (!appKey || pollInFlight || !shouldPoll(document.visibilityState)) return;

  pollInFlight = true;

  try {
    const response = await fetch("/api/human-events", {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: "Bearer " + appKey }
    });

    if (response.status === 401) {
      clearAppKey();
      return;
    }

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "poll_failed");
    }

    setConnected(true);

    const previousState = clientState;
    const result = ingestHumanEvents(previousState, payload.events, Date.now());

    if (result.shouldAnnounce) {
      const played = await playVisitorAlert();
      clientState = finalizeAlertAttempt(
        previousState,
        result,
        played,
        Date.now()
      );
    } else {
      clientState = result.state;
    }

    saveState();
  } catch {
    setConnected(false);
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
  if (!appKey || !shouldPoll(document.visibilityState)) return;

  if (immediate) pollOnce();
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

function destroyPlayer() {
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
  liveMuted = true;
  els.liveVideo.muted = true;
}

function stopLive({ message = "Video đang tắt" } = {}) {
  liveGeneration += 1;
  destroyPlayer();
  setVideoMessage(message, true);
  render();
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
  if (!Hls?.isSupported?.()) throw new Error("hls_not_supported");

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
  setVideoMessage("Đang kết nối camera…", true);
  render();

  try {
    const response = await fetch("/api/live-session", {
      method: "GET",
      cache: "no-store",
      signal: liveAbortController.signal,
      headers: { Authorization: "Bearer " + appKey }
    });

    if (response.status === 401) {
      clearAppKey();
      return;
    }

    const payload = await response.json();
    if (generation !== liveGeneration) return;

    if (!response.ok || !payload.ok || !payload.hls) {
      if (response.status === 503) throw new Error("camera_not_configured");
      throw new Error(payload.error || "live_session_failed");
    }

    liveAbortController = null;
    destroyPlayer();
    liveGeneration = generation;
    liveLoading = true;
    liveMuted = true;
    els.liveVideo.muted = true;
    els.liveVideo.playsInline = true;

    await attachHls(payload.hls, generation);
    if (generation !== liveGeneration) {
      destroyPlayer();
      return;
    }

    liveActive = true;
    liveLoading = false;
    setVideoMessage("", false);
    render();
  } catch (error) {
    if (generation !== liveGeneration || error?.name === "AbortError") return;
    liveAbortController = null;
    destroyPlayer();
    liveGeneration = generation;
    setVideoMessage(
      error?.message === "camera_not_configured"
        ? "Camera chưa được cấu hình đầy đủ"
        : "Không mở được camera trực tiếp",
      true
    );
    render();
  }
}

async function toggleStreamAudio() {
  if (!liveActive) return;

  const nextMuted = !liveMuted;
  els.liveVideo.muted = nextMuted;

  if (!nextMuted) {
    try {
      await els.liveVideo.play();
    } catch {
      els.liveVideo.muted = true;
      liveMuted = true;
      render();
      return;
    }
  }

  liveMuted = nextMuted;
  render();
}

function openSettings() {
  if (typeof els.settingsDialog.showModal === "function") {
    if (!els.settingsDialog.open) els.settingsDialog.showModal();
  } else {
    els.settingsDialog.setAttribute("open", "");
  }
}

function closeSettings() {
  if (typeof els.settingsDialog.close === "function") {
    if (els.settingsDialog.open) els.settingsDialog.close();
  } else {
    els.settingsDialog.removeAttribute("open");
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
  setConnected(false);
  render();
  void primeAlertAudio();
  startPolling({ immediate: true });
});

els.settingsButton.addEventListener("click", () => {
  void primeAlertAudio();
  openSettings();
});

els.settingsClose.addEventListener("click", closeSettings);

els.settingsDialog.addEventListener("click", (event) => {
  if (event.target === els.settingsDialog) closeSettings();
});

for (const button of els.volumeOptions) {
  button.addEventListener("click", () => {
    alertVolumeLevel = normalizeAlertVolumeLevel(button.dataset.volumeLevel);
    localStorage.setItem(ALERT_VOLUME_STORAGE, alertVolumeLevel);
    getAlertAudio().volume = alertVolumeForLevel(alertVolumeLevel);
    render();
    void primeAlertAudio();
  });
}

els.videoToggle.addEventListener("click", () => {
  void primeAlertAudio();

  if (liveActive || liveLoading) {
    stopLive();
  } else {
    startLive();
  }
});

els.streamAudioToggle.addEventListener("click", toggleStreamAudio);

els.liveVideo.addEventListener("volumechange", () => {
  liveMuted = els.liveVideo.muted;
  render();
});

document.addEventListener(
  "pointerdown",
  () => {
    void primeAlertAudio();
  },
  { once: true, passive: true }
);

document.addEventListener("visibilitychange", () => {
  const nextVisibility = document.visibilityState;
  const immediate = shouldPollImmediatelyOnVisibilityChange(
    lastVisibility,
    nextVisibility
  );
  lastVisibility = nextVisibility;

  if (shouldStopLiveForVisibility(nextVisibility) && (liveActive || liveLoading)) {
    stopLive({ message: "Video đã tắt khi app ở nền" });
  }

  if (!shouldPoll(nextVisibility)) {
    stopPolling();
    setConnected(false);
    return;
  }

  startPolling({ immediate });
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

setConnected(false);
setVideoMessage("Video đang tắt", true);
render();

if (appKey) {
  startPolling({ immediate: true });
}
