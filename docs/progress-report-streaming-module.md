# H5 推流模块进度汇报

> 版本：v1.2.0  
> 汇报日期：2026-05-28  
> 项目：liveAssistantH5（H5 网页端直播推流助手）

---

## 一、整体进度概览

| 模块 | 计划功能 | 已完成 | 进行中 | 待开发 | 完成度 |
|------|---------|--------|--------|--------|--------|
| **推流引擎** | WHIP/RTMP 双模式推流 | ✅ 核心链路、弱网自适应 | — | — | 95% |
| **合流混流** | Canvas 多路合流 | ✅ 白板+摄像头+共享+连麦 | — | — | 90% |
| **白板** | 多标签绘图 | ✅ 完整绘图工具 | — | — | 85% |
| **文档展示** | PDF 上传渲染 | ✅ PDF 渲染+翻页 | — | PPT | 70% |
| **媒体控制** | 摄像头/麦克风 | ✅ 开关+预览+画中画 | — | — | 90% |
| **聊天互动** | 实时聊天 | ✅ Store + 消息模型 | 🔄 信令对接 | — | 40% |
| **连麦** | 多方音视频 | ✅ WebRTC P2P 框架 | 🔄 信令服务端 | 麦位管理 UI | 50% |
| **直播管理** | 在线人数/观看地址 | ✅ 数据模型 | 🔄 服务端对接 | — | 30% |
| **弱网优化** | 自适应码率/重连 | ✅ 本期新增 | — | — | 100% |

---

## 二、WHIP（WebRTC）推流完整流程

### 2.1 推流建立流程（时序图）

```mermaid
sequenceDiagram
    participant 主播端 as 主播端(浏览器)
    participant STUN as STUN服务器
    participant WHIP as WHIP服务器(ZLMediaKit)
    participant CDN as CDN/播放端

    主播端->>主播端: 1. captureStream() 从 offscreen canvas 获取视频轨
    主播端->>主播端: 2. getUserMedia() 获取麦克风音频轨
    主播端->>主播端: 3. new RTCPeerConnection({ iceServers })
    主播端->>主播端: 4. addTransceiver(videoTrack, sendEncodings)
    主播端->>主播端: 5. createOffer() 生成 SDP Offer

    主播端->>STUN: 6. STUN Binding Request（UDP 3478）
    STUN-->>主播端: 7. 返回公网 IP:Port（srflx candidate）

    主播端->>主播端: 8. 等待 ICE gathering 完成（或 5s 超时）

    主播端->>WHIP: 9. POST /whip?app=live&stream=xxx，Body: SDP Offer
    WHIP-->>主播端: 10. 201 Created，Body: SDP Answer

    主播端->>主播端: 11. setRemoteDescription(answer)
    主播端->>WHIP: 12. ICE 连接性检测（UDP 打洞）
    WHIP-->>主播端: ICE 连通确认

    主播端->>WHIP: 13. SRTP/DTLS 加密媒体流（UDP）
    WHIP->>CDN: 14. 转推 RTMP / 分发 HLS / WebRTC
    CDN-->>CDN: 15. 观众拉流观看
```

### 2.2 合流管道（流程图）

```mermaid
flowchart TD
    WB["白板 Canvas\nFabric.js lower+upper canvas"]
    DOC["文档 Canvas\nPDF.js 渲染"]
    CAM["摄像头 video"]
    SCR["屏幕共享 video"]
    CO["连麦视频\n最多9路 video"]
    MIC["麦克风\nAudioTrack"]

    WB -->|drawImage| MIXER
    DOC -->|drawImage| MIXER
    SCR -->|drawImage| MIXER
    CO -->|drawImage 宫格布局| MIXER
    CAM -->|drawImage PiP 画中画| MIXER

    subgraph MIXER["offscreen canvas 1280x720"]
        direction TB
        TICK["Web Worker tick\n@30fps（后台不降速）"]
        DRAW["draw():\n①白底 ②白板/文档 ③共享\n④连麦格 ⑤摄像头 PiP"]
        TICK --> DRAW
    end

    MIXER -->|"captureStream(30)"| VT["VideoTrack\ncontentHint=detail"]
    MIC -->|直接添加，不经过 canvas| AT["AudioTrack\n48kHz Opus"]

    VT --> MS["MediaStream\n= VideoTrack + AudioTrack"]
    AT --> MS

    MS --> WHIP["WebRTC / WHIP 推流"]
    MS --> RTMP["RTMP 推流"]
```

### 2.3 弱网自适应码率状态机

```mermaid
flowchart TD
    START([建立连接]) --> GOOD

    GOOD["good\n码率 100%  全帧率"]
    DEGRADED["degraded\n码率 60%  全帧率\nsender.setParameters 原地调整"]
    POOR["poor\n码率 30%  最高 15fps\nsender.setParameters 原地调整"]
    RECON(["重连中\n指数退避 3→6→12→24s"])
    DONE([结束])

    GOOD -->|"连续2次：丢包>2% 或 RTT>100ms"| DEGRADED
    DEGRADED -->|"连续2次：丢包<2% 且 RTT<100ms"| GOOD
    DEGRADED -->|"连续2次：丢包>10% 或 RTT>300ms"| POOR
    POOR -->|"连续2次：丢包<10% 且 RTT<300ms"| DEGRADED
    POOR -->|"ICE disconnected 超过5s 或 failed"| RECON
    RECON -->|"重连成功 / ICE 自愈"| GOOD
    RECON -->|"重连4次失败"| DONE
```

### 2.4 ICE 断线自愈流程

```mermaid
flowchart TD
    A([ICE disconnected 事件]) --> B{是否已 stopped?}
    B -- 是 --> Z([结束])
    B -- 否 --> C[启动 5s Grace Timer\n等待 NAT 重绑 / Wi-Fi 切换自愈]

    C --> D{5s 后 ICE 状态?}
    D -- "connected/completed\n自愈成功" --> E[取消 Timer\n恢复 netQuality=good]
    D -- "仍为 disconnected\n未自愈" --> F[立即重连\n重置 reconnectCount=0\n无退避惩罚]

    F --> G[new RTCPeerConnection\ncreateOffer 并 POST WHIP]
    G --> H{重连成功?}
    H -- 是 --> I[推流恢复\ntoast 提示用户]
    H -- 否 --> J[scheduleReconnect\n指数退避 3→6→12→24s]
    J --> K{达到 4 次上限?}
    K -- 否 --> G
    K -- 是 --> L[toast 错误提示\n停止推流]
```

---

## 三、RTMP 推流完整流程

### 3.1 推流建立流程（时序图）

```mermaid
sequenceDiagram
    participant 主播端 as 主播端(浏览器)
    participant RELAY as rtmp-relay中转
    participant FFMPEG as ffmpeg进程
    participant RTMP as RTMP服务器

    主播端->>主播端: 1. new MediaRecorder(stream, {mimeType, videoBitsPerSecond})
    Note right of 主播端: mimeType优先选 h264+opus WebM

    主播端->>RELAY: 2. WebSocket 握手，携带 rtmp=推流地址 参数

    RELAY->>FFMPEG: 3. spawn ffmpeg，-i pipe:0 -c:v copy -c:a aac -f flv
    FFMPEG->>RTMP: 4. 建立 RTMP 连接（TCP 1935）

    主播端->>主播端: 5. recorder.start(100ms chunk interval)

    loop 每 100ms
        主播端->>主播端: 检查 socket.bufferedAmount
        alt bufferedAmount 小于 2MB（正常）
            主播端->>RELAY: 发送 WebM chunk（二进制帧）
            RELAY->>FFMPEG: pipe.stdin.write(chunk)
            FFMPEG->>RTMP: 推送 FLV 数据
        else bufferedAmount 大于 2MB（拥塞）
            主播端->>主播端: 丢弃本帧（实时性优先）
            主播端->>主播端: 持续 8s 则触发 recovery reconnect
        end
    end

    Note over 主播端,RELAY: 每 30 分钟执行 planned restart
    主播端->>主播端: recorder.requestData() 刷新尾帧
    主播端->>RELAY: close(1000, planned-restart)
    RELAY->>FFMPEG: stdin EOF，ffmpeg 正常退出
    主播端->>RELAY: 500ms 后重新连接
    RELAY->>FFMPEG: 启动新 ffmpeg 进程
```

### 3.2 背压控制与弱网策略（状态图）

```mermaid
flowchart TD
    START([WS 连接建立]) --> GOOD

    GOOD["good\nbufferedAmount 小于 64KB\n正常发送所有帧"]
    DEGRADED["degraded\n64KB ~ 512KB\n发送但警告用户"]
    POOR["poor\n大于 2MB\n丢弃当前帧"]
    RECOVERY["recovery 重连\n持续 poor 超过 8s\n清空 TCP 积压缓冲"]
    RECON["unexpect 重连\n指数退避 3→6→12→24s"]
    DONE([结束])

    GOOD -->|bufferedAmount 超过 512KB| DEGRADED
    DEGRADED -->|bufferedAmount 低于 64KB| GOOD
    DEGRADED -->|bufferedAmount 超过 2MB| POOR
    POOR -->|bufferedAmount 低于 2MB| DEGRADED
    POOR -->|"持续超过8s 且 距上次重连超60s"| RECOVERY
    RECOVERY -->|"重连成功\n新 ffmpeg 进程"| GOOD
    RECOVERY -->|重连4次失败| DONE

    GOOD -->|WS 意外断开| RECON
    RECON -->|重连成功| GOOD
    RECON -->|重连4次失败| DONE
```

### 3.3 30 分钟计划重启对比（时序图）

```mermaid
sequenceDiagram
    participant REC as MediaRecorder
    participant WS as WebSocket
    participant RELAY as rtmp-relay
    participant FFMPEG as ffmpeg

    Note over REC,FFMPEG: 旧方案（有 bug）
    REC->>REC: recorder.stop()
    REC->>REC: new MediaRecorder().start()
    REC->>WS: 同一 WS 发送新 WebM EBML 头
    WS->>RELAY: 旧 ffmpeg 收到中途插入的新头部
    RELAY->>FFMPEG: Opus packet header error，ffmpeg 崩溃断流

    Note over REC,FFMPEG: 新方案（本次修复）
    REC->>REC: recorder.requestData() 刷新缓存中的最后一帧
    Note right of REC: 等待 300ms 让最后一帧发出
    REC->>WS: close(1000, planned-restart)
    WS->>RELAY: WebSocket 正常关闭
    RELAY->>FFMPEG: stdin.end()，ffmpeg 收到 EOF
    FFMPEG->>FFMPEG: 正常退出（无报错）
    Note over REC,FFMPEG: 500ms 后
    REC->>WS: 新 WebSocket 连接
    RELAY->>FFMPEG: 启动新 ffmpeg 进程
    REC->>REC: new MediaRecorder().start()
    REC->>WS: 全新 WebM 流（时间戳从 0 开始）
```

---

## 四、两种推流模式对比与已知卡点

### 4.1 模式对比

| 维度 | WHIP（WebRTC） | RTMP（MediaRecorder）|
|------|---------------|----------------------|
| 延迟 | **< 1s** | 3~8s（含 ffmpeg 缓冲） |
| 兼容性 | 现代浏览器均支持 | Chrome / Edge（Safari 不支持） |
| 编码 | 浏览器硬件编码（H.264/VP8） | 浏览器软编 → ffmpeg 转 FLV |
| 服务端复杂度 | 只需 WHIP 接口（SRS/ZLM） | 需额外 rtmp-relay 中转服务 |
| 弱网表现 | ICE 自愈 + 自适应码率 | 背压丢帧 + 重连 |
| 音视频同步 | RTCP NTP 时间戳自动对齐 | WebM muxer 统一时间轴 |
| 国内访问 | STUN 需用国内服务器 | 无限制（仅 HTTP/WS） |

### 4.2 WHIP 推流待确认疑问点

**疑问点 1：ZLMediaKit 公网暴露的安全性**

ZLMediaKit 的 WHIP 接口目前直接暴露在公网，任何人只要知道地址就可以向该流媒体服务器推流，存在以下风险：

| 风险 | 描述 | 建议方案 |
|------|------|---------|
| 未授权推流 | 外部人员可推流占用带宽和存储 | WHIP 接口加 Token 鉴权（请求头携带 Authorization） |
| 接口探测 | 服务器端口和服务类型可被扫描识别 | nginx 反向代理，隐藏真实端口，仅暴露 443 |
| 推流地址泄露 | stream 名称规律可被猜测枚举 | stream 名称使用随机 UUID，后端动态签发 |
| 无推流频率限制 | 可发起大量连接耗尽服务器资源 | 接入层限制单 IP 并发连接数 |

> **待确认**：当前服务端是否有鉴权机制？是否需要前端在 WHIP 请求头中携带 Token？

---

**疑问点 2：多路同时推流的稳定性**

当前架构下，多个主播同时使用 WHIP 推流到同一个 ZLMediaKit 实例时，存在以下不确定因素：

| 维度 | 问题描述 | 待验证内容 |
|------|---------|-----------|
| 服务端并发上限 | ZLMediaKit 单实例支持多少路 WebRTC 并发推流？ | 需压测，通常单核支持 50~100 路 |
| ICE 端口资源 | 每路 WHIP 连接占用一个 UDP 端口，端口耗尽会拒绝新连接 | 确认 ZLMediaKit 的 UDP 端口范围配置 |
| 带宽瓶颈 | 每路 2.5Mbps，10 路并发 = 25Mbps 上行 | 确认服务器带宽上限 |
| 流名冲突 | 两个主播推同名 stream 会互相覆盖 | 流名需由后端统一分配，前端不允许自填 |
| K8s 横向扩展 | 多个 ZLMediaKit Pod 时，WHIP 请求需要 Session 亲和性路由 | 负载均衡需配置 sticky session |

> **待确认**：目前是单实例部署还是多实例？是否有计划做横向扩展？

### 4.3 RTMP 推流已知卡点

| 卡点 | 根因 | 状态 | 解决方案 |
|------|------|------|---------|
| **🔴 浏览器→relay 上行带宽瓶颈** | 浏览器到 rtmp-relay 的 TCP 上行实测只有 ~500 kbps，而视频编码目标码率 ≥ 1 Mbps，导致 `socket.bufferedAmount` 持续堆积到 ~55 MB，反压机制不断丢帧，观众侧表现为"流畅一段卡一段"。**确认依据**：relay 日志 `kbps~500 stdinPauses=0`（说明 relay→腾讯云 RTMP 方向完全正常，瓶颈在浏览器上传段）；前端 console `wsBuffered` 在 2 MB 附近持续震荡（反压生效但上行带宽仍不足）；ffmpeg 输出侧无 stdin 背压，排除服务端问题。 | 🔴 当前核心卡点 | **方案 A（临时）**：将视频编码码率降至 400 kbps，匹配实际可用上行带宽；**方案 B（根本）**：排查 K8s Ingress 是否配置了 `nginx.ingress.kubernetes.io/limit-rate` 或节点带宽 QoS 限速策略；**方案 C（备选）**：切换 WHIP 模式（UDP，无 TCP 队列积压问题） |
| **K8s nginx 缓冲卡顿** | nginx `proxy_buffering on`（默认），WebM 分片被积压后批量转发，ffmpeg 收到数据不均匀 | ✅ 已修复 | nginx 添加 `proxy_buffering off` + `tcp_nodelay on` |
| **30分钟 Opus 崩溃** | 同一 WebSocket 上重启 MediaRecorder，ffmpeg 收到中途插入的新 WebM EBML 头，触发 Opus packet header error，断流 1~3s | ✅ 已修复 | 关闭 WS → 新 WS → 新 ffmpeg 进程接收干净 WebM |
| **TCP 积压延迟飙升** | 弱网时 `socket.bufferedAmount` 持续堆积，观众收到"过去内容"而非实时画面 | ✅ 已修复 | bufferedAmount 超 2 MB 丢帧，持续 8s 触发 recovery 重连 |
| **Safari 不支持** | Safari 的 MediaRecorder 不支持 h264/vp8 WebM 格式 | ⚠️ 已知限制 | 检测到 Safari 时降级提示，引导用户切换 WHIP 模式 |

> **补充说明**：relay 日志中出现的 `EBML corruption / invalid packet` 警告，是反压机制丢弃 WebM 分片（非完整 cluster）后 ffmpeg 解析不完整数据产生的**副作用**，并非独立问题，根本原因仍是上行带宽不足。

---

## 五、待开发功能分析

### 5.1 观看人数（Viewer Count）

**现状**：`roomStore.room.viewerCount` 字段已存在，数据来源尚未对接。

**实现方案：**

```mermaid
sequenceDiagram
    participant 观众端
    participant 信令服务 as 信令服务器
    participant 主播端

    观众端->>信令服务: join-room { roomId }
    信令服务->>信令服务: 维护房间人数计数器
    信令服务->>主播端: viewer-count-update { count: 128 }
    主播端->>主播端: roomStore.updateRoom({ viewerCount: 128 })
    Note over 主播端: TopBar 实时展示在线人数

    观众端->>信令服务: 断开连接（页面关闭/刷新）
    信令服务->>信令服务: 计数器减1（含 30s 去抖，防刷新抖动）
    信令服务->>主播端: viewer-count-update { count: 127 }
```

**待开发工作：**
- 信令服务端：`join-room` / `leave-room` 事件 + 房间人数维护
- 心跳机制：观众端每 30s 发 `heartbeat`，服务端超时 60s 自动踢出
- 主播端：`SignalService.on('viewer-count-update')` 更新 store

**估时：** 前端 0.5 天 + 服务端 1 天

---

### 5.2 观看地址（Watch URL）

**现状**：`roomStore.room.watchUrl` 字段已存在，未实现复制/分享/二维码。

**实现方案：**

```mermaid
flowchart TD
    A[主播开始推流] --> B{推流模式}

    B -- WHIP/WebRTC --> C["WebRTC 拉流地址\nwebrtc://domain/live/streamId"]
    B -- RTMP --> D["RTMP 拉流 rtmp://domain/live/streamId\nHLS 拉流 https://domain/live/streamId.m3u8\nHTTP-FLV https://domain/live/streamId.flv"]

    C --> E[写入 roomStore.watchUrl]
    D --> E

    E --> F["TopBar 展示观看地址\n一键复制按钮"]
    E --> G["生成二维码\n供移动端扫码观看"]
```

**待开发工作：**
- 根据推流模式和地址规则自动生成对应拉流 URL
- TopBar 添加「复制链接」「生成二维码」按钮
- 支持多协议切换展示（WebRTC / HLS / FLV）

**估时：** 前端 1 天

---

### 5.3 聊天信令（Chat）

**现状**：`chatStore` 消息模型完整，`RightPanel` 聊天骨架已有，**信令收发尚未对接**。

**完整链路时序：**

```mermaid
sequenceDiagram
    participant 观众端
    participant 信令服务 as 信令服务器
    participant 主播端

    观众端->>信令服务: chat-send { roomId, content, nickname }
    信令服务->>信令服务: 存储消息并过滤敏感词
    信令服务->>主播端: chat-message { id, userId, nickname, content, ts }
    信令服务->>观众端: chat-message 广播给房间其他人

    主播端->>主播端: chatStore.addMessage(msg)
    Note over 主播端: RightPanel 消息列表更新

    主播端->>信令服务: chat-pin { messageId }
    信令服务->>观众端: chat-pinned { messageId } 广播

    主播端->>信令服务: chat-ban { userId }
    信令服务->>观众端: 该用户后续消息被拦截
```

**待开发工作：**

| 功能 | 优先级 | 估时 |
|------|--------|------|
| 消息收发对接 SignalService | P0 | 0.5 天 |
| 消息发送 UI（输入框 + Emoji） | P0 | 0.5 天 |
| 置顶消息 | P1 | 0.5 天 |
| 敏感词过滤（服务端） | P1 | 1 天 |
| 历史消息回放（加入时拉最近 50 条） | P2 | 1 天 |
| 消息撤回 | P2 | 0.5 天 |

**估时：** 前端 2 天 + 服务端 2 天

---

### 5.4 连麦（Co-Stream）

**现状**：`useCoStream.ts` WebRTC P2P 框架完整，信令处理齐全，**缺服务端信令转发和完整 UI 流程**。

**完整连麦时序（观众申请连麦）：**

```mermaid
sequenceDiagram
    participant 观众端
    participant 信令服务 as 信令服务器
    participant 主播端
    participant 合流器 as StreamMixer

    观众端->>信令服务: co-apply { userId, nickname }
    信令服务->>主播端: co-apply { userId, nickname }
    主播端->>主播端: coStreamStore.addApply()，UI 弹出申请通知

    主播端->>信令服务: accept-apply { userId }
    信令服务->>观众端: co-accepted

    观众端->>观众端: getUserMedia() 获取摄像头和麦克风
    主播端->>主播端: callPeer(userId)，createOffer()
    主播端->>信令服务: offer { to: userId, sdp }
    信令服务->>观众端: offer { from: hostId, sdp }

    观众端->>观众端: createAnswer()
    观众端->>信令服务: answer { to: hostId, sdp }
    信令服务->>主播端: answer { from: userId, sdp }
    主播端->>主播端: setRemoteDescription(answer)

    loop Trickle ICE
        主播端->>信令服务: ice { to: userId, candidate }
        信令服务->>观众端: ice { from: hostId, candidate }
        观众端->>信令服务: ice { to: hostId, candidate }
        信令服务->>主播端: ice { from: userId, candidate }
    end

    主播端->>主播端: ontrack 获取 remoteStream
    主播端->>合流器: 连麦视频进入宫格区域合流
    合流器->>合流器: 宫格布局更新（1/4/9 宫格自适应）
```

**连麦现状与卡点：**

```mermaid
flowchart TD
    subgraph 已完成
        A["useCoStream.ts\nWebRTC P2P 信令处理"]
        B["coStreamStore\n参与者状态管理"]
        C["StreamMixer\n连麦视频合流进推流画面"]
        D["申请/同意/踢出逻辑\ncallPeer / answerOffer / kick"]
    end

    subgraph 待开发
        E["信令服务端\noffer/answer/ice 转发\nco-apply 广播"]
        F["连麦 UI 完整流程\n申请弹窗 → 同意/拒绝 → 麦位展示"]
        G["麦位管理面板\n静音/踢出/布局切换"]
        H["TURN 穿透\n对称 NAT 场景需 TURN 中继"]
        I["连麦者端实现\n观众侧 H5 页面"]
    end

    已完成 --> E
    E --> F
    F --> G
```

---

## 六、整体剩余工作量评估

```mermaid
gantt
    title 推流模块剩余开发计划
    dateFormat  YYYY-MM-DD
    section 观看人数
    信令服务端（房间计数）     :a1, 2026-05-29, 1d
    前端对接 + TopBar 展示     :a2, after a1, 1d

    section 观看地址
    拉流 URL 生成逻辑          :b1, 2026-05-29, 1d
    复制 + 二维码 UI           :b2, after b1, 1d

    section 聊天信令
    信令服务端（消息转发）      :c1, 2026-06-02, 2d
    前端发送/接收对接           :c2, after c1, 1d
    置顶禁言功能                :c3, after c2, 1d

    section 连麦
    信令服务端（WebRTC 转发）   :d1, 2026-06-02, 2d
    连麦 UI 完整流程            :d2, after d1, 2d
    麦位管理面板                :d3, after d2, 2d
    观众端连麦页面              :d4, after d3, 3d
    STUN 国内服务器修复         :d5, 2026-06-02, 1d

    section 测试与联调
    推流全链路压测              :e1, 2026-06-13, 2d
    弱网模拟测试                :e2, after e1, 1d
```

---


