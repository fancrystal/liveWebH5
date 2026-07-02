/**
 * Room detail service.
 *
 * POST /livesaas/ActivityAPI  body: { roomInfoId }  auth: Bearer token
 * Returns the live-room record (UserLivestreamVo). We only consume the fields
 * shown in the top bar: title, state, room number and host nickname.
 */

import { VERBOSE_LOG } from '@/config/env'

/** Prefixed console logger; only emits when VERBOSE_LOG is on. */
function log(...args: unknown[]): void {
  if (VERBOSE_LOG) console.log('[roomService]', ...args)
}

export interface RoomDetail {
  /** 直播标题 */
  roomTitle: string
  /** 直播状态：1=预告 2=直播中 3=已结束 */
  roomState: number
  /** 房间号码（唯一标识） */
  roomNumber: string
  /** 主播账号昵称 */
  hostName: string
  /** 观众观看地址（可能为空，UI 需兜底"暂无"） */
  watchUrl: string
  /** 画面方向：1=横屏  2=竖屏 */
  videoScreenMode: number
  /** 腾讯IM 群组ID */
  groupId: string
}

/** Raw envelope returned by POST /livesaas/ActivityAPI. */
interface ActivityResponse {
  requestId: string
  code: number
  msg: string
  data: {
    roomTitle?: string
    roomState?: number
    roomNumber?: string
    streamerAccountNickName?: string
    operatorName?: string
    videoScreenMode?: number
    groupId?: string
    // Watch-URL candidates — the exact field varies, probe in order
    watchUrl?: string
    liveShareUrl?: string
    shareUrl?: string
    playStreamList?: string[]
    liveStreamUrlList?: string[]
  } | null
}

/** Pick the first non-empty watch URL among the known candidate fields. */
function resolveWatchUrl(d: NonNullable<ActivityResponse['data']>): string {
  return (
    d.watchUrl ||
    d.liveShareUrl ||
    d.shareUrl ||
    (Array.isArray(d.liveStreamUrlList) ? d.liveStreamUrlList.find(u => !!u?.trim()) : '') ||
    (Array.isArray(d.playStreamList) ? d.playStreamList.find(u => !!u?.trim()) : '') ||
    ''
  )
}

/**
 * Fetch the live-room detail for the given roomInfoId.
 * @throws Error on network/HTTP/business failure — caller decides the fallback.
 */
export async function fetchRoomDetail(
  sassUrl:    string,
  token:      string,
  roomInfoId: string,
  signal?:    AbortSignal,
): Promise<RoomDetail> {
  const endpoint = `${sassUrl.replace(/\/$/, '')}/livesaas/ActivityAPI`
  log('请求 →', endpoint, '| roomInfoId =', roomInfoId)

  const res = await fetch(endpoint, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ roomInfoId }),
    signal,
  })

  if (!res.ok) throw new Error(`直播间信息接口异常 (HTTP ${res.status})`)

  const json = (await res.json()) as ActivityResponse
  log('响应 code =', json.code, '| msg =', json.msg)

  if (json.code !== 200 || !json.data) {
    throw new Error(json.msg || '获取直播间信息失败')
  }

  const d = json.data
  const detail: RoomDetail = {
    roomTitle:       d.roomTitle ?? '',
    roomState:       d.roomState ?? 1,
    roomNumber:      d.roomNumber ?? '',
    hostName:        d.streamerAccountNickName || d.operatorName || '',
    watchUrl:        resolveWatchUrl(d),
    videoScreenMode: d.videoScreenMode ?? 0,
    groupId:         d.groupId ?? '',
  }
  log('解析 →', detail)
  return detail
}
