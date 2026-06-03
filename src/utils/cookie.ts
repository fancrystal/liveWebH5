/**
 * Minimal cookie helpers for client-side token persistence.
 *
 * The auth token is stored here so a page refresh can reuse it without
 * re-exchanging the one-time `code` (which is single-use and short-lived).
 *
 * Note: cookies set from JS are always non-HttpOnly, which is required here
 * because the SPA needs to read the token back and attach it as a
 * `Authorization: Bearer` header on cross-origin API calls.
 */

export interface CookieOptions {
  /** Lifetime in seconds. Omit for a session cookie (cleared on browser close). */
  maxAgeSec?: number
  /** Cookie path scope. Defaults to '/'. */
  path?: string
  /** SameSite policy. Defaults to 'Lax' (works for top-level redirect entry). */
  sameSite?: 'Lax' | 'Strict' | 'None'
  /** Send only over HTTPS. Defaults to true when the page is served over HTTPS. */
  secure?: boolean
}

export function setCookie(name: string, value: string, opts: CookieOptions = {}): void {
  const {
    maxAgeSec,
    path = '/',
    sameSite = 'Lax',
    secure = location.protocol === 'https:',
  } = opts

  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`
  if (typeof maxAgeSec === 'number') cookie += `; Max-Age=${maxAgeSec}`
  if (secure) cookie += '; Secure'

  document.cookie = cookie
}

export function getCookie(name: string): string | null {
  const prefix = `${name}=`
  const entry = document.cookie
    .split('; ')
    .find(c => c.startsWith(prefix))

  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null
}

export function deleteCookie(name: string, path = '/'): void {
  document.cookie = `${name}=; Path=${path}; Max-Age=0`
}
