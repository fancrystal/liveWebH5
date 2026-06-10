import { computed } from 'vue'
import { useRoomStore } from '@/stores/roomStore'

type Locale = 'zh-CN' | 'en-US'

const zh = {
  // Status
  upcoming: '预告中', live: '直播中', ended: '已结束',
  // TopBar
  viewers: '人观看', duration: '直播时长',
  watchUrl: '观看地址',
  // BottomBar
  mic: '麦克风', camera: '摄像头', share: '共享',
  cloudDrive: '视频',
  whiteboard: '白板', addWhiteboard: '新建白板', document: '文档',
  startLive: '开始直播', endLive: '结束直播', restorePreview: '恢复预告',
  endLiveConfirmTitle: '确定结束直播？',
  endLiveConfirmDesc: '结束后观众将无法继续观看，此操作不可恢复。',
  cancel: '取消',
  selectMic: '选择麦克风', selectCamera: '选择摄像头',
  noMic: '无可用麦克风', noCamera: '无可用摄像头',
  // LeftToolbar
  selectTool: '选择 / 滚动', pen: '画笔', text: '文字',
  rect: '矩形', laser: '激光笔', eraser: '橡皮擦',
  undo: '撤销', redo: '重做', clear: '清空',
  // RightPanel tabs
  chatTab: '聊天', costreamTab: '互动\n连麦',
  // Chat
  publicChat: '聊天互动', privateChat: '私聊互动',
  sayHello: '说点什么吧', send: '发送',
  emptyChatTitle: '还没有互动消息',
  emptyChatHint: '观众的发言会显示在这里，发条消息暖暖场吧',
  onlyNewest: (n: number, total: number) => `仅显示最新 ${n} 条，共 ${total} 条`,
  // CoStream
  costreamTitle: '连麦', startCostream: '开始连麦', endCostream: '结束连麦',
  unmuteAll: '全员开麦', muteAll: '全员静音',
  waitingGuests: '等待嘉宾加入...', notStarted: '暂未开始连麦',
  applyLabel: '上麦申请', participantLabel: '连麦人数',
  accept: '同意', reject: '拒绝',
  guestTag: '嘉宾', audienceTag: '观众',
  addDemoGuest: '+ 模拟嘉宾加入', removeDemoGuest: '− 移除末位嘉宾',
  mute: '静音', unmute: '开麦', kick: '踢出连麦',
}

const en: typeof zh = {
  upcoming: 'Upcoming', live: 'Live', ended: 'Ended',
  viewers: 'viewers', duration: 'Duration',
  watchUrl: 'Watch URL',
  mic: 'Mic', camera: 'Camera', share: 'Share',
  cloudDrive: 'Video',
  whiteboard: 'Whiteboard', addWhiteboard: 'New Whiteboard', document: 'Document',
  startLive: 'Go Live', endLive: 'End Live', restorePreview: 'Restore Preview',
  endLiveConfirmTitle: 'End the live stream?',
  endLiveConfirmDesc: 'Viewers will be disconnected. This cannot be undone.',
  cancel: 'Cancel',
  selectMic: 'Select Microphone', selectCamera: 'Select Camera',
  noMic: 'No microphones found', noCamera: 'No cameras found',
  selectTool: 'Select / Scroll', pen: 'Pen', text: 'Text',
  rect: 'Rect', laser: 'Laser', eraser: 'Eraser',
  undo: 'Undo', redo: 'Redo', clear: 'Clear',
  chatTab: 'Chat', costreamTab: 'Co-\nStream',
  publicChat: 'Public Chat', privateChat: 'Private Chat',
  sayHello: 'Say something...', send: 'Send',
  emptyChatTitle: 'No messages yet',
  emptyChatHint: 'Viewer messages will show up here — say hi to warm things up',
  onlyNewest: (n: number, total: number) => `Showing latest ${n} of ${total}`,
  costreamTitle: 'Co-Stream', startCostream: 'Start Co-Stream', endCostream: 'End Co-Stream',
  unmuteAll: 'Unmute All', muteAll: 'Mute All',
  waitingGuests: 'Waiting for guests...', notStarted: 'Co-streaming not started',
  applyLabel: 'Mic Requests', participantLabel: 'Participants',
  accept: 'Accept', reject: 'Decline',
  guestTag: 'Guest', audienceTag: 'Audience',
  addDemoGuest: '+ Add Demo Guest', removeDemoGuest: '− Remove Last Guest',
  mute: 'Mute', unmute: 'Unmute', kick: 'Kick',
}

const map: Record<Locale, typeof zh> = { 'zh-CN': zh, 'en-US': en }

export function useI18n() {
  const roomStore = useRoomStore()
  const locale = computed(() => roomStore.room.language as Locale)

  function t<K extends keyof typeof zh>(key: K): typeof zh[K] {
    return (map[locale.value] ?? zh)[key]
  }

  return { t, locale }
}
