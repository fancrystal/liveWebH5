# 推流管道与音视频同步分析

> 文档生成时间：2026-05-28  
> 对应代码版本：master 分支

---

## 一、整体架构概览

```
摄像头 <video>  ──┐
屏幕共享 <video> ──┤
白板 Fabric.js   ──┤──→ offscreen canvas ──→ captureStream(30) ──→ VideoTrack ──┐
文档 PDF canvas  ──┤                                                              ├──→ MediaStream ──→ 推流
连麦视频 grid    ──┘                                                              │
麦克风 AudioTrack ────────────────────────────────────────────────────────────────┘
                                                                    ↓
                                                      WebRTC / WHIP 协议
                                                      或
                                                      RTMP（MediaRecorder → WebSocket → ffmpeg）
```

---

## 二、合流管道详解（useStreamMixer.ts）

### 2.1 Offscreen Canvas

混流器创建一块不挂载到 DOM 的 `HTMLCanvasElement`（offscreen canvas），分辨率固定为 **1280×720**（可配置）。所有视频源都通过 `CanvasRenderingContext2D.drawImage()` 逐帧绘制到这块 canvas 上。

### 2.2 Web Worker 定时器

浏览器在标签页切到后台时，`setInterval` / `requestAnimationFrame` 会被限速至约 1fps（Chrome 节能机制）。为解决这个问题，项目使用 **Web Worker** 发送 tick：

```
public/timer-worker.js
  └─ setInterval(() => postMessage({ type: 'tick' }), 33ms)   // ~30fps，Worker 不受后台限速

main thread onmessage → draw()
```

Worker 线程的定时器不受主线程 GC / 后台节能影响，能稳定维持 30fps。

### 2.3 每帧绘制顺序（draw 函数）

```
① 白色背景矩形（fillRect，防止透明漏底）
② 白板 lower-canvas（Fabric.js 已提交笔迹）
   + 白板 upper-canvas（Fabric.js 正在绘制的临时预览层）
   ※ 文档模式：通过 docCanvasGetter() 回调拿到 PDF 渲染的 canvas 替代白板
③ 屏幕共享 <video>（如果已开启）
④ 连麦方格（最多 9 路，均分或宫格布局）
⑤ 摄像头 PiP（画中画，绝对尺寸由 % × 输出宽高计算得出）
```

### 2.4 摄像头 PiP 百分比坐标系

PiP 的位置/尺寸存储在 `mediaStore.cameraPip` 中，使用**相对于容器的百分比**，而非绝对像素：

```ts
interface CameraPipPct {
  xPct: number  // 0~1，距离容器左边缘的比例
  yPct: number  // 0~1，距离容器顶边缘的比例
  wPct: number  // 0~1，宽度占容器宽度的比例
  hPct: number  // 0~1，高度占容器高度的比例
}
```

绘制时转换为输出 canvas 的绝对像素：

```ts
const px = Math.round(pip.xPct * outputWidth)
const py = Math.round(pip.yPct * outputHeight)
const pw = Math.round(pip.wPct * outputWidth)
const ph = Math.round(pip.hPct * outputHeight)
ctx.drawImage(cameraVideo, px, py, pw, ph)
```

这样无论预览界面因侧边栏收缩变得多窄，输出画面的 PiP 比例始终正确。

### 2.5 captureStream

```ts
const stream = outputCanvas.captureStream(30)
const videoTrack = stream.getVideoTracks()[0]
videoTrack.contentHint = 'detail'  // 告诉编码器优先清晰度（适合白板/文字）
```

`captureStream(30)` 返回 `CanvasCaptureMediaStreamTrack`，它在 canvas 内容变化时捕获新帧，最高 30fps。

### 2.6 音频轨道

麦克风音频**不经过 canvas**，直接从 `getUserMedia()` 获取并加入 `MediaStream`：

```ts
const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
const audioTrack = micStream.getAudioTracks()[0]
finalStream.addTrack(audioTrack)
```

音频与视频分属两条独立的轨道，浏览器/编解码器在推流时负责时间戳对齐。

---

## 三、WHIP 推流详解（useWebRTC.ts）

### 3.1 WHIP 协议简介

WHIP（WebRTC-HTTP Ingest Protocol）是一个极简的 WebRTC 推流信令协议：

```
客户端                          WHIP 服务器（SRS / ZLMediaKit）
  │                                     │
  │── POST /whip?app=live&stream=xxx ──→│  Body: SDP Offer（描述客户端的编解码能力 + ICE 候选）
  │                                     │
  │←── 201 Created ─────────────────────│  Body: SDP Answer（服务器选定的编解码 + ICE 候选）
  │                                     │
  │═══════════ UDP/SRTP 媒体数据 ════════│  实时音视频加密传输
```

整个信令只有一次 HTTP 往返，不需要 WebSocket 信令服务器，延迟 < 1s。

### 3.2 SDP（会话描述协议）

SDP 是一段文本，描述：
- **媒体类型**：audio / video
- **编解码器**：H.264 / VP8 / Opus 及其参数
- **ICE 候选**：客户端可用的网络地址（本机 IP、STUN 映射的公网 IP 等）

Offer 由客户端生成（`pc.createOffer()`），Answer 由服务器生成并返回。

### 3.3 ICE / STUN

ICE（Interactive Connectivity Establishment）用于穿透 NAT，找到双方都能通信的网络路径：

1. **host candidate**：本机局域网 IP（如 192.168.x.x）
2. **srflx candidate（server-reflexive）**：通过 STUN 服务器探测到的公网 IP:Port
3. **relay candidate**：通过 TURN 服务器中转

项目使用的 STUN 服务器（国内可访问）：

```ts
const ICE_SERVERS = [
  { urls: 'stun:stun.miwifi.com:3478' },   // 小米路由器 STUN
  { urls: 'stun:stun.qq.com:3478' },        // 腾讯 STUN
  { urls: 'stun:stun.l.google.com:19302' }, // Google STUN（境外备用）
]
```

> ⚠️ Google STUN 在中国大陆通常无法访问，必须将国内 STUN 放在列表前面。

### 3.4 addTransceiver 与编码参数

项目使用 `addTransceiver` 代替 `addTrack`，以便精细控制编码参数：

```ts
pc.addTransceiver(videoTrack, {
  direction: 'sendonly',
  sendEncodings: [{
    maxBitrate: 2_500_000,        // 2.5Mbps 上限
    maxFramerate: 30,
    scaleResolutionDownBy: 1.0,   // 禁止 Chrome 自动降分辨率
  }],
})
```

`scaleResolutionDownBy: 1.0` 非常关键：Chrome 在弱网时会自动缩小分辨率（如从 1280×720 缩为 640×360），设为 1.0 强制保持原始分辨率。

### 3.5 ICE 等待与 SDP 发送

```ts
// 等待 ICE gathering 完成（或 5s 超时）
await waitForIceGathering(pc)

// 将完整 SDP（含所有候选）一次性 POST
const resp = await fetch(whipUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/sdp' },
  body: pc.localDescription!.sdp,
})
```

等待 gathering 完成后再发 SDP，确保服务器收到所有 ICE 候选，提高连接成功率。

### 3.6 断线重连

```ts
// 指数退避：3s → 6s → 12s → 24s，最多 4 次
const delay = Math.min(BASE_DELAY * 2 ** attempt, MAX_DELAY)
```

---

## 四、RTMP 推流详解（useRTMP.ts）

```
MediaRecorder（WebM chunks, 100ms 间隔）
    ↓ WebSocket（二进制帧）
rtmp-relay 服务（Node.js）
    ↓ stdin pipe
ffmpeg（-c:v copy -c:a aac -f flv）
    ↓
RTMP 推流地址
```

### 4.1 关键参数

- **分片间隔**：`rec.start(100)` — 每 100ms 产出一个 WebM 数据块
- **MIME 类型优先级**：`video/webm;codecs=h264,opus` → `vp8,opus` → `video/webm`
- **WebSocket 端点**：优先读 `VITE_RTMP_WS_URL` 环境变量，本地开发走 Vite proxy（`/rtmp-relay`）

### 4.2 30 分钟周期重启

每 30 分钟重启 `MediaRecorder` 以防止 Opus 时间戳累积过大导致 ffmpeg 解析错误。

---

## 五、音视频同步风险审计

### ✅ 正常工作的同步机制

| 场景 | 同步方式 |
|------|---------|
| WHIP 模式 | WebRTC 内置 RTCP NTP 时间戳，音视频由协议栈自动对齐 |
| RTMP 模式 | MediaRecorder 在 WebM 容器中对 audio/video track 统一用同一时间轴 mux |
| ICE 候选 | 等待 gathering 完成再 POST SDP，避免候选不完整导致连接失败 |
| 摄像头 PiP | 百分比坐标系，与预览容器尺寸解耦 |

---

### ⚠️ 风险 1：Web Worker tick → 主线程调度抖动

**严重程度**：🟡 LOW

**描述**：  
Worker 以精确 33ms 间隔发出 `tick`，但主线程的 `onmessage` 排队在 JS 任务队列中。若主线程此时正在执行 Fabric.js 重绘、Vue 响应式更新或 GC，`draw()` 实际触发时间可能晚 5~20ms。

**影响**：  
音频（麦克风）持续流动，视频帧捕获偶尔延迟，导致单帧层面的微小 A/V 偏差（< 20ms）。

**为什么不严重**：  
- WebRTC 协议栈和播放器都有 jitter buffer（通常 100~200ms），能吸收此级别的抖动
- `captureStream` 的帧时间戳是实际捕获时刻，PTS 是准确的

**建议**：  
如出现明显抖动，可在 `draw()` 开头记录实际耗时，若连续 3 帧超过 50ms 则打印警告。

---

### ⚠️ 风险 2：MediaRecorder 30 分钟重启产生流中断（RTMP 模式）

**严重程度**：🟠 MEDIUM

**描述**：  
`scheduleRecorderRestart()` 在 30 分钟时调用 `recorder.stop()` → 创建新 `MediaRecorder` → `recorder.start(100)`。

旧录制器 stop 时会触发最后一个 `dataavailable` 事件，随后 WebM 流正常结束。新录制器产出的是一个全新的 WebM 文件（时间戳从 0 开始）。

**影响**：  
ffmpeg 的 stdin pipe 收到 WebM EOF，然后紧接着是新 WebM 头部。ffmpeg 可能：
1. 误判为流结束，输出 `moov atom not found` 并退出
2. 将新 WebM 的 `timestamp=0` 解释为时间回退，引发 Opus packet header error

实测已观察到此类报错，导致 ~1~3 秒推流中断，随后 WebSocket 重连。

**建议**：

方案 A（推荐）：改为在 rtmp-relay 服务端处理重启，客户端持续发送，服务端在安全时机重启 ffmpeg。

方案 B：重启前先等待当前 WebM 分片写完（监听 `stop` 事件后再 `start`），并在新分片头部做连续时间戳接续（需要记录上一段的最后时间戳）。

方案 C（权宜）：将重启间隔改为 2 小时，降低触发频率；同时在 rtmp-relay 的 ffmpeg 重启逻辑中加 `-re` 重连而非退出。

---

### ⚠️ 风险 3：WebSocket send 无背压控制（RTMP 模式）

**严重程度**：🟠 MEDIUM

**描述**：

```ts
socket.send(e.data)  // 在 ondataavailable 中无条件发送
```

当网络拥塞时，`socket.bufferedAmount` 持续增长，浏览器将大量 WebM 块堆积在 TCP 发送缓冲区。等缓冲区最终排空时，大量数据突发抵达 ffmpeg，造成 ffmpeg 输入不均匀 → RTMP 输出卡顿。

nginx 的 `proxy_buffering off` 修复了**服务器端**的缓冲，但浏览器端的发送队列问题依然存在。

**建议**：

```ts
socket.addEventListener('message', ...)  // 收到服务器 ack 才发下一块
// 或者简单检测：
if (socket.bufferedAmount > 1_000_000) {
  console.warn('[RTMP] WS buffer > 1MB, dropping chunk to reduce latency')
  return
}
socket.send(e.data)
```

丢帧比积压更好——积压会导致播放器收到"过去的帧"，出现时间戳跳跃。

---

### ⚠️ 风险 4：音视频启动时序不同步（两种模式）

**严重程度**：🟡 LOW

**描述**：  
`getUserMedia()` 获取麦克风和 `captureStream()` 捕获 canvas 之间存在时间差（通常 < 500ms）。二者的时钟从各自调用点开始计数：

- **WebRTC 模式**：RTCP SR（Sender Report）包含 NTP 壁钟时间，接收端据此对齐音视频，初始偏差会被纠正
- **RTMP 模式**：WebM muxer 在第一个分片时确定 audio/video 的起始时间戳关系，之后保持固定偏差

**影响**：  
可能存在 0~500ms 的初始 A/V 偏差，之后不会自动纠正（RTMP 模式）。对教学直播场景（嘴型对齐需 < 80ms）有一定影响。

**建议**：  
在 `useStreamMixer` 的 `start()` 函数中，先 `await` 获取麦克风，再调用 `captureStream()`，将两者启动时间差控制在 10ms 以内：

```ts
const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
// 紧接着启动 canvas 捕获
const canvasStream = outputCanvas.captureStream(30)
```

---

### ✅ 风险 5：captureStream 帧时间戳准确性

**严重程度**：🟢 RESOLVED（原生支持）

`captureStream(30)` 每次从 canvas 捕获时，帧的 PTS（Presentation Timestamp）是**实际捕获时刻**，不是理论上的 33ms 倍数。因此即使 `draw()` 晚了 10ms，这一帧的 PTS 也是准确的，播放器会在正确时刻显示它。

---

## 六、风险汇总表

| # | 风险 | 模式 | 严重程度 | 状态 |
|---|------|------|---------|------|
| 1 | Worker tick → 主线程调度抖动 | 两种 | 🟡 LOW | 可接受，建议加监控 |
| 2 | MediaRecorder 30min 重启中断 | RTMP | 🟠 MEDIUM | 待优化 |
| 3 | WebSocket send 无背压控制 | RTMP | 🟠 MEDIUM | 待优化 |
| 4 | 音视频启动时序偏差 | 两种 | 🟡 LOW | 建议优化启动顺序 |
| 5 | captureStream PTS 准确性 | 两种 | 🟢 LOW | 原生已解决 |

---

## 七、推荐优化优先级

1. **【优先】** 风险 3：加 WebSocket 背压检测，避免积压导致的突发卡顿
2. **【次优先】** 风险 2：将 30min 重启方案迁移到服务端或改为无缝切换
3. **【可选】** 风险 4：确保麦克风在 captureStream 之前获取
4. **【监控】** 风险 1：在 draw 函数中加帧耗时日志，超阈值告警

---

## 八、本地调试建议

设置环境变量开启详细日志：

```bash
# .env.local
VITE_VERBOSE_LOG=true
```

开启后可在控制台看到：
- `[StreamMixer] draw() called, sources: {...}` — 每 5 秒输出一次混流状态
- `[RTMP] chunk sent, size=xxx, buffered=xxx` — 每 5 秒输出一次 WebSocket 传输状态
- `[WebRTC] ICE state: ...` — ICE 连接状态变化
