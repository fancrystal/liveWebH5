import TencentCloudChat from '@tencentcloud/chat'

const IM_SDK_APP_ID = Number(import.meta.env.VITE_IM_SDK_APP_ID ?? 1600113763)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => void

const TAG = '[TencentIMService]'

/**
 * Thin wrapper around the Tencent Cloud Chat SDK.
 * Manages one SDK instance per app (singleton exported as `imService`).
 */
export class TencentIMService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private chat: any = null
  private loggedIn = false

  get TYPES() {
    return TencentCloudChat.TYPES
  }

  get EVENT() {
    return TencentCloudChat.EVENT
  }

  init(): void {
    if (this.chat) {
      console.log(TAG, 'init() 跳过 — 已存在实例')
      return
    }
    console.log(TAG, `init() | SDKAppID = ${IM_SDK_APP_ID}`)
    this.chat = TencentCloudChat.create({ SDKAppID: IM_SDK_APP_ID })
    console.log(TAG, 'init() 完成 — SDK 实例已创建')
  }

  async login(userId: string, userSig: string): Promise<void> {
    if (!this.chat) this.init()
    console.log(TAG, `login() | userId = ${userId} | userSig.length = ${userSig.length}`)
    try {
      await this.chat.login({ userID: userId, userSig })
      this.loggedIn = true
      console.log(TAG, `login() 成功 | userId = ${userId}`)
    } catch (e) {
      console.error(TAG, 'login() 失败 |', e)
      throw e
    }
  }

  async logout(): Promise<void> {
    if (!this.chat || !this.loggedIn) {
      console.log(TAG, 'logout() 跳过 — 未登录')
      return
    }
    console.log(TAG, 'logout() 开始')
    await this.chat.logout()
    this.loggedIn = false
    console.log(TAG, 'logout() 完成')
  }

  on(event: string, handler: AnyFn): void {
    console.log(TAG, `on() 注册事件 | event = ${event}`)
    this.chat?.on(event, handler)
  }

  off(event: string, handler: AnyFn): void {
    console.log(TAG, `off() 注销事件 | event = ${event}`)
    this.chat?.off(event, handler)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendTextMessage(groupId: string, text: string): Promise<any> {
    if (!this.chat || !this.loggedIn) {
      const err = new Error('IM 未就绪，请稍后重试')
      console.error(TAG, 'sendTextMessage() 失败 — 未登录 | chat =', !!this.chat, '| loggedIn =', this.loggedIn)
      throw err
    }
    console.log(TAG, `sendTextMessage() | groupId = ${groupId} | text.length = ${text.length} | preview = "${text.slice(0, 30)}${text.length > 30 ? '…' : ''}"`)
    const TYPES = TencentCloudChat.TYPES
    const msg = this.chat.createTextMessage({
      to: groupId,
      conversationType: TYPES.CONV_GROUP,
      payload: { text },
      priority: TYPES.MSG_PRIORITY_NORMAL,
    })
    try {
      const res = await this.chat.sendMessage(msg)
      const msgId = res.data?.message?.ID
      console.log(TAG, `sendTextMessage() 成功 | msgId = ${msgId}`)
      return res.data?.message
    } catch (e) {
      console.error(TAG, 'sendTextMessage() 失败 |', e)
      throw e
    }
  }

  /** Load recent group message history. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getGroupHistory(groupId: string, count = 20): Promise<any[]> {
    if (!this.chat || !this.loggedIn) {
      console.warn(TAG, 'getGroupHistory() 跳过 — 未登录')
      return []
    }
    const conversationID = `GROUP${groupId}`
    console.log(TAG, `getGroupHistory() | conversationID = ${conversationID} | count = ${count}`)
    try {
      const res = await this.chat.getMessageList({ conversationID, count })
      const list = res.data?.messageList ?? []
      console.log(TAG, `getGroupHistory() 返回 ${list.length} 条消息`)
      return list
    } catch (e) {
      console.error(TAG, 'getGroupHistory() 失败 |', e)
      return []
    }
  }

  get isReady() {
    return this.loggedIn
  }
}

export const imService = new TencentIMService()
