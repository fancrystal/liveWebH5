# H5 项目与 rtmp-relay 通信架构

> 编制日期：2026-05-21
> 适用范围：liveAssistantH5（前端）+ rtmp-relay（中转服务）

## 一、组件清单

| 组件 | 角色 | 部署形态 |
|------|------|----------|
| **liveAssistantH5** | Vue 3 单页应用，负责采集、合流、推流 | 本地 `npm run dev` / K8s 内 nginx Pod |
| **rtmp-relay** | Node.js 服务，把 WebSocket 收到的 WebM 数据通过 ffmpeg 管道转成 RTMP | 本地 `node server.js` / K8s 内 Deployment |
| **外网 RTMP 服务器** | 接收 RTMP 流的最终目的地（云直播 / SRS / 自建） | `rtmp://rtmp-push-huaxia-m.lxi-tech.com/live/<stream>?txSecret=...` |

## 二、数据流总览

```
┌──────────────┐    WS    ┌──────────────┐  pipe  ┌──────────┐  RTMP  ┌────────────┐
│  浏览器 H5   │ ───────► │  rtmp-relay  │ ─────► │  ffmpeg  │ ─────► │ 外网 RTMP  │
│ MediaRecorder│  WebM    │  (Node.js)   │ stdin  │  子进程  │  flv   │  推流服务  │
└──────────────┘ chunks   └──────────────┘        └──────────┘        └────────────┘
```

**前端始终发送 WebM 数据块** → **rtmp-relay 始终用 ffmpeg 转封装** → **永远推到同一个外网 RTMP 地址**。
**变的只是"浏览器到 rtmp-relay 中间这段链路"在不同环境下的连接方式。**

## 三、本地环境

### 拓扑

```
┌─────────────────────────────────────────────────┐
│  开发者本机                                       │
│                                                  │
│  ┌─────────────┐                                 │
│  │ 浏览器       │                                 │
│  │ http://      │                                 │
│  │ localhost:   │                                 │
│  │ 5173         │                                 │
│  └──────┬──────┘                                 │
│         │ WebSocket 直连                          │
│         │ ws://localhost:8080/rtmp-relay?rtmp=...│
│         ▼                                        │
│  ┌─────────────┐                                 │
│  │ rtmp-relay  │  node server.js                 │
│  │  :8080      │                                 │
│  └──────┬──────┘                                 │
│         │ spawn ffmpeg                            │
│         ▼                                        │
│  ┌─────────────┐                                 │
│  │  ffmpeg     │                                 │
│  └──────┬──────┘                                 │
└─────────┼────────────────────────────────────────┘
          │ TCP / RTMP（直连公网）
          ▼
   rtmp-push-huaxia-m.lxi-tech.com:1935
```

### 关键配置

- 前端 `.env`（开发环境）：
  ```
  VITE_RTMP_WS_URL=ws://localhost:8080/rtmp-relay
  ```
- rtmp-relay：`PORT=8080` 直接监听本机
- 浏览器从 `localhost:5173` 通过 Vite Dev Server 加载页面，WS 连接走 **同主机** 的 `localhost:8080`

### 特点

| 项 | 状态 |
|----|------|
| 网络路径 | 浏览器 → 本机回环 → 本机进程，**几乎零延迟、零丢包** |
| TCP 拥塞 | 本机回环不拥塞 |
| 出网瓶颈 | 直接走开发者本地宽带，通常稳定 |
| 流畅度 | 流畅，延迟 < 1s |

## 四、服务器环境（K8s）

### 拓扑

```
┌──────────┐
│ 主播浏览器│ https://<域名>
└────┬─────┘
     │ ① 加载页面 (HTTPS)
     │ ② WSS 连接 (wss://<域名>/rtmp-relay?rtmp=...)
     ▼
┌────────────────────────────────────────────────────────────────────┐
│  腾讯云 K8s 集群                                                     │
│                                                                     │
│  ┌──────────────┐                                                   │
│  │  Ingress /   │  HTTPS / WSS 入口（TLS 终止）                      │
│  │  LoadBalancer│                                                   │
│  └──────┬───────┘                                                   │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────┐    location /rtmp-relay {                          │
│  │ liveAssistant│      proxy_pass http://rtmp-relay:14118/rtmp-relay │
│  │ -h5 nginx Pod│      proxy_buffering off;                          │
│  │  (静态站)    │    }                                               │
│  └──────┬───────┘                                                   │
│         │ 集群内 ClusterIP                                           │
│         │ HTTP/WS Upgrade                                            │
│         ▼                                                            │
│  ┌──────────────┐  ClusterIP Service                                 │
│  │ Service:     │  port 14118 → targetPort 8080                      │
│  │ rtmp-relay   │                                                    │
│  │  :14118      │                                                    │
│  └──────┬───────┘                                                   │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────┐  Deployment (replicas: 1)                          │
│  │ rtmp-relay   │  image: qdd-ome.tencentcloudcr.com/qdd/            │
│  │ Pod :8080    │         rtmp-relay:latest                          │
│  │              │  node server.js → spawn ffmpeg                     │
│  └──────┬───────┘                                                   │
└─────────┼───────────────────────────────────────────────────────────┘
          │ ③ K8s Pod 出网 (NAT Gateway)
          │    ← ← ← 这一段是性能瓶颈 ← ← ←
          ▼
   rtmp-push-huaxia-m.lxi-tech.com:1935
```

### 关键配置

#### 4.1 前端 `.env.production`
```
VITE_RTMP_WS_URL=     # 留空 → 前端运行时自动拼接
```

前端代码逻辑（`src/composables/useRTMP.ts:27-28`）：
```js
const WS_ENDPOINT = import.meta.env.VITE_RTMP_WS_URL
  || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/rtmp-relay`
```

效果：
- 页面在 `https://<域名>/` 加载时，自动选 `wss://<域名>/rtmp-relay`
- 不需要硬编码服务端地址，避免 Mixed Content 错误

#### 4.2 前端 nginx 反向代理（`nginx.conf`）
```nginx
location /rtmp-relay {
    proxy_pass         http://rtmp-relay:14118/rtmp-relay;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade    $http_upgrade;
    proxy_set_header   Connection $connection_upgrade;
    proxy_read_timeout 3600s;

    # 实时流必须关闭 nginx 缓冲，否则 WebM 会被攒成块再转发
    proxy_buffering         off;
    proxy_request_buffering off;
    tcp_nodelay             on;
}
```

#### 4.3 rtmp-relay K8s Service（`k8s/deployment.yaml`）
```yaml
apiVersion: v1
kind: Service
metadata:
  name: rtmp-relay
spec:
  type: ClusterIP
  ports:
    - port: 14118        # 集群内对外暴露端口（nginx proxy_pass 写的）
      targetPort: 8080   # 容器内 node server.js 监听端口
```

### 完整链路（带协议标注）

```
主播浏览器
  │
  │ ① HTTPS GET https://<域名>/...
  │    取页面 / 静态资源
  ▼
Ingress (TLS 终止)
  │
  ▼
liveAssistant-h5 nginx Pod
  │ 返回 HTML / JS / CSS
  ▼
主播浏览器
  │
  │ ② WSS Upgrade
  │    wss://<域名>/rtmp-relay?rtmp=rtmp://...
  ▼
Ingress  ──►  nginx Pod  ──►  Service: rtmp-relay:14118  ──►  rtmp-relay Pod:8080
  (TLS)        (反向代理     (ClusterIP DNS)                  (node server.js)
               WS Upgrade)
  │
  │ ③ ffmpeg.stdin ← WebM chunks
  │    ffmpeg → RTMP (TCP)
  ▼
K8s Pod 出网（NAT Gateway / 公网 IP）
  │
  │ ④ rtmp://rtmp-push-huaxia-m.lxi-tech.com:1935/...
  ▼
外网 RTMP 推流服务器
  │
  ▼
观众端（HLS / FLV / RTMP 拉流）
```

## 五、本地 vs 服务器对照

| 维度 | 本地 | K8s 服务器 |
|------|------|------------|
| **WS 连接地址** | `ws://localhost:8080/rtmp-relay` | `wss://<域名>/rtmp-relay` |
| **是否经 TLS** | ❌ 明文 ws | ✅ wss（Ingress 终止 TLS） |
| **中间跳数** | 浏览器 → 进程 | 浏览器 → Ingress → nginx Pod → Service → rtmp-relay Pod |
| **DNS 解析** | localhost | 域名 → Ingress IP → ClusterIP → Pod IP |
| **rtmp-relay 端口** | 主机 8080 | Pod 8080，Service 14118 |
| **环境变量** | `VITE_RTMP_WS_URL=ws://localhost:8080/rtmp-relay` | `VITE_RTMP_WS_URL=`（前端运行时自动拼） |
| **ffmpeg 出网路径** | 开发者本地宽带 | K8s Pod NAT Gateway |
| **性能表现** | 流畅，延迟 < 1s | **流畅几秒 → 卡顿几秒**，循环 |
| **核心瓶颈** | 无 | Pod 出网到外网 RTMP 服务器的带宽 / 稳定性 |

## 六、消息时序（推流一次完整流程）

```
浏览器                  nginx Pod              rtmp-relay Pod          外网 RTMP
  │                        │                       │                       │
  │ GET /                  │                       │                       │
  ├───────────────────────►│                       │                       │
  │◄─── 200 (index.html) ──┤                       │                       │
  │                        │                       │                       │
  │ JS 启动，用户点"开始推流"                                                │
  │                        │                       │                       │
  │ WSS Upgrade            │                       │                       │
  │ /rtmp-relay?rtmp=...   │                       │                       │
  ├───────────────────────►│ HTTP Upgrade          │                       │
  │                        ├──────────────────────►│                       │
  │                        │                       │ 解析 rtmp= 参数        │
  │                        │                       │ spawn ffmpeg          │
  │                        │                       ├──────────────────────►│
  │                        │                       │   TCP connect / RTMP  │
  │                        │                       │   handshake           │
  │                        │                       │◄──────────────────────┤
  │◄─── 101 Switching ─────┤◄──────────────────────┤                       │
  │                        │                       │                       │
  │ MediaRecorder.start(100)                                                │
  │ ondataavailable 每 100ms 推一个 WebM chunk                              │
  │                                                                         │
  │ socket.send(chunk)     │                       │                       │
  ├───────────────────────►│                       │                       │
  │                        ├──────────────────────►│                       │
  │                        │                       │ ws.on('message')      │
  │                        │                       │ ffmpeg.stdin.write()  │
  │                        │                       │   if false:           │
  │                        │                       │     ws.pause()        │
  │                        │                       │                       │
  │                        │                       │ ffmpeg ─ flv ────────►│
  │                        │                       │                       │
  │ (循环每 100ms)                                                          │
  │                                                                         │
  │ 用户点"停止推流"                                                          │
  │ socket.close()         │                       │                       │
  ├───────────────────────►│ close                 │                       │
  │                        ├──────────────────────►│ ffmpeg.stdin.end()    │
  │                        │                       ├──────────────────────►│
  │                        │                       │   FIN                 │
```

## 七、关键容错与反压

| 层 | 机制 | 位置 |
|----|------|------|
| 浏览器 → nginx | 自动重连（最多 4 次，指数退避 3s/6s/12s/24s） | `useRTMP.ts:172-192` |
| 浏览器内部 | MediaRecorder 每 30 分钟无缝重启，避免 WebM 时间戳累积导致 Opus 解码失败 | `useRTMP.ts:110-118` |
| nginx | 关闭 `proxy_buffering` / `proxy_request_buffering`，保证实时流不被攒包 | `nginx.conf:30-32` |
| nginx | `proxy_read_timeout 3600s`，避免长连接被断 | `nginx.conf:25-26` |
| rtmp-relay | `ffmpeg.stdin.write()` 返回 false 时 `ws.pause()`，TCP 反压 | `server.js` |
| ffmpeg | `-fflags +genpts` 补齐缺失 PTS，避免时间戳乱序 | `server.js` |

## 八、当前已知瓶颈

数据流向图中的 **③ K8s Pod 出网到外网 RTMP 服务器** 是当前生产卡顿的根因。

详见 [rtmp-stutter-analysis.md](rtmp-stutter-analysis.md)。

## 九、可选演进方向

| 方向 | 是否还需要 rtmp-relay | 是否还经过 K8s | 备注 |
|------|----------------------|----------------|------|
| 现状（RTMP via rtmp-relay） | 是 | 是 | 当前瓶颈在 Pod 出网 |
| WHIP + 外部 SRS / 云直播 | **否** | **否**（前端如果也走 CDN） | 浏览器直连外部 WebRTC 服务，绕开 K8s |
| rtmp-relay 独立部署到公网 ECS | 是 | 否 | 保留 RTMP 链路但绕开 K8s 出网 |
| WHIP + 自建 SRS in K8s | 是（SRS） | 是 | 协议换了，但出网瓶颈仍在 K8s |

---

**总结**：
- 本地链路极短，几乎是同进程通信，所以流畅。
- 服务器链路长且经过 K8s NAT 出网，**最后一跳（Pod → 外网 RTMP）是当前性能瓶颈**。
- 前端 / nginx / rtmp-relay 三者的代码侧已经做了实时流应有的反压、不缓冲、PTS 修复等优化，进一步优化空间不大。
- 真正的解法在网络层（升带宽 / 换部署位置）或协议层（切 WHIP 绕开自建中转）。
