import { ref, onUnmounted } from 'vue'
import { imService } from '@/services/TencentIMService'
import { useChatStore } from '@/stores/chatStore'
import type { ChatMessage } from '@/types/chat'

export type IMStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'disconnected'

const TAG = '[useTencentIM]'

/** Fetch userId + userSig from the IM sign API. */
async function fetchUserSign(
  imBaseUrl: string,
  token: string,
  groupId: string,
): Promise<{ userId: string; userSig: string; nickName: string }> {
  const url = `/im-api/IM/GetImUserSign`
  console.log(TAG, `fetchUserSign() | url = ${url} | groupId = ${groupId} | token.length = ${token.length} | imBaseUrl(proxied to) = ${imBaseUrl}`)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ groupId }),
    })
  } catch (e) {
    console.error(TAG, 'fetchUserSign() 网络请求失败（可能是 CORS 或代理未生效）|', e)
    throw e
  }

  console.log(TAG, `fetchUserSign() HTTP 响应 | status = ${res.status} ${res.statusText}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(TAG, `fetchUserSign() HTTP 错误 | status = ${res.status} | body = ${body}`)
    throw new Error(`GetImUserSign HTTP ${res.status}`)
  }

  const json = await res.json()
  console.log(TAG, `fetchUserSign() 业务响应 | code = ${json.code} | msg = ${json.msg} | data =`, json.data ? { userId: json.data.userId, nickName: json.data.nickName, userSigLength: json.data.userSig?.length } : null)

  if ((json.code !== 200 && json.code !== 0) || !json.data) {
    throw new Error(json.msg || '获取IM凭证失败')
  }
  return json.data as { userId: string; userSig: string; nickName: string }
}

const GROUP_TIP_TEXT: Record<number, string> = {
  1: '来了', 2: '退出直播群', 3: '被移出直播群',
  4: '修改直播群名称', 5: '修改直播群简介',
  6: '设置直播群头像', 255: '执行了未知操作',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatGroupTip(payload: any): string {
  const users = (payload.userIDList as string[] | undefined)?.join('、') || ''
  const action = GROUP_TIP_TEXT[payload.operationType as number] || '执行了未知操作'
  return users ? `${users} ${action}` : action
}

export function useTencentIM() {
  const chatStore = useChatStore()
  const status = ref<IMStatus>('idle')
  const statusText = ref('')
  let currentGroupId = ''
  let currentNickName = ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function parseIMMessage(msg: any): ChatMessage | null {
    const TYPES = imService.TYPES
    const msgType = msg.type as string
    const senderId = (msg.from ?? '') as string

    if (msg.type === TYPES.MSG_GRP_TIP) {
      const tip = formatGroupTip(msg.payload)
      console.log(TAG, `parseIMMessage() 群提示 | operationType = ${msg.payload?.operationType} | content = "${tip}"`)
      return {
        id: msg.ID as string,
        roomId: currentGroupId,
        senderId: 'system',
        senderNickname: '系统',
        senderAvatar: '',
        content: tip,
        type: 'system',
        timestamp: (msg.time as number) * 1000,
        isPinned: false,
        isPrivate: false,
      }
    }

    if (msg.type === TYPES.MSG_TEXT) {
      const text = (msg.payload?.text ?? '') as string

      if (senderId.startsWith('11-') && text === '主持人执行了清屏操作') {
        console.log(TAG, `parseIMMessage() 清屏指令 | from = ${senderId}`)
        chatStore.clearMessages()
        return null
      }

      if (senderId === 'administrator' && text.startsWith('###$$$:')) {
        console.log(TAG, `parseIMMessage() 系统指令(忽略) | from = ${senderId} | preview = "${text.slice(0, 60)}"`)
        return null
      }

      console.log(TAG, `parseIMMessage() 文本消息 | from = ${senderId} | nick = ${msg.nick} | text.length = ${text.length} | preview = "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`)
      return {
        id: msg.ID as string,
        roomId: currentGroupId,
        senderId,
        senderNickname: (msg.nick || senderId) as string,
        senderAvatar: (msg.avatar || '') as string,
        content: text,
        type: 'text',
        timestamp: (msg.time as number) * 1000,
        isPinned: false,
        isPrivate: false,
      }
    }

    console.log(TAG, `parseIMMessage() 忽略不支持的消息类型 | type = ${msgType} | from = ${senderId}`)
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function onMessageReceived(event: any) {
    const messages = event.data as unknown[]
    console.log(TAG, `onMessageReceived() | 收到 ${messages.length} 条消息`)
    let added = 0
    for (const msg of messages) {
      const chatMsg = parseIMMessage(msg)
      if (chatMsg) { chatStore.addMessage(chatMsg); added++ }
    }
    console.log(TAG, `onMessageReceived() 完成 | 加入聊天列表 ${added} 条`)
  }

  function onSDKReady() {
    console.log(TAG, 'SDK_READY 事件 — IM 已就绪，可以收发消息')
    status.value = 'ready'
    statusText.value = '已连接直播群'
  }

  function onSDKNotReady() {
    console.warn(TAG, 'SDK_NOT_READY 事件 — IM 连接断开')
    status.value = 'disconnected'
    statusText.value = '连接断开，正在重连...'
  }

  async function loadHistory(): Promise<void> {
    console.log(TAG, `loadHistory() | groupId = ${currentGroupId}`)
    const msgs = await imService.getGroupHistory(currentGroupId, 30)
    const chatMsgs: ChatMessage[] = []
    for (const msg of msgs) {
      const parsed = parseIMMessage(msg)
      if (parsed) chatMsgs.push(parsed)
    }
    console.log(TAG, `loadHistory() 完成 | 拉取 ${msgs.length} 条，解析有效 ${chatMsgs.length} 条`)
    if (chatMsgs.length) chatStore.prependMessages(chatMsgs)
  }

  async function init(imBaseUrl: string, token: string, groupId: string): Promise<void> {
    console.log(TAG, `init() 开始 | groupId = ${groupId} | imBaseUrl = ${imBaseUrl} | token.length = ${token.length}`)

    if (!groupId) {
      console.warn(TAG, 'init() 跳过 — groupId 为空（直播间可能未绑定IM群）')
      return
    }
    if (!imBaseUrl) {
      console.warn(TAG, 'init() 跳过 — imBaseUrl 为空（sassUrl 未配置）')
      return
    }

    currentGroupId = groupId
    status.value = 'connecting'
    statusText.value = '正在连接聊天...'

    try {
      console.log(TAG, '① 获取 IM 凭证...')
      const { userId, userSig, nickName } = await fetchUserSign(imBaseUrl, token, groupId)
      currentNickName = nickName
      console.log(TAG, `① 凭证获取成功 | userId = ${userId} | nickName = ${nickName}`)

      console.log(TAG, '② 初始化 SDK...')
      imService.init()

      console.log(TAG, '③ 注册事件监听...')
      imService.on(imService.EVENT.MESSAGE_RECEIVED, onMessageReceived)
      imService.on(imService.EVENT.SDK_READY, onSDKReady)
      imService.on(imService.EVENT.SDK_NOT_READY, onSDKNotReady)

      console.log(TAG, `④ 登录 IM | userId = ${userId}...`)
      await imService.login(userId, userSig)
      console.log(TAG, '④ login() 调用完成，等待 SDK_READY 事件...')

      console.log(TAG, '⑤ 后台拉取历史消息...')
      loadHistory().catch((e) => console.error(TAG, '历史消息拉取失败 |', e))
    } catch (e) {
      status.value = 'error'
      statusText.value = '聊天连接失败'
      console.error(TAG, 'init() 失败 | error =', e)
      if (e instanceof Error) {
        console.error(TAG, `init() 失败详情 | message = ${e.message} | stack = ${e.stack}`)
      }
    }
  }

  async function sendMessage(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return

    console.log(TAG, `sendMessage() | groupId = ${currentGroupId} | text = "${trimmed.slice(0, 40)}${trimmed.length > 40 ? '…' : ''}"`)
    const sentMsg = await imService.sendTextMessage(currentGroupId, trimmed)

    const localMsg: ChatMessage = {
      id: (sentMsg?.ID as string) || `local-${Date.now()}`,
      roomId: currentGroupId,
      senderId: 'self',
      senderNickname: currentNickName || '我',
      senderAvatar: '',
      content: trimmed,
      type: 'text',
      timestamp: Date.now(),
      isPinned: false,
      isPrivate: false,
    }
    chatStore.addMessage(localMsg)
    console.log(TAG, `sendMessage() 本地回显完成 | msgId = ${localMsg.id}`)
  }

  onUnmounted(() => {
    console.log(TAG, 'onUnmounted() — 注销事件监听')
    imService.off(imService.EVENT.MESSAGE_RECEIVED, onMessageReceived)
    imService.off(imService.EVENT.SDK_READY, onSDKReady)
    imService.off(imService.EVENT.SDK_NOT_READY, onSDKNotReady)
  })

  return { status, statusText, init, sendMessage }
}

export type TencentIMInstance = ReturnType<typeof useTencentIM>
