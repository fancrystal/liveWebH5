// ── 运行环境 ──────────────────────────────────────────────────────────────────
/** 部署环境标识: 'development' | 'test' | 'production' */
export const APP_ENV: string = import.meta.env.VITE_APP_ENV ?? (import.meta.env.DEV ? 'development' : 'production')
export const IS_DEV  = APP_ENV === 'development'
export const IS_TEST = APP_ENV === 'test'
export const IS_PROD = APP_ENV === 'production'

// ── 详细日志（VITE_VERBOSE_LOG）────────────────────────────────────────────────
export const VERBOSE_LOG = import.meta.env.VITE_VERBOSE_LOG === 'true'
const TAG = '[env]'

// 仅 verbose 模式输出；初始化时始终打印关键配置
function _log(...args: unknown[]): void {
  if (VERBOSE_LOG) console.log(TAG, ...args)
}

// ── 腾讯云 IM ──────────────────────────────────────────────────────────────────
/** SDKAppID，来自腾讯云 IM 控制台（固定值） */
export const IM_SDK_APP_ID: number = (() => {
  const id = Number(import.meta.env.VITE_IM_SDK_APP_ID ?? 1600113763)
  _log(`IM_SDK_APP_ID = ${id}`)
  return id
})()

/** IM REST API 基地址，测试环境示例: https://qdd-test.lxi-tech.com:15830 */
export const IM_BASE_URL: string = import.meta.env.VITE_IM_BASE_URL ?? import.meta.env.VITE_BASE_URL_9085 ?? ''

// ── SaaS 业务接口 ──────────────────────────────────────────────────────────────
/** 业务 API 基地址（换 token / 直播间详情 / 云盘等），示例: https://qdd-test.lxi-tech.com:15816 */
export const SASS_URL: string = import.meta.env.VITE_SASS_URL ?? ''

/** 开发兜底: 旧地址，留空则回退到 SASS_URL */
export const DEV_SASS_URL: string = import.meta.env.VITE_DEV_SASS_URL ?? ''

// ── 信令服务 ───────────────────────────────────────────────────────────────────
/** socket.io 信令服务器地址（连麦 / 白板同步），为空时跳过连接 */
export const SIGNAL_URL: string = import.meta.env.VITE_SIGNAL_URL ?? ''

// ── 推流 ───────────────────────────────────────────────────────────────────────
/** RTMP relay WebSocket 地址 */
export const RTMP_WS_URL: string = import.meta.env.VITE_RTMP_WS_URL ?? ''

/** WHIP 推流地址（WebRTC），开发环境示例: http://localhost:1985/rtc/v1/whip/?app=live&stream=test */
export const WHIP_URL: string = import.meta.env.VITE_WHIP_URL ?? ''

// ── 调试 ───────────────────────────────────────────────────────────────────────
/** WHIP 推流地址是否允许编辑（false = 只读置灰） */
export const PUSH_URL_EDITABLE: boolean = import.meta.env.VITE_PUSH_URL_EDITABLE !== 'false'

// ── 开发环境兜底（无 portal 入口时的直接注入）─────────────────────────────────
export const DEV_TOKEN: string   = import.meta.env.VITE_DEV_TOKEN ?? ''
export const DEV_USER_ID: string = import.meta.env.VITE_DEV_USER_ID ?? ''
export const DEV_ROOM_ID: string = import.meta.env.VITE_DEV_ROOM_ID ?? ''

// ── 启动时关键配置摘要 ─────────────────────────────────────────────────────────
if (IS_DEV || VERBOSE_LOG) {
  console.log(TAG, '========================================')
  console.log(TAG, `环境: ${APP_ENV}${IS_DEV ? ' (Vite DEV mode)' : ''}`)
  console.log(TAG, `SASS_URL = ${SASS_URL || '(未配置)'}`)
  console.log(TAG, `IM_BASE_URL = ${IM_BASE_URL || '(未配置)'}`)
  console.log(TAG, `IM_SDK_APP_ID = ${IM_SDK_APP_ID}`)
  console.log(TAG, `SIGNAL_URL = ${SIGNAL_URL || '(未配置)'}`)
  console.log(TAG, `WHIP_URL = ${WHIP_URL || '(未配置)'}`)
  console.log(TAG, `RTMP_WS_URL = ${RTMP_WS_URL || '(未配置)'}`)
  console.log(TAG, `PUSH_URL_EDITABLE = ${PUSH_URL_EDITABLE}`)
  console.log(TAG, '========================================')
}
