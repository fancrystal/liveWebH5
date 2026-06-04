import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RoomInfo } from '@/types/room'
import { exchangeCodeForToken } from '@/services/authService'
import { getCookie, setCookie, deleteCookie } from '@/utils/cookie'

/** Cookie key holding the session token (persists across page refresh). */
const TOKEN_COOKIE = 'lh_token'

/** Verbose diagnostic logging, toggled by VITE_VERBOSE_LOG. */
const VERBOSE_LOG = import.meta.env.VITE_VERBOSE_LOG === 'true'

/** Prefixed console logger; only emits when VERBOSE_LOG is on. */
function log(...args: unknown[]): void {
  if (VERBOSE_LOG) console.log('[roomStore]', ...args)
}

export const useRoomStore = defineStore('room', () => {
  const room = ref<RoomInfo>({
    id: '',
    name: '开发测试',
    hostId: '',
    viewerCount: 0,
    watchUrl: '',
    language: 'zh-CN',
    isPreviewLocked: false,
  })

  /** SaaS API base URL, e.g. https://mall-test.lxi-tech.com:15816 */
  const sassUrl = ref('')
  /** Bearer token used for all business API calls (exchanged from one-time code). */
  const token = ref('')
  /** Current host user id (from exchange response). */
  const userId = ref('')
  /** Current host display name (from exchange response). */
  const username = ref('')

  /**
   * Resolve the SaaS API base URL.
   * Priority: URL `sassUrl` param > VITE_SASS_URL env > dev fallback.
   * Both the exchange endpoint and business endpoints live under this base.
   */
  function resolveSassUrl(params: URLSearchParams): string {
    return (
      params.get('sassUrl') ||
      (import.meta.env.VITE_SASS_URL ?? '') ||
      (import.meta.env.DEV ? (import.meta.env.VITE_DEV_SASS_URL ?? '') : '')
    )
  }

  /**
   * Bootstrap auth + room context. Called once on app mount.
   *
   * Portal entry flow:
   *   ?roomInfoId=<id>&code=<code>  →  POST /livesaas/exchange  →  token
   *
   * Resolution order:
   *   1. Cookie token present (page refresh)  → reuse it, skip exchange.
   *      The one-time code is already consumed, so re-exchanging would fail.
   *   2. Fresh portal entry (code + roomInfoId) → exchange code for token,
   *      then persist the token to a cookie.
   *   3. Dev fallback → read token/userId straight from VITE_DEV_* env vars.
   *
   * After resolving, the one-time `code` (and any legacy `token`) is stripped
   * from the address bar so it can't be reused, shared, or leaked via Referer.
   *
   * @throws Error when a code is present but the exchange fails (e.g. expired or
   *         already-used link). The caller should surface this to the user.
   */
  async function bootstrap(): Promise<void> {
    const params = new URLSearchParams(window.location.search)
    const isDev = import.meta.env.DEV

    sassUrl.value = resolveSassUrl(params)

    // roomInfoId is the new param name; keep roomId for backward compatibility.
    const roomInfoId = params.get('roomInfoId') || params.get('roomId') || ''
    const code = params.get('code') || ''
    const roomName = params.get('roomName') || ''

    log('bootstrap 开始 | isDev =', isDev)
    log('原始 URL =', window.location.href)
    log('解析参数 → sassUrl =', sassUrl.value, '| roomInfoId =', roomInfoId, '| code =', code ? `${code.slice(0, 8)}…` : '(无)')

    const roomPatch: Partial<RoomInfo> = {}
    if (roomInfoId) roomPatch.id = roomInfoId
    if (roomName) roomPatch.name = roomName
    if (Object.keys(roomPatch).length) room.value = { ...room.value, ...roomPatch }

    // 1. Refresh path: reuse the cookie token, never touch the spent code.
    const cookieToken = getCookie(TOKEN_COOKIE)
    if (cookieToken) {
      log('分支①: 命中 cookie token，复用 (length =', cookieToken.length, ')，跳过换取')
      token.value = cookieToken
      cleanUrl()
      return
    }

    // 2. Portal entry: exchange the one-time code for a token.
    //    On failure we deliberately KEEP the code in the URL so that a manual
    //    page reload reproduces the same error instead of silently dropping
    //    into a no-token state. cleanUrl() only runs after a successful swap.
    if (code && roomInfoId) {
      log('分支②: 门户进入，开始用 code 换取 token')
      if (!sassUrl.value) {
        log('分支②: 缺少 sassUrl，无法换取')
        throw new Error('未配置 SaaS 接口地址 (VITE_SASS_URL)')
      }
      const result = await exchangeCodeForToken(sassUrl.value, roomInfoId, code)
      token.value = result.token
      userId.value = result.userId
      username.value = result.username
      setCookie(TOKEN_COOKIE, result.token, { sameSite: 'Lax' })
      log('分支②: 换取成功并写入 cookie，清理 URL')
      cleanUrl()
      return
    }

    // 3. Dev fallback: read directly from env vars (no portal redirect).
    if (isDev) {
      log('分支③: 开发兜底，从 VITE_DEV_* 读取 token/userId')
      token.value = import.meta.env.VITE_DEV_TOKEN ?? ''
      userId.value = import.meta.env.VITE_DEV_USER_ID ?? ''
      if (!room.value.id) {
        const devRoom = import.meta.env.VITE_DEV_ROOM_ID ?? ''
        if (devRoom) room.value = { ...room.value, id: devRoom }
      }
      log('分支③: dev token.length =', token.value.length, '| userId =', userId.value || '(空)')
    } else {
      log('分支④: 无 cookie、无 code、非开发环境 → 无 token 进入应用')
    }

    // No cookie, no code, nothing to exchange — strip any stray sensitive
    // params before handing control back to the app.
    cleanUrl()
  }

  /** Remove one-time (`code`) and sensitive (`token`) params from the URL bar. */
  function cleanUrl(): void {
    const clean = new URL(window.location.href)
    clean.searchParams.delete('code')
    clean.searchParams.delete('token')
    history.replaceState(null, '', clean.toString())
  }

  /** Clear the session token (e.g. on 401). Forces a re-login on next entry. */
  function clearAuth(): void {
    token.value = ''
    userId.value = ''
    username.value = ''
    deleteCookie(TOKEN_COOKIE)
  }

  function updateRoom(partial: Partial<RoomInfo>) {
    room.value = { ...room.value, ...partial }
  }

  function togglePreviewLock() {
    room.value.isPreviewLocked = !room.value.isPreviewLocked
  }

  return {
    room,
    sassUrl,
    token,
    userId,
    username,
    updateRoom,
    togglePreviewLock,
    bootstrap,
    clearAuth,
  }
})
