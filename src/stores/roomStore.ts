import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RoomInfo } from '@/types/room'
import { exchangeCodeForToken } from '@/services/authService'
import { fetchRoomDetail } from '@/services/roomService'
import { useStreamStore } from '@/stores/streamStore'
import { getCookie, setCookie, deleteCookie } from '@/utils/cookie'

/** Cookie key holding the session token (persists across page refresh). */
const TOKEN_COOKIE = 'lh_token'
/** Cookie key holding the WHIP push URL (so a refresh keeps the real address). */
const PUSH_URL_COOKIE = 'lh_push'

/** Verbose diagnostic logging, toggled by VITE_VERBOSE_LOG. */
const VERBOSE_LOG = import.meta.env.VITE_VERBOSE_LOG === 'true'

/** Prefixed console logger; only emits when VERBOSE_LOG is on. */
function log(...args: unknown[]): void {
  if (VERBOSE_LOG) console.log('[roomStore]', ...args)
}

/** Test-data fallback shown when there is no roomInfoId or the detail API fails. */
const FALLBACK_ROOM_DETAIL = {
  name:       '开发测试',
  roomNumber: '9996181',
  hostName:   '大安科技',
  roomState:  1,   // 预告
} as const

export const useRoomStore = defineStore('room', () => {
  const room = ref<RoomInfo>({
    id: '',
    name: '开发测试',
    hostId: '',
    viewerCount: 0,
    watchUrl: '',
    language: 'zh-CN',
    roomNumber: '',
    hostName: '',
    roomState: 1,
  })

  /** SaaS API base URL, e.g. https://mall-test.lxi-tech.com:15816 */
  const sassUrl = ref('')
  /** Bearer token used for all business API calls (exchanged from one-time code). */
  const token = ref('')
  /** Current host user id (from exchange response). */
  const userId = ref('')
  /** Current host display name (from exchange response). */
  const username = ref('')
  /** WHIP push URL issued by the server for this room (from exchange response). */
  const pushStreamUrl = ref('')

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
   *   1. Fresh portal entry (code + roomInfoId) → exchange code for token +
   *      pushStreamUrl, then persist both to cookies. A code in the URL is
   *      always fresh (spent codes are stripped after a successful swap), so it
   *      takes priority over any older cookie token. On exchange failure we fall
   *      back to a still-valid cookie token if one exists.
   *   2. Refresh (no code) → reuse the cookie token + pushStreamUrl.
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

    // 1. Portal entry takes priority: if the URL carries a `code`, it is always
    //    a FRESH one (cleanUrl() strips a code right after a successful swap, so
    //    a code lingering in the address bar is never a spent one). We must
    //    exchange it even when an older cookie token still exists — otherwise a
    //    stale cookie would short-circuit the exchange and we'd never pick up
    //    the latest token / pushStreamUrl.
    if (code && roomInfoId) {
      log('分支①: 门户进入(URL 带 code)，优先用 code 换取 token')
      if (!sassUrl.value) {
        log('分支①: 缺少 sassUrl，无法换取')
        throw new Error('未配置 SaaS 接口地址 (VITE_SASS_URL)')
      }
      try {
        const result = await exchangeCodeForToken(sassUrl.value, roomInfoId, code)
        token.value = result.token
        userId.value = result.userId
        username.value = result.username
        pushStreamUrl.value = result.pushStreamUrl
        setCookie(TOKEN_COOKIE, result.token, { sameSite: 'Lax' })
        if (result.pushStreamUrl) {
          setCookie(PUSH_URL_COOKIE, result.pushStreamUrl, { sameSite: 'Lax' })
        }
        log('分支①: 换取成功并写入 cookie | pushStreamUrl =', result.pushStreamUrl || '(空)', '，清理 URL')
        cleanUrl()
        return
      } catch (err: unknown) {
        // Exchange failed (expired/used code, network, CORS). If a valid cookie
        // token is still around, fall back to it so the user isn't locked out;
        // otherwise surface the error. We KEEP the code in the URL on a hard
        // failure so a manual reload reproduces it.
        const fallbackToken = getCookie(TOKEN_COOKIE)
        if (fallbackToken) {
          const fallbackPush = getCookie(PUSH_URL_COOKIE) ?? ''
          log('分支①: 换取失败，回退到 cookie token (length =', fallbackToken.length,
              ') | pushStreamUrl =', fallbackPush || '(空)', '| 失败原因 =',
              err instanceof Error ? err.message : err)
          token.value = fallbackToken
          pushStreamUrl.value = fallbackPush
          cleanUrl()
          return
        }
        log('分支①: 换取失败且无 cookie 兜底，抛出错误')
        throw err
      }
    }

    // 2. Refresh path: no code in the URL → reuse the cookie token. The push URL
    //    was persisted alongside the token, so restore it too — on refresh there
    //    is no code to re-exchange and the address would otherwise be lost.
    const cookieToken = getCookie(TOKEN_COOKIE)
    if (cookieToken) {
      const cookiePush = getCookie(PUSH_URL_COOKIE) ?? ''
      log('分支②: 无 code，命中 cookie token，复用 (length =', cookieToken.length,
          ') | pushStreamUrl =', cookiePush || '(空)')
      token.value = cookieToken
      pushStreamUrl.value = cookiePush
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

  /**
   * Load the live-room detail (title / state / room number / host) for the
   * top bar. Called once after bootstrap succeeds.
   *
   * Falls back to test data when:
   *   - there is no roomInfoId / token (dev entry without portal redirect), or
   *   - the detail API fails (so the title bar never shows blanks).
   */
  async function loadRoomDetail(): Promise<void> {
    if (!room.value.id || !sassUrl.value || !token.value) {
      log('loadRoomDetail: 缺少 roomInfoId/sassUrl/token，使用测试数据填充')
      updateRoom({ ...FALLBACK_ROOM_DETAIL })
      return
    }
    try {
      const d = await fetchRoomDetail(sassUrl.value, token.value, room.value.id)
      updateRoom({
        name:       d.roomTitle || room.value.name,
        roomNumber: d.roomNumber,
        hostName:   d.hostName,
        roomState:  d.roomState,
        watchUrl:   d.watchUrl,
      })
      // videoScreenMode: 1=横屏  2=竖屏 — 自动选对应的默认分辨率
      const streamStore = useStreamStore()
      const isPortrait = d.videoScreenMode === 2
      streamStore.updateConfig({ resolution: isPortrait ? '720x1280' : '1280x720' })
      log('loadRoomDetail: 成功 →', d.roomTitle, '| state =', d.roomState, '| screenMode =', d.videoScreenMode)
    } catch (err) {
      log('loadRoomDetail: 失败，使用测试数据填充 |', err instanceof Error ? err.message : err)
      updateRoom({ ...FALLBACK_ROOM_DETAIL })
    }
  }

  /** Clear the session token (e.g. on 401). Forces a re-login on next entry. */
  function clearAuth(): void {
    token.value = ''
    userId.value = ''
    username.value = ''
    pushStreamUrl.value = ''
    deleteCookie(TOKEN_COOKIE)
    deleteCookie(PUSH_URL_COOKIE)
  }

  function updateRoom(partial: Partial<RoomInfo>) {
    room.value = { ...room.value, ...partial }
  }

  return {
    room,
    sassUrl,
    token,
    userId,
    username,
    pushStreamUrl,
    updateRoom,
    bootstrap,
    loadRoomDetail,
    clearAuth,
  }
})
