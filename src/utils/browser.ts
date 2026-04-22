/** Detect Safari (not Chrome/Android masquerading as Safari) */
export function isSafari(): boolean {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
}

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export function isMobile(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

/**
 * Returns true if the browser supports MediaRecorder with WebM/VP8.
 * Safari < 14.5 and iOS Safari do not support this.
 */
export function supportsWebMRecorder(): boolean {
  if (typeof MediaRecorder === 'undefined') return false
  return (
    MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ||
    MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ||
    MediaRecorder.isTypeSupported('video/webm')
  )
}

/** RTMP mode requires WebM MediaRecorder — unavailable on Safari/iOS */
export function supportsRTMP(): boolean {
  return supportsWebMRecorder()
}

/**
 * Virtual / loopback device label patterns.
 * Uses word boundaries (\b) and multi-word phrases to avoid false positives.
 */
const VIRTUAL_DEVICE_RE = /\b(vb[\s-]?(audio|cable)|voicemeeter|virtual\s+audio\s+cable|obs\s+virtual|blackhole|soundflower|discord\s+audio|krisp|nvidia\s+(broadcast|rtx)|rtx\s+voice|elgato\s+(4k\s+)?virtual|droidcam|iriun|e2esoft|manycam|xsplit|splitcam|cable\s+(input|output)|loopback|todesk|omen\s+cam)\b/i

/** Returns true if the device looks like a virtual/software device */
export function isVirtualDevice(device: MediaDeviceInfo): boolean {
  return VIRTUAL_DEVICE_RE.test(device.label)
}

/** Filter out virtual devices, keeping only real hardware */
export function filterRealDevices(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  const real = devices.filter(d => !isVirtualDevice(d))
  // If everything got filtered (edge case: only virtual devices), fall back to all
  return real.length > 0 ? real : devices
}

/**
 * Pick the best default device from a list:
 * 1. deviceId === 'default'  (OS system default)
 * 2. First real hardware device
 * 3. First in list (fallback)
 */
export function pickDefaultDevice(devices: MediaDeviceInfo[]): string {
  const real = filterRealDevices(devices)
  const def  = real.find(d => d.deviceId === 'default')
  return (def ?? real[0])?.deviceId ?? ''
}
