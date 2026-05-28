# H5 项目与 rtmp-relay 通信及推流流程

> 编制日期：2026-06-27
> 目的：系统梳理 liveAssistantH5（前端）与 rtmp-relay（中转服务）在本地开发环境和 K8s 生产环境下的通信方式与推流全过程

---

## 一、系统角色

```
┌─────────────────────────────────────────────────────────────────────┐
│                         liveAssistantH5 (Vue 3)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                            │
│  │ 白板 Canvas│ │ 摄像头流  │ │ 屏幕共享  │                            │
│  └─────┬────┘ └────┬─────┘ └────┬─────┘                            │
│        │           │            │                                   │
│        └───────────┴────────────┘                                   │
│                    ▼                                                 │
│          ┌──────────────────┐                                       │
│          │  Canvas Mixer    │ ← 合流：白板 + 摄像头 + 屏幕 + 连麦    │
│          └────────┬─────────┘                                       │
│                   │                                                  │
│        ┌──────────┴──────────┐                                      │
│        ▼                     ▼                                       │
│  ┌────────────┐    ┌──────────────────┐                             │
│  │ WebRTC     │    │ RTMP            │                             │
│  │ (WHIP)     │    │ (MediaRecorder   │                             │
│  │            │    │  → WebSocket)    │                             │
│  └──────┬─────┘    └────────┬─────────┘                             │
└─────────┼───────────────────┼───────────────────────────────────────┘
          │                   │
          │ ① WHIP (WebRTC)   │ ② RTMP (WebSocket → ffmpeg)
          │                   │
          ▼                   ▼
┌──────────────────┐  ┌──────────────────┐
│  SRS 媒体服务器  │  │  rtmp-relay     │
│  (WebRTC/SRT/   │  │  Node.js 中转    │
│   RTMP 分发)    │  │  + ffmpeg 转封装 │
└────────┬─────────┘  └────────┬─────────┘
         │                     │
         └─────────┬───────────┘
                   │
                   ▼
         ┌──────────────────┐
         │  外网 RTMP 服务器  │
         │  (云直播 / CDN)   │
         └──────────────────┘
```

| 组件 | 技术栈 | 职责 |
|------|--------|------|
| **liveAssistantH5** | Vue 3 + TypeScript + Vite | 采集音视频、Canvas 合流、发起推流 |
| **rtmp-relay** | Node.js + ws + ffmpeg | WebSocket 接收 WebM 数据，pipe 到 ffmpeg 转为 RTMP |
| **SRS** | SRS 5.0 | 接收 WHIP/RTMP 推流，提供 FLV/HLS 拉流 |
| **nginx** | nginx:alpine | 提供前端静态文件、反向代理 WebSocket |

---

## 二、推流模式

H5 项目支持两种推流方式：

| 方式 | 协议 | 延迟 | 浏览器兼容 | 中转服务 | 路由 |
|------|------|------|-----------|---------|------|
| **WebRTC (WHIP)** | WebRTC over HTTP | < 1s | Chrome/Edge/Firefox/Safari | 不需要 rtmp-relay | 浏览器 → SRS → CDN |
| **RTMP 中转** | WebSocket + ffmpeg | < 3s | Chrome/Edge 仅 | **需要 rtmp-relay** | 浏览器 → rtmp-relay → 外网 RTMP |

> 两者在合流阶段完全共享同一套 Mixer 逻辑，区别仅在推流出口。

---

## 三、推流全流程（RTMP 模式）

### 3.1 流程总览

```
步骤 1: 采集与合流
────────────────────
 白板 Canvas ──┐
 摄像头流   ────┤
 屏幕共享   ────┤→ CanvasMixer.draw() → output Canvas → captureStream()
 连麦视频   ────┘                    (1280×720 @ 30fps)
 麦克风音频 ──→ MediaStream.addTrack(audio)

步骤 2: MediaRecorder 编码
────────────────────
 outputStream → MediaRecorder({
   mimeType: 'video/webm;codecs=h264,opus'  # 浏览器首选 H264 + Opus
              'video/webm;codecs=vp8,opus'   # 回退 VP8 + Opus
              'video/webm',                   # 兜底

   videoBitsPerSecond: streamStore.config.videoBitrate * 1000,
   audioBitsPerSecond: streamStore.config.audioBitrate * 1000,
 })

 MediaRecorder.start(100)   # 每 100ms 产出一个 WebM chunk

步骤 3: WebSocket 发送
────────────────────
 rec.ondataavailable → socket.send(WebM chunk)  →  wss://host/rtmp-relay?rtmp=目标地址

步骤 4: 服务端接收与转码
────────────────────
 rtmp-relay/server.js
   ws.on('message') → ffmpeg.stdin.write(chunk)
                      └── 背压检查：write() 返回 false 时 ws.pause()

 ffmpeg 参数:
   -i pipe:0               # 从 stdin 读 WebM 流
   -c:v copy               # 视频直通（不重编码，省 CPU）
   -c:a aac                # 音频重编码为 AAC（FLV 不支持 Opus）
   -aac_coder fast         # 快速 AAC 编码
   -ar 44100 -b:a 64k
   -fflags +genpts         # 补齐缺失 PTS
   -f flv                  # 封装为 FLV
   rtmp://目标地址          # 推送到外网 RTMP 服务器

步骤 5: 外网分发
────────────────────
 外网 RTMP 服务器 → CDN → HLS / FLV 直播流 → 观众
```

### 3.2 关键时序

```
浏览器                        rtmp-relay                     外网 RTMP
  │                             │                              │
  │ ① WSS Upgrade               │                              │
  │ /rtmp-relay?rtmp=...       │                              │
  ├───────────────────────────►│                              │
  │                             │ ② 解析 rtmp= 参数            │
  │                             │ ③ spawn ffmpeg              │
  │                             ├─────────────────────────────►│
  │                             │   RTMP 握手                  │
  │                             │◄─────────────────────────────┤
  │◄── 101 Switching ──────────┤                              │
  │                             │                              │
  │ ④ 每 100ms:                │                              │
  │ ondataavailable            │                              │
  │ socket.send(WebM chunk)    │                              │
  ├───────────────────────────►│                              │
  │                             │ ⑤ ws.on('message')           │
  │                             │ ff.stdin.write(chunk)        │
  │                             │   if false → ws.pause() ◄───┤
  │                             │                              │
  │                             │ ⑥ ffmpeg → flv (RTMP)       │
  │                             ├─────────────────────────────►│
  │                             │                              │
  │                             │ ⑦ ffmpeg 消化完, drain 事件   │
  │                             │ ws.resume()                  │
  │◄── TCP 窗口恢复 ────────────┤                              │
  │                             │                              │
  │ ⑧ 用户点"停止推流"           │                              │
  │ socket.close()              │                              │
  ├───────────────────────────►│                              │
  │                             │ ff.stdin.end()               │
  │                             ├─────────────────────────────►│
  │                             │   FIN                        │
```

---

## 四、本地环境通信（开发机）

### 4.1 拓扑

```
开发机
┌─────────────────────────────────────────────────────┐
│                                                       │
│  ┌─────────────────┐                                 │
│  │ 浏览器           │  Vite Dev Server :5173          │
│  │ localhost:5173  │  (npm run dev)                  │
│  └────────┬────────┘                                 │
│           │                                            │
│           │ WebSocket 直连                              │
│           │ ws://localhost:8080/rtmp-relay?rtmp=...   │
│           ▼                                            │
│  ┌─────────────────┐                                 │
│  │ rtmp-relay      │  node server.js                  │
│  │ :8080           │  (直接监听本机端口)                │
│  └────────┬────────┘                                 │
│           │ spawn ffmpeg                               │
│           ▼                                            │
│  ┌─────────────────┐                                 │
│  │ ffmpeg 子进程    │  -c:v copy -c:a aac -f flv      │
│  └────────┬────────┘                                 │
└───────────┼───────────────────────────────────────────┘
            │ TCP 直连（出网）
            ▼
   rtmp://rtmp-push-huaxia-m.lxi-tech.com/live/xxx
```

### 4.2 关键配置

**前端 `.env`（开发环境）**
```
VITE_RTMP_WS_URL=ws://localhost:8080/rtmp-relay
```

**rtmp-relay**
```
PORT=8080
FFMPEG_PATH=ffmpeg
```

**启动方式**

前端：
```bash
cd liveAssistantH5
npm install
npm run dev     # → http://localhost:5173
```

rtmp-relay：
```bash
cd rtmp-relay
npm install
npm start       # → ws://localhost:8080/rtmp-relay
```

### 4.3 特点

| 特性 | 说明 |
|------|------|
| 链路长度 | 浏览器 → 本机 rtmp-relay 进程（同机回环），**零中间跳** |
| 网络延迟 | 本地回环 < 0.1ms，几乎无感 |
| TCP 拥塞 | 本机回环不受网络拥塞影响 |
| 出网瓶颈 | 仅取决于开发者本地宽带到外网 RTMP 服务器的质量 |
| 调试能力 | 可以直接在浏览器 DevTools 和终端看完整日志 |

---

## 五、K8s 生产环境通信

### 5.1 拓扑

```
主播浏览器
  │
  │ HTTPS / WSS
  │ wss://<域名>/rtmp-relay?rtmp=...
  ▼
┌────────────────────────────────────────────────────────────┐
│ 腾讯云 K8s 集群                                              │
│                                                            │
│  ┌──────────────────────┐                                  │
│  │ Ingress / LB         │  TLS 终止 + 路由                  │
│  └──────────┬───────────┘                                  │
│             │                                                │
│             ▼                                                │
│  ┌──────────────────────┐                                  │
│  │ liveAssistantH5      │  前端 nginx Pod                   │
│  │ nginx Pod            │  - 提供静态页面                    │
│  │                      │  - 反向代理 /rtmp-relay WebSocket │
│  │  nginx.conf:         │                                  │
│  │  proxy_pass http://  │                                  │
│  │    rtmp-relay:14118/ │                                  │
│  │    rtmp-relay;       │                                  │
│  └──────────┬───────────┘                                  │
│             │                                                │
│             │ 集群内 ClusterIP                               │
│             │ http://rtmp-relay:14118                        │
│             ▼                                                │
│  ┌──────────────────────┐                                  │
│  │ Service: rtmp-relay  │  端口映射：14118 → 8080           │
│  │ ClusterIP :14118     │                                  │
│  └──────────┬───────────┘                                  │
│             │                                                │
│             ▼                                                │
│  ┌──────────────────────┐                                  │
│  │ rtmp-relay Pod :8080 │  Deployment (replicas: 1)        │
│  │ node server.js       │  image: rtmp-relay:latest         │
│  │ → spawn ffmpeg       │                                  │
│  └──────────┬───────────┘                                  │
└─────────────┼──────────────────────────────────────────────┘
              │
              │ ③ Pod 出网（K8s NAT Gateway）
              │     ← ← ← 当前性能瓶颈 ← ← ←
              ▼
   rtmp://rtmp-push-huaxia-m.lxi-tech.com/live/xxx
```

### 5.2 配置差异

| 配置项 | 本地环境 | K8s 生产环境 |
|--------|---------|-------------|
| 前端 WS 地址 | `ws://localhost:8080/rtmp-relay` | 运行时自动拼接 `wss://<域名>/rtmp-relay` |
| 前端 WS 协议 | 明文 ws | wss（Ingress TLS 终止） |
| rtmp-relay 访问 | 浏览器直连 `localhost:8080` | 浏览器 → nginx 反向代理 → Service（14118）→ Pod（8080） |
| 入口 | 无 | Ingress / LoadBalancer |
| 代理层 | 无 | nginx 反向代理（proxy_buffering off） |
| 出网方式 | 本机直接出网 | K8s Pod 通过 NAT Gateway 出网 |
| 带宽限制 | 开发者本地宽带 | K8s 集群 NAT 出口共享带宽 |
| 环境变量 | `.env` 手动配置 | `.env.production` 中 VITE_RTMP_WS_URL 留空（自动拼） |

### 5.3 前端自动拼 WS 地址的逻辑

```typescript
// src/composables/useRTMP.ts:27-28
const WS_ENDPOINT = import.meta.env.VITE_RTMP_WS_URL
  || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/rtmp-relay`
```

- 如果 `.env.production` 中配了 `VITE_RTMP_WS_URL` → 使用配置值
- 如果未配置（留空） → `location.host` 自动拼，保证同源、避免 Mixed Content

---

## 六、本地 vs K8s 完整对比

| 维度 | 本地开发环境 | K8s 生产环境 |
|------|------------|-------------|
| **前端运行** | Vite Dev Server（:5173） | nginx 容器提供静态文件 |
| **前端构建** | 实时热更新（dev） | 需先 `npm run build` 构建 dist |
| **WS 协议** | ws:// | wss://（Ingress TLS 终止） |
| **WS 路径** | 浏览器 → 本机进程（直连） | 浏览器 → Ingress → nginx Pod → Service → rtmp-relay Pod |
| **链路跳数** | **2 跳**（浏览器 → rtmp-relay） | **4 跳**（浏览器 → Ingress → nginx → Service → Pod） |
| **RTMP 出网** | 本机直接访问外网 | K8s NAT Gateway（共享带宽） |
| **延迟表现** | 流畅，< 1s | 流畅几秒 → 卡顿几秒 → 循环 |
| **资源限制** | 无 | CPU/memory limits（但未触顶） |
| **部署方式** | `node server.js` | Docker 镜像 → K8s Deployment |
| **日志查看** | 终端 stdout | `kubectl logs` / 日志平台 |
| **WebSocket 背压** | 很少触发（带宽充足） | 频繁触发（出口瓶颈导致 TCP 窗口关闭） |

### 6.1 卡顿的根因链路

```
外网 RTMP 服务器 ←── [瓶颈] ──→ K8s Pod
  ▲                                ▲
  │                                │
  │  K8s NAT 出口带宽抖动 / 不足    │
  │  → TCP 窗口关闭                │
  │  → ffmpeg 写入 RTMP 变慢      │
  │  → ffmpeg stdin 缓冲区满       │
  │  → rtmp-relay ws.pause()     │
  │  → TCP 背压传回浏览器          │
  │  → 浏览器 WebSocket            │
  │    bufferedAmount 持续上涨     │
  │  → 积压爆发 → 循环卡顿         │
```

详见 [rtmp-stutter-analysis.md](rtmp-stutter-analysis.md)。

---

## 七、WHIP 模式（不经过 rtmp-relay）

### 7.1 流程

```
浏览器
  │ ① getUserMedia + canvas.captureStream() → 合流 MediaStream
  │ ② RTCPeerConnection 创建 SDP offer
  │ ③ POST /rtc/v1/whip/?app=live&stream=xxx  (SDP body)
  │ ④ 收到 SDP answer → setRemoteDescription
  │ ⑤ ICE 连接建立 → WebRTC 推流
  ▼
SRS 媒体服务器（端口 1985 WHIP / 8000 UDP/ICE）
  │
  ├── RTMP 拉流： rtmp://172.21.0.15/live/xxx
  ├── HTTP-FLV：  http://172.21.0.15:8081/live/xxx.flv
  └── HLS：        http://172.21.0.15:8081/live/xxx.m3u8
```

### 7.2 与 RTMP 模式的选择

| 场景 | 推荐模式 | 原因 |
|------|---------|------|
| 低延迟需求（< 1s） | WHIP | 浏览器直连 WebRTC，不经过中转 |
| 主播浏览器为 Safari | WHIP | Safari 不支持 MediaRecorder |
| 需要推到不支持 WebRTC 的 RTMP 服务 | RTMP 中转 | 通过 ffmpeg 转 RTMP 兼容任何下游 |
| K8s 部署、出口带宽受限 | WHIP | 浏览器直接出 WebRTC，绕开 K8s 出网瓶颈 |

### 7.3 WHIP 模式下的通信链路（K8s）

```
浏览器 ──WHEP/WHIP──► SRS Pod :1985 / :8000(UDP)
                        │
                        │ 出网（RTMP 转发给 CDN / 拉流请求）
                        ▼
                      CDN / 观众
```

WHIP 模式下不经过 rtmp-relay，浏览器直接跟 SRS 建立 WebRTC 连接，**绕开了 K8s NAT 出口瓶颈**（WebRTC 走 UDP，浏览器直接与 SRS 外部通信）。

---

## 八、配置与环境变量总览

### 8.1 rtmp-relay 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8080` | WebSocket 监听端口 |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg 可执行文件路径 |

### 8.2 liveAssistantH5 环境变量

| 变量 | 本地值 | K8s 生产值 | 说明 |
|------|--------|------------|------|
| `VITE_SIGNAL_URL` | `http://localhost:3000` | `http://signalserver:3000` | 信令服务器地址（socket.io） |
| `VITE_RTMP_WS_URL` | `ws://localhost:8080/rtmp-relay` | **留空**（自动拼） | RTMP 中转 WebSocket 端点 |
| `VITE_WHIP_URL` | `http://localhost:1985/rtc/v1/whip/...` | 用户在界面手动输入 | WHIP 推流地址 |

### 8.3 K8s 端口映射

| 服务 | 容器端口 | Service 端口 | 说明 |
|------|---------|-------------|------|
| rtmp-relay | 8080 | **14118** | nginx proxy_pass 指向 Service 14118 |
| SRS (RTMP) | 1935 | 1935 | RTMP 拉流 |
| SRS (WHIP) | 1985 | 1985 | WHIP API + HTTP |
| SRS (WebRTC) | 8000/udp | 8000/udp | WebRTC ICE |

---

## 九、关键代码位置

| 功能 | 文件 | 行号 |
|------|------|------|
| WebSocket 连接 + 自动拼地址 | `src/composables/useRTMP.ts` | 27-28 |
| MediaRecorder 启动 | `src/composables/useRTMP.ts` | 63-96 |
| WebM chunk 发送（ondataavailable） | `src/composables/useRTMP.ts` | 86-90 |
| Canvas 合流（mixer） | `src/composables/useStreamMixer.ts` | 68-195 |
| WHIP 推流 | `src/composables/useWebRTC.ts` | 47-116 |
| 网络质量监测 | `src/composables/useNetworkMonitor.ts` | 35-60 |
| rtmp-relay 服务端 WebSocket 处理 | `rtmp-relay/server.js` | 32-70 |
| rtmp-relay 背压控制（drain） | `rtmp-relay/server.js` | 57-63 |
| ffmpeg 参数配置 | `rtmp-relay/server.js` | 38-48 |
| nginx WebSocket 反向代理 | `nginx.conf` | 15-33 |
| K8s rtmp-relay Service | `rtmp-relay/k8s/deployment.yaml` | 40-47 |
| docker-compose 编排 | `docker-compose.yml` | 全文件 |

---

## 十、一句话总结

```
本地：浏览器 ↔ rtmp-relay（本机）↔ 外网 RTMP      ✅ 流畅
K8s： 浏览器 ↔ Ingress ↔ nginx Pod ↔ Service ↔ rtmp-relay Pod ↔ NAT 出口 ↔ 外网 RTMP   ❌ 卡顿循环
WHIP：浏览器 ↔ SRS（直连 WebRTC，绕开中转）       ✅ 低延迟
```
