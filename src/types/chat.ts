export type MessageType = 'text' | 'image' | 'emoji'

export interface ChatMessage {
  id: string
  roomId: string
  senderId: string
  senderNickname: string
  senderAvatar: string
  content: string
  type: MessageType
  timestamp: number
  isPinned: boolean
  isPrivate: boolean
  toUserId?: string
}

export type ChatFilter = 'all' | 'private'
