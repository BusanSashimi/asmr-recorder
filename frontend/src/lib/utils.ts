import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Whether a given navigator.mediaDevices method is usable in this webview.
 *
 * Verified behaviour in Tauri's WKWebView (2026-06-13): getUserMedia and
 * enumerateDevices work (mic capture confirmed in live recordings); only
 * getDisplayMedia is absent — screen capture goes through the native SCK path.
 * Every browser-capture call should be guarded so a missing API surfaces a
 * clear message instead of a raw TypeError.
 */
export function hasMediaApi(
  method: 'getUserMedia' | 'getDisplayMedia' | 'enumerateDevices',
): boolean {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  return !!md && typeof (md as unknown as Record<string, unknown>)[method] === 'function'
}
