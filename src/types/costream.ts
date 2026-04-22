export type ParticipantRole = 'host' | 'guest' | 'audience'

export type ApplyStatus = 'idle' | 'applying' | 'accepted' | 'rejected'

export interface CoStreamParticipant {
  id: string
  role: ParticipantRole
  nickname: string
  avatar: string
  stream?: MediaStream
  audioEnabled: boolean
  videoEnabled: boolean
  applyStatus: ApplyStatus
  joinedAt: number
}

export interface CoStreamLayout {
  participants: Array<{
    id: string
    x: number
    y: number
    width: number
    height: number
  }>
}
