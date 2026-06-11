export interface RoomInfo {
  id: string
  name: string
  hostId: string
  viewerCount: number
  watchUrl: string
  language: 'zh-CN' | 'en-US'
  /** 房间号码（唯一标识），展示在标题栏 */
  roomNumber: string
  /** 主持人昵称，展示在标题栏 */
  hostName: string
  /** 服务端直播状态：1=预告 2=直播中 3=已结束 */
  roomState: number
}
