import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Whether a given navigator.mediaDevices method is usable in this webview.
 *
 * In Tauri's WKWebView, navigator.mediaDevices is frequently undefined
 * (especially in dev over http://localhost, which is not treated as a secure
 * context), and getDisplayMedia is unsupported even when mediaDevices exists.
 * Every browser-capture call must be guarded so a missing API surfaces a clear
 * message instead of a raw "undefined is not an object" TypeError.
 */
export function hasMediaApi(
  method: 'getUserMedia' | 'getDisplayMedia' | 'enumerateDevices',
): boolean {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  return !!md && typeof (md as unknown as Record<string, unknown>)[method] === 'function'
}
