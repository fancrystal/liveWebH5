# H5 网页端直播推流助手 — 产品方案 & 详细设计文档

> 版本：v1.0.0
> 日期：2026-04-03
> 状态：草稿

---

## 一、产品概述

### 1.1 产品定位

基于浏览器的 H5 直播推流助手，面向在线教育、培训、营销直播场景，支持 WebRTC 和 RTMP 双推流模式，提供白板教学、聊天互动、连麦、互动工具等完整直播能力。

### 1.2 核心价值

- **零安装**：纯 H5，无需客户端，浏览器即可推流
- **双模式**：WebRTC（低延迟）+ RTMP（广兼容）
- **教学场景**：白板 + 文档 + 屏幕共享
- **强互动**：聊天、连麦、问卷、抽奖等

### 1.3 目标用户

在线教育老师、企业培训讲师、营销直播主播

---

## 二、功能模块清单

| 模块 | 功能点 | 优先级 |
|------|--------|--------|
| 推流引擎 | WebRTC 推流、RTMP 推流、码流合流 | P0 |
| 白板 | 多标签白板、绘图工具、撤销/重做 | P0 |
| 媒体控制 | 摄像头/麦克风开关、摄像头预览窗口 | P0 |
| 屏幕共享 | 共享屏幕/窗口/标签页 | P0 |
| 文档展示 | 上传 PDF/PPT、翻页展示 | P1 |
| 聊天互动 | 公聊、私聊、置顶消息 | P1 |
| 连麦 | 嘉宾连麦、观众连麦、麦位管理 | P1 |
| 互动工具 | 签到、问答、简答、答题、公告、抽奖、卡券 | P2 |
| 直播管理 | 直播状态、时长统计、观看人数 | P0 |
| 设置 | 推流地址配置、画质码率、语言 | P0 |

---

## 三、技术架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    浏览器 (H5)                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ 白板画布  │  │ 摄像头流  │  │ 屏幕共享  │               │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘               │
│       │             │              │                      │
│       └─────────────┴──────────────┘                    │
│                      ↓                                    │
│            ┌─────────────────┐                           │
│            │  Canvas Mixer   │  ← 合流：白板+摄像头+共享  │
│            └────────┬────────┘                           │
│                     │                                     │
│         ┌───────────┴───────────┐                        │
│         ↓                       ↓                        │
│  ┌──────────────┐    ┌────────────────────┐              │
│  │  WebRTC 推流  │    │  RTMP 推流          │              │
│  │  (RTCPeer-   │    │  (MediaRecorder +  │              │
│  │  Connection) │    │   WebSocket/WHIP)  │              │
│  └──────┬───────┘    └─────────┬──────────┘              │
└─────────┼───────────────────────┼────────────────────────┘
          ↓                       ↓
  ┌───────────────┐     ┌──────────────────┐
  │  SFU 服务器   │     │  RTMP 推流服务器  │
  │ (SRS/Janus/  │     │  (SRS/nginx-rtmp) │
  │  mediasoup)  │     │                  │
  └───────┬───────┘     └──────────┬───────┘
          │                        │
          └───────────┬────────────┘
                      ↓
              ┌───────────────┐
              │   CDN 分发    │
              │  (HLS/DASH/  │
              │   WebRTC)    │
              └───────────────┘
```

### 3.2 前端技术栈

| 技术 | 选型 | 说明 |
|------|------|------|
| 框架 | Vue 3 + TypeScript | Composition API，类型安全 |
| 构建 | Vite 5 | 快速热更新 |
| 状态管理 | Pinia | 轻量，TS 友好 |
| 样式 | TailwindCSS + SCSS | 快速布局 |
| 白板 | Fabric.js / Konva.js | Canvas 绘图 |
| WebRTC | 原生 API + simple-peer | 连麦信令封装 |
| 推流 | WHIP 协议 / MediaRecorder | WebRTC/RTMP 推流 |
| WebSocket | socket.io-client | 实时信令/聊天 |
| 文档处理 | pdfjs-dist / pptx2png | PDF/PPT 渲染 |
| 图标 | Lucide Vue | 轻量图标 |

### 3.3 后端依赖（最小化）

| 服务 | 技术 | 作用 |
|------|------|------|
| 信令服务器 | Node.js + socket.io | WebRTC 信令、聊天消息 |
| 流媒体服务器 | SRS（Simple Realtime Server） | WebRTC/RTMP 接收+转发 |
| 文件存储 | OSS / 本地 | 文档上传存储 |

---

## 四、页面布局详细设计

### 4.1 整体布局结构

```
┌─────────────────────────────────────────────────────────────┐
│  TopBar (56px)                                              │
│  [直播名称] [状态] [观看人数] [信号] [时长]  [语言][锁定][地址]│
├─────┬───────────────────────────────────────┬───────────────┤
│     │                                       │               │
│ L   │         主内容区 (白板/文档/屏幕)       │   R Panel     │
│ e   │                                       │  (聊天/工具/   │
│ f   │    ┌─────────────────────────┐        │   连麦)        │
│ t   │    │      标签栏              │        │  (320px)       │
│     │    │  白板1  白板2  白板3  +  │        │               │
│ T   │    ├─────────────────────────┤        │               │
│ o   │    │                         │        │               │
│ o   │    │      画布内容            │   ┌──┤               │
│ l   │    │                         │   │摄│               │
│ b   │    │                         │   │像│               │
│ a   │    │                         │   │头│               │
│ r   │    │                         │   └──┘               │
│     │    └─────────────────────────┘        │               │
│(40px│                                       │               │
│ )   ├───────────────────────────────────────┤               │
│     │  BottomBar (72px)                     │               │
│     │  [麦克风] [摄像头] [共享] [白板] [文档] [⚙] [开播按钮]  │
└─────┴───────────────────────────────────────┴───────────────┘
```

### 4.2 TopBar 组件

```
状态机：预告中 → 直播中 → 已结束

显示内容：
- 左侧：直播间名称 + 状态标签（预告中/直播中/已结束）
- 中间：观看人数（A{n}人观看）+ 网络信号图标 + 直播时长计时器
- 右侧：语言切换下拉 + 锁定预告按钮 + 观看地址按钮
```

### 4.3 左侧工具栏（LeftToolbar）

```
工具列表（从上到下）：
┌──┐
│✏️ │ → 画笔工具（选中高亮）
├──┤
│T │ → 文字工具
├──┤
│□ │ → 矩形/形状工具
├──┤
│📌│ → 激光笔/指针
├──┤
│🧹│ → 橡皮擦
├──┤
│↩ │ → 撤销
├──┤
│↪ │ → 重做
├──┤
│🗑 │ → 删除选中
└──┘
```

### 4.4 主画布区（MainCanvas）

```
标签栏设计：
- 支持多白板标签（白板1、白板2…）
- 点击 × 关闭标签
- 点击 + 新增白板
- 标签可拖拽排序

摄像头小窗（PiP - Picture in Picture）：
- 默认位置：右上角
- 可拖拽任意位置
- 双指/滚轮缩放大小
- 最小 160x90，最大 400x225
- 右键菜单：隐藏、全屏、切换摄像头
```

### 4.5 底部工具栏（BottomBar）

| 按钮 | 图标 | 状态 | 功能 |
|------|------|------|------|
| 麦克风 | 🎤 | 开/关/静音 | 切换麦克风 |
| 摄像头 | 📷 | 开/关 | 切换摄像头 |
| 共享 | ⬆️ | 共享中高亮 | 屏幕/窗口/标签共享 |
| 白板 | 🖊 | 激活高亮 | 切换到白板模式 |
| 文档 | 📄 | 文档中高亮 | 打开文档 |
| 设置 | ⚙️ | — | 推流设置弹窗 |
| 主按钮 | — | 蓝色/红色 | 开始直播/结束直播/恢复预告 |

### 4.6 右侧面板（RightPanel）

**面板切换 Tab（侧边图标）：**

```
聊天图标    → 聊天互动面板
互动工具图标 → 互动工具面板
连麦图标    → 连麦管理面板
```

**聊天面板：**

```
┌─────────────────────────┐
│ [聊天互动] [私聊互动]     │  ← Tab 切换
├─────────────────────────┤
│ [全部▼] 🔍 📋 😊 ⚙️     │  ← 筛选+工具栏
├─────────────────────────┤
│                         │
│  消息列表（虚拟滚动）      │
│  头像 昵称               │
│  消息内容                │
│                         │
├─────────────────────────┤
│ 📝 置顶消息              │
├─────────────────────────┤
│ [说点什么吧...] 😊 📋 ↗ │
└─────────────────────────┘
```

**互动工具面板：**

```
┌─────────────────────────┐
│  互动工具                │
│  ┌──────┐ ┌──────┐      │
│  │ W 文档│ │  问答 │      │
│  └──────┘ └──────┘      │
│  ┌──────┐ ┌──────┐      │
│  │  签到 │ │  简答 │      │
│  └──────┘ └──────┘      │
│  ┌──────┐ ┌──────┐      │
│  │  答题 │ │  公告 │      │
│  └──────┘ └──────┘      │
│  ┌──────┐ ┌──────┐      │
│  │  抽奖 │ │  卡券 │      │
│  └──────┘ └──────┘      │
└─────────────────────────┘
```

**连麦面板：**

```
┌─────────────────────────┐
│ 连麦 ⚙️                  │
│ [开始嘉宾连麦] [开始观众连麦]│
│ [邀请嘉宾             ]  │
├─────────────────────────┤
│ 连麦人数(1) 上麦申请(0) 🔍│
├─────────────────────────┤
│ 📷 主持人（我）  🎥 🎤 ⋯ │
│ 📷 嘉宾A        🎥 🎤 ⋯ │
│ 📷 观众B（申请中）         │
├─────────────────────────┤
│ [全员开麦]    [全员静音]   │
└─────────────────────────┘
```

---

## 五、核心功能详细设计

### 5.1 推流引擎设计

#### 5.1.1 Canvas 合流（混流器）

核心思路：将所有媒体源绘制到一个 OffscreenCanvas，再推流。

```typescript
class StreamMixer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private layers: Layer[] = []
  private outputStream: MediaStream

  // 图层类型：
  // - WhiteboardLayer: 白板内容（实时截图）
  // - CameraLayer: 摄像头视频流（可拖拽定位）
  // - ScreenShareLayer: 屏幕共享流
  // - DocumentLayer: 文档图片

  // 合流循环：requestAnimationFrame 驱动，30fps 绘制
  mix() {
    // 1. 清空画布
    // 2. 按层级顺序绘制各图层
    // 3. 通过 canvas.captureStream(30) 获取视频流
    // 4. 混合麦克风/摄像头音频轨道
  }
}
```

合流顺序（从底到顶）：

```
[背景色] → [白板/文档/屏幕共享] → [摄像头小窗] → [连麦视频网格]
```

#### 5.1.2 WebRTC 推流（WHIP 协议）

```
推流流程：
Browser → WHIP Endpoint (HTTP POST SDP offer) → SRS Server
SRS Server → HTTP 201 (SDP answer)
Browser → 建立 ICE 连接 → 开始推流

优点：标准化、低延迟（< 1s）、无需额外库
```

```typescript
class WHIPPublisher {
  async publish(stream: MediaStream, whipUrl: string) {
    const pc = new RTCPeerConnection({ iceServers })
    stream.getTracks().forEach(track => pc.addTrack(track, stream))

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    // WHIP HTTP 推送
    const res = await fetch(whipUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp
    })
    const answerSdp = await res.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
  }
}
```

#### 5.1.3 RTMP 推流方案

```
方案A（推荐）：MediaRecorder + WebSocket → 中转服务 → RTMP Server
  Browser(MediaRecorder) → WebSocket → 中转服务(ffmpeg) → RTMP

方案B：RTMP over WebSocket（flv.js 反向）
  Browser → WebSocket-RTMP Bridge → RTMP Server

方案C：OBS 虚拟摄像头（兜底，提示用户手动操作）
```

实现选方案 A：

```typescript
class RTMPPublisher {
  private mediaRecorder: MediaRecorder
  private ws: WebSocket

  async publish(stream: MediaStream, rtmpUrl: string) {
    this.ws = new WebSocket(`${wsEndpoint}?rtmp=${encodeURIComponent(rtmpUrl)}`)

    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=h264,opus',
      videoBitsPerSecond: 2_000_000,  // 2 Mbps
      audioBitsPerSecond: 128_000     // 128 kbps
    })

    this.mediaRecorder.ondataavailable = (e) => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(e.data)
      }
    }

    this.mediaRecorder.start(100) // 100ms 一个 chunk
  }
}
```

服务端 ffmpeg 管道命令：

```bash
ffmpeg -i pipe:0 -c:v copy -c:a aac -f flv rtmp://xxx/live/stream
```

### 5.2 白板系统设计

基于 Fabric.js 实现：

```typescript
class WhiteboardManager {
  boards: Map<string, WhiteboardPage>  // tabId → fabric.Canvas
  activeBoard: string

  tools = {
    PEN:    'pen',     // 自由绘制
    TEXT:   'text',    // 文字
    RECT:   'rect',    // 矩形
    LASER:  'laser',   // 激光笔（临时轨迹，不持久化）
    ERASER: 'eraser',  // 橡皮擦
    SELECT: 'select'   // 选择/移动
  }

  history: Map<string, HistoryStack>  // 每个白板独立历史

  addBoard(): string          // 新增白板，返回 tabId
  removeBoard(id: string)     // 删除白板
  switchBoard(id: string)     // 切换白板（保存当前状态）
  undo()                      // 撤销
  redo()                      // 重做
  clear()                     // 清空当前白板
  getSnapshot(): ImageData    // 导出画布快照（用于合流）
}
```

**绘图工具属性：**

| 工具 | 属性配置 |
|------|----------|
| 画笔 | 颜色（默认黑）、粗细（2-20px）、透明度 |
| 文字 | 字体、字号、颜色、加粗/斜体 |
| 矩形 | 边框颜色、填充颜色、线宽 |
| 激光笔 | 红色、5px、2 秒后自动消失 |
| 橡皮擦 | 大小（20-60px） |

### 5.3 连麦系统设计

**信令流程：**

```
主播端                  信令服务器              连麦者
  │                        │                      │
  │──发起嘉宾连麦邀请──────→│──推送邀请通知────────→│
  │                        │                      │
  │                        │←──接受邀请（offer）───│
  │←──转发 offer──────────│                      │
  │──发送 answer──────────→│──转发 answer─────────→│
  │                        │                      │
  │←══════ ICE 候选交换 ══════════════════════════│
  │                        │                      │
  │←════ WebRTC P2P 或 SFU 连麦流 ════════════════│
```

```typescript
interface CoStreamParticipant {
  id: string
  role: 'host' | 'guest' | 'audience'
  nickname: string
  stream?: MediaStream
  audioEnabled: boolean
  videoEnabled: boolean
  pc: RTCPeerConnection
}

class CoStreamManager {
  participants: Map<string, CoStreamParticipant>
  maxParticipants = 9  // 最多 9 路连麦

  // 主播操作
  inviteGuest(userId: string)       // 邀请嘉宾
  startAudienceMic()                // 开启观众申请连麦
  muteAll()                         // 全员静音
  unmuteAll()                       // 全员开麦
  kickParticipant(id: string)       // 踢出连麦

  // 观众操作
  applyForMic()                     // 申请上麦
  cancelApply()                     // 取消申请

  // 连麦布局
  getLayout(): Layout               // 计算连麦视频布局
}
```

**连麦布局规则：**

| 人数 | 布局方式 |
|------|----------|
| 1人（仅主播） | 主播全屏 |
| 2人 | 主播大图（左3/4）+ 嘉宾小图（右1/4） |
| 3-4人 | 主播大图（上3/4）+ 其余小图横排（下1/4） |
| 5-9人 | 3×3 网格均分 |

### 5.4 聊天系统设计

```typescript
interface ChatMessage {
  id: string
  roomId: string
  senderId: string
  senderNickname: string
  senderAvatar: string
  content: string
  type: 'text' | 'image' | 'emoji'
  timestamp: number
  isPinned: boolean
  isPrivate: boolean
  toUserId?: string  // 私聊目标
}

class ChatManager {
  messages: ChatMessage[]
  pinnedMessage: ChatMessage | null

  // 消息量大时使用 vue-virtual-scroller 虚拟列表渲染
  sendMessage(content: string, type?: string): void
  pinMessage(messageId: string): void
  deleteMessage(messageId: string): void
  sendPrivate(toUserId: string, content: string): void
  filterByType(type: 'all' | 'private'): ChatMessage[]
}
```

### 5.5 互动工具设计

每个互动工具独立为弹窗组件：

| 工具 | 功能描述 |
|------|----------|
| **文档** | 上传 PDF/PPT，渲染展示，翻页控制，同步给观众 |
| **签到** | 发起签到，设置时限，统计签到人数及名单 |
| **问答** | 观众提问，主播查看并标记已回答 |
| **简答** | 发起简答题，收集文字回答，展示统计 |
| **答题** | 单选/多选题，实时统计选项分布饼图 |
| **公告** | 发布公告，浮窗形式展示给观众 |
| **抽奖** | 设置奖品名称和数量，随机抽取在线观众 |
| **卡券** | 发放优惠券/兑换码，设置领取条件 |

### 5.6 推流设置弹窗

```
┌─────────────────────────────────────┐
│  推流设置                     ×     │
├─────────────────────────────────────┤
│  推流方式                            │
│  ○ WebRTC (WHIP)   ● RTMP           │
├─────────────────────────────────────┤
│  推流地址                            │
│  rtmp://live.example.com/live/______│
├─────────────────────────────────────┤
│  视频设置                            │
│  分辨率  [1280x720 ▼]               │
│  帧率    [30fps    ▼]               │
│  码率    [2000 kbps    ] ━━●━━━    │
├─────────────────────────────────────┤
│  音频设置                            │
│  采样率  [48000 Hz ▼]               │
│  码率    [128 kbps  ▼]              │
├─────────────────────────────────────┤
│  摄像头  [默认摄像头 ▼]              │
│  麦克风  [默认麦克风 ▼]              │
├─────────────────────────────────────┤
│           [取消]  [保存并应用]        │
└─────────────────────────────────────┘
```

---

## 六、数据流与状态管理

### 6.1 Pinia Store 结构

```
stores/
├── streamStore.ts      # 推流状态（是否直播、时长、码率、模式）
├── mediaStore.ts       # 媒体设备（摄像头/麦克风流、设备列表）
├── whiteboardStore.ts  # 白板状态（当前白板、工具、历史）
├── chatStore.ts        # 聊天消息、置顶
├── coStreamStore.ts    # 连麦参与者、状态
├── roomStore.ts        # 直播间信息（名称、观看人数）
└── toolStore.ts        # 互动工具状态
```

### 6.2 关键数据流

```
用户点击"开始直播"
    │
    ├─→ mediaStore.initDevices()       // 获取摄像头/麦克风权限
    ├─→ whiteboardStore.getSnapshot()  // 截取白板帧
    ├─→ StreamMixer.start()            // 开始混流
    │       ├─→ 合并视频轨（白板+摄像头）
    │       └─→ 合并音频轨（麦克风）
    │
    ├─→ [WebRTC模式] WHIPPublisher.publish(stream, whipUrl)
    └─→ [RTMP模式]   RTMPPublisher.publish(stream, rtmpUrl)
                          └─→ WebSocket → 中转服务 → RTMP
```

---

## 七、项目目录结构

```
src/
├── components/
│   ├── layout/
│   │   ├── TopBar.vue
│   │   ├── LeftToolbar.vue
│   │   ├── BottomBar.vue
│   │   └── RightPanel.vue
│   ├── whiteboard/
│   │   ├── WhiteboardCanvas.vue     # Fabric.js 画布
│   │   ├── WhiteboardTabs.vue       # 白板标签栏
│   │   └── tools/                   # 各绘图工具子组件
│   ├── camera/
│   │   ├── CameraPreview.vue        # 可拖拽摄像头小窗
│   │   └── CameraSettings.vue
│   ├── chat/
│   │   ├── ChatPanel.vue
│   │   ├── ChatMessage.vue
│   │   ├── ChatInput.vue
│   │   └── PinnedMessage.vue
│   ├── costream/
│   │   ├── CoStreamPanel.vue
│   │   ├── ParticipantItem.vue
│   │   └── CoStreamVideo.vue
│   ├── tools/
│   │   ├── SignIn.vue               # 签到
│   │   ├── QnA.vue                  # 问答
│   │   ├── Quiz.vue                 # 答题
│   │   ├── Announcement.vue         # 公告
│   │   ├── LuckyDraw.vue            # 抽奖
│   │   └── Coupon.vue               # 卡券
│   ├── stream/
│   │   ├── StreamSettings.vue       # 推流设置弹窗
│   │   └── StreamStatus.vue         # 状态/时长显示
│   └── document/
│       ├── DocumentViewer.vue       # 文档展示
│       └── DocumentUpload.vue
├── composables/
│   ├── useWebRTC.ts                 # WebRTC 推流逻辑
│   ├── useRTMP.ts                   # RTMP 推流逻辑
│   ├── useStreamMixer.ts            # 混流逻辑
│   ├── useWhiteboard.ts             # 白板控制
│   ├── useMediaDevices.ts           # 设备枚举/切换
│   ├── useCoStream.ts               # 连麦管理
│   ├── useChat.ts                   # 聊天
│   └── useSocket.ts                 # WebSocket 连接
├── stores/
│   ├── streamStore.ts
│   ├── mediaStore.ts
│   ├── whiteboardStore.ts
│   ├── chatStore.ts
│   ├── coStreamStore.ts
│   └── roomStore.ts
├── services/
│   ├── SignalService.ts             # 信令服务（socket.io）
│   ├── WHIPService.ts               # WHIP 推流
│   └── RTMPService.ts               # RTMP 推流
├── types/
│   ├── stream.ts
│   ├── chat.ts
│   ├── costream.ts
│   └── whiteboard.ts
├── utils/
│   ├── canvas.ts                    # Canvas 工具函数
│   ├── media.ts                     # 媒体工具函数
│   └── format.ts                    # 时间/数字格式化
└── App.vue
```

---

## 八、关键技术难点与解决方案

### 8.1 白板与视频合流同步

**问题：** 白板是 Canvas DOM，摄像头是 `<video>`，需要合成一路视频流

**方案：**

```
1. 创建一个 offscreen canvas（推流分辨率，如 1280x720）
2. 每帧（rAF）：
   a. drawImage(whiteboardCanvas, 0, 0, w, h)      // 绘制白板
   b. drawImage(cameraVideo, x, y, camW, camH)     // 绘制摄像头小窗
3. outputCanvas.captureStream(30) → 视频轨道
4. 合并麦克风音频轨道 → 完整 MediaStream
```

### 8.2 RTMP 推流格式转换

**问题：** MediaRecorder 产生 WebM 格式，RTMP 服务器需要 flv/h264

**方案：** 服务端使用 ffmpeg 管道处理

```bash
# WebSocket 接收 WebM 数据，管道输入 ffmpeg 转为 RTMP
ffmpeg -i pipe:0 \
  -c:v copy \
  -c:a aac \
  -f flv \
  rtmp://live.example.com/live/streamkey
```

### 8.3 连麦多路视频布局

**问题：** 多人连麦时，视频需要合理排布到推流画面中，且需实时更新

**方案：**

- 1人：主播全屏
- 2人：主播大图（左 3/4）+ 嘉宾小图（右 1/4，浮层）
- 3-4人：主播大图（上）+ 其余小图横排（下）
- 5-9人：3×3 网格均分

布局变化时重新计算各视频 drawImage 的坐标和尺寸，无缝切换。

### 8.4 浏览器兼容性

| 特性 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| WebRTC | ✅ | ✅ | ✅ 12+ | ✅ |
| MediaRecorder | ✅ | ✅ | ⚠️ 14.1+ | ✅ |
| Canvas captureStream | ✅ | ✅ | ✅ 11+ | ✅ |
| Screen Share | ✅ | ✅ | ⚠️ 仅标签页 | ✅ |
| WebCodecs | ✅ | ⚠️ | ❌ | ✅ |

**策略：** 主要支持 Chrome/Edge，Safari 做降级处理（禁用 RTMP 模式，仅支持 WebRTC）。

---

## 九、接口约定（与后端信令服务）

### 9.1 WebSocket 事件

```typescript
// 客户端 → 服务端
socket.emit('join-room',         { roomId, userId, role })
socket.emit('chat-message',      { content, type, toUserId? })
socket.emit('pin-message',       { messageId })
socket.emit('co-stream-invite',  { targetUserId })
socket.emit('co-stream-answer',  { accepted, targetUserId })
socket.emit('webrtc-signal',     { to, signal })  // offer/answer/ice

// 服务端 → 客户端
socket.on('room-info',           { viewerCount, status })
socket.on('chat-message',        ChatMessage)
socket.on('co-stream-invite',    { fromUserId, nickname })
socket.on('co-stream-joined',    CoStreamParticipant)
socket.on('co-stream-left',      { userId })
socket.on('webrtc-signal',       { from, signal })
socket.on('interactive-event',   { type, data })  // 签到/抽奖等事件
```

### 9.2 HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/room/:id` | 获取直播间信息 |
| POST | `/api/room/:id/start` | 开始直播 |
| POST | `/api/room/:id/end` | 结束直播 |
| POST | `/api/upload/document` | 上传文档（PDF/PPT） |
| GET | `/api/room/:id/chat` | 获取历史聊天记录 |
| POST | `/api/interactive/:type` | 创建互动活动（签到/答题等） |
| GET | `/api/interactive/:id/result` | 获取互动结果 |

---

## 十、开发阶段规划

### Phase 1 — 核心推流（MVP）

- [ ] 项目初始化（Vite + Vue3 + TypeScript + TailwindCSS）
- [ ] 基础布局（TopBar / LeftToolbar / BottomBar / RightPanel）
- [ ] 摄像头/麦克风采集与本地预览
- [ ] 白板基础绘图（画笔、文字、矩形、橡皮擦、撤销/重做）
- [ ] 多白板标签管理
- [ ] Canvas 混流器（白板 + 摄像头合流）
- [ ] WebRTC (WHIP) 推流
- [ ] RTMP 推流（WebSocket 中转）
- [ ] 推流设置弹窗
- [ ] 直播时长计时、状态切换

### Phase 2 — 互动功能

- [ ] WebSocket 信令服务集成
- [ ] 聊天系统（公聊/私聊/置顶/虚拟列表）
- [ ] 屏幕共享（桌面/窗口/标签页）
- [ ] 文档上传与展示（PDF/PPT 渲染）

### Phase 3 — 连麦与互动工具

- [ ] WebRTC 连麦（嘉宾连麦、观众申请上麦）
- [ ] 连麦布局自适应合流
- [ ] 签到、问答、答题、公告工具
- [ ] 抽奖、卡券工具

### Phase 4 — 体验优化

- [ ] 网络质量检测与降级提示
- [ ] 推流断线自动重连
- [ ] 移动端 Safari 适配
- [ ] 性能优化（Web Worker 合流、虚拟列表）
- [ ] 端到端测试

---

## 十一、非功能性需求

| 指标 | 目标值 |
|------|--------|
| WebRTC 推流延迟 | < 1s |
| RTMP 推流延迟 | < 3s |
| 白板绘制响应 | < 16ms（60fps） |
| 混流帧率 | 30fps |
| 最大连麦人数 | 9人 |
| 支持最高分辨率 | 1080p（1920×1080） |
| 支持最高码率 | 6 Mbps |
| 浏览器最低版本 | Chrome 90+ / Edge 90+ / Firefox 90+ / Safari 14.1+ |
