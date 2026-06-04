/**
 * Auth exchange service.
 *
 * The management portal redirects into this H5 app with a one-time `code`:
 *   https://<h5-host>/?roomInfoId=<id>&code=<code>
 *
 * We POST that code (plus roomInfoId) to the SaaS exchange endpoint and get
 * back a Bearer token used for all subsequent business API calls.
 *
 * The code is single-use and short-lived (~1 min), so this must be called at
 * most once per entry; on refresh the cached cookie token is reused instead.
 */

/** Verbose diagnostic logging, toggled by VITE_VERBOSE_LOG. */
const VERBOSE_LOG = import.meta.env.VITE_VERBOSE_LOG === 'true'

/** Prefixed console logger; only emits when VERBOSE_LOG is on. */
function log(...args: unknown[]): void {
  if (VERBOSE_LOG) console.log('[authService]', ...args)
}

export interface ExchangeResult {
  token: string
  userId: string
  username: string
  /** WebRTC (WHIP) push URL for this room, issued by the server. */
  pushStreamUrl: string
}

/** Raw envelope returned by POST /livesaas/exchange. */
interface ExchangeResponse {
  requestId: string
  code: number
  msg: string
  data: {
    token: string
    userId: string
    username: string
    /** WHIP push address, e.g. https://host:20081/index/api/whip?app=live&stream=test */
    pushStreamUrl: string
  } | null
}

/**
 * Exchange a one-time portal `code` for a session token.
 *
 * @param sassUrl    SaaS API base URL, e.g. https://mall-test.lxi-tech.com:15816
 * @param roomInfoId Live room id carried in the redirect URL
 * @param code       One-time authorization code carried in the redirect URL
 * @param signal     Optional AbortSignal to cancel the request
 * @throws Error with a user-friendly message on network/CORS/business failure
 */
export async function exchangeCodeForToken(
  sassUrl:    string,
  roomInfoId: string,
  code:       string,
  signal?:    AbortSignal,
): Promise<ExchangeResult> {
  const endpoint = `${sassUrl.replace(/\/$/, '')}/livesaas/exchange`
  const requestBody = JSON.stringify({ roomInfoId, code })

  log('exchange 请求 →', endpoint)
  log('入参 roomInfoId =', roomInfoId, '| code =', code ? `${code.slice(0, 8)}…` : '(空)')

  const startedAt = performance.now()
  let res: Response
  try {
    res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    requestBody,
      signal,
    })
  } catch (err: unknown) {
    // A rejected fetch here means the request never completed: network error,
    // DNS failure, or a CORS preflight/response rejection by the browser.
    if (err instanceof Error && err.name === 'AbortError') {
      log('请求被取消 (AbortError)')
      throw err
    }
    log('请求失败 (网络/CORS):', err)
    throw new Error('无法连接登录服务，请检查网络或服务端跨域(CORS)配置')
  }

  const elapsed = Math.round(performance.now() - startedAt)
  log(`响应 HTTP ${res.status} (${elapsed}ms)`)

  if (!res.ok) {
    log('HTTP 非 2xx，判定为登录服务异常')
    throw new Error(`登录服务异常 (HTTP ${res.status})`)
  }

  const json = (await res.json()) as ExchangeResponse
  log('响应体 code =', json.code, '| msg =', json.msg, '| requestId =', json.requestId)

  if (json.code !== 200 || !json.data) {
    // Surface the server message verbatim, e.g. "链接已过期或已被使用，请刷新页面"
    log('业务失败，透传服务端文案:', json.msg)
    throw new Error(json.msg || '换取登录令牌失败')
  }

  log(
    'exchange 成功 → userId =', json.data.userId,
    '| username =', json.data.username,
    '| token.length =', json.data.token?.length ?? 0,
    '| pushStreamUrl =', json.data.pushStreamUrl || '(空)',
  )

  return {
    token:         json.data.token,
    userId:        json.data.userId,
    username:      json.data.username,
    pushStreamUrl: json.data.pushStreamUrl ?? '',
  }
}
