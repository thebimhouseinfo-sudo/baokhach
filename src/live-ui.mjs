export function shouldStopLiveForVisibility(visibilityState) {
  return visibilityState !== "visible";
}

export function liveToggleLabel({ active = false, loading = false } = {}) {
  if (loading) return "Hủy mở video";
  return active ? "Tắt video" : "Bật video";
}

export function streamAudioLabel(muted = true) {
  return muted ? "Bật tiếng" : "Tắt tiếng";
}
