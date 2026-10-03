export const ALERT_VOLUME_LEVELS = Object.freeze({
  loud: 0.68,
  max: 1
});

export const DEFAULT_ALERT_VOLUME_LEVEL = "loud";

export function normalizeAlertVolumeLevel(value) {
  return Object.hasOwn(ALERT_VOLUME_LEVELS, value)
    ? value
    : DEFAULT_ALERT_VOLUME_LEVEL;
}

export function alertVolumeForLevel(value) {
  return ALERT_VOLUME_LEVELS[normalizeAlertVolumeLevel(value)];
}

export function alertVolumeLabel(value) {
  return normalizeAlertVolumeLevel(value) === "max" ? "Rất lớn" : "Vừa lớn";
}
