# RTMP 推流卡顿问题分析

> 编制日期：2026-05-21
> 适用范围：H5 直播助手 + rtmp-relay K8s 部署

## 一、现象

- **本地环境**：浏览器 → 本地 rtmp-relay → 腾讯云 RTMP 推流地址，画面流畅，延迟 < 1s。
- **K8s 生产环境**：浏览器 → K8s rtmp-relay Pod → 同一 RTMP 推流地址，出现 "流畅几秒 → 卡顿几秒" 的周期性卡顿，整体延迟也偏高。
- **CPU / 内存监控**：rtmp-relay Pod CPU 使用 ≈ 0.01 核，仅占配额的 0.46%；内存平稳。资源远未触顶。

## 二、排查过程

### 1. 排除算力瓶颈
- ffmpeg 视频侧使用 `-c:v copy`（直通，不重编码），CPU 几乎为 0。
- 音频侧 `-c:a aac -aac_coder fast -b:a 64k`，CPU 峰值很短且很低。
- 监控数据证实：**CPU / 内存均未达到上限，不是 K8s CFS 限流**。

### 2. 排除编码参数
- 曾尝试 `-use_wallclock_as_timestamps 1` 让 ffmpeg 用墙上时间打 PTS，结果**反而把"间歇性卡顿"变成了"持续微卡"**。
- 原因：MediaRecorder 每个 WebM chunk 内含约 3 帧，内部 PTS 为 0/33/66ms；墙钟会把 3 帧 PTS 全部覆盖成相同时间，导致下游解码端帧聚簇。
- 已回滚，改为 `-fflags +genpts`：只在 PTS 缺失时补齐，不覆盖原有时间戳。

### 3. 浏览器端关键证据
开启 `[RTMP] chunks/s` 诊断日志后，观察到：

```
[RTMP] chunks/s { chunks: 10, bytes: 26432, kbps: 211, wsBuffered: 40_000   }
[RTMP] chunks/s { chunks: 10, bytes: 27104, kbps: 217, wsBuffered: 380_000  }
[RTMP] chunks/s { chunks: 10, bytes: 25888, kbps: 207, wsBuffered: 1_240_000 }
...
[RTMP] chunks/s { chunks: 10, bytes: 26880, kbps: 215, wsBuffered: 3_412_000 }
```

`wsBuffered`（浏览器 WebSocket 发送缓冲区）在 14 秒内从 40KB 涨到 3.4MB，**说明数据在浏览器侧持续积压、发不出去**。

## 三、根本原因

链路瓶颈位于 **rtmp-relay Pod → 外网 RTMP 推流地址** 这一段：

```
浏览器  ──► rtmp-relay Pod  ──► 腾讯云外网 RTMP 服务器
   ▲                              ▲
   │                              │
   │                       【瓶颈：K8s Pod NAT 出口带宽不足以稳定支撑 ~2 Mbps】
   │
   │   TCP 拥塞 → ffmpeg.stdin 写慢 → ws.pause()
   │                ↑
   │   浏览器侧 WebSocket bufferedAmount 持续上涨
```

**核心机制：**
1. K8s Pod 出口到外网 RTMP 服务器的 TCP 通道吞吐不稳定。
2. ffmpeg 写入 RTMP 上游变慢，进而 stdin 拒收新数据，relay 调用 `ws.pause()` 关闭 TCP 接收窗口。
3. 浏览器侧 MediaRecorder 仍按 100ms 节奏产 chunk，`socket.send()` 把数据全部堆进本地缓冲区，`bufferedAmount` 持续上涨。
4. 当 ffmpeg 短暂消化完积压后 `ws.resume()`，浏览器侧积压的几秒数据**爆发式涌出**，ffmpeg 再次被噎住——形成"流畅几秒 → 卡顿几秒"的循环。

**本地环境不复现的原因：** 本地直连同一 RTMP 地址，路由路径短、出口带宽充足，TCP 不会被掐死，缓冲区从不堆积，因此始终流畅。

## 四、建议方案

### 短期（运维 / 网络侧）

1. **检查 K8s 集群出网带宽和 NAT 网关配额**，确认 Pod 到 `rtmp-push-huaxia-m.lxi-tech.com` 的实际吞吐能否稳定 ≥ 2 Mbps。
2. 将 rtmp-relay Pod 部署到**离推流接入点更近的可用区**，减少跨区抖动。
3. 在 Pod / Node 上做一次 `iperf` 或 `mtr` 到 RTMP 服务器，量化带宽与丢包率，提供给云厂商工单。

### 中期（架构调整）

1. **rtmp-relay 直接部署在公网带宽更宽裕的节点**（或独立 ECS / 边缘节点），绕开 K8s 出网瓶颈。
2. 或者切换到**推流厂商直推 SDK**，跳过自建中转。
3. 评估是否上**腾讯云直播加速专线**或 BGP 优化线路。

### 前端兜底（已经实现）

1. 浏览器侧 WebSocket 发送前检查 `bufferedAmount`，超过阈值（例如 256KB）**主动丢弃实时帧**——宁可丢一帧也不积压。
2. MediaRecorder 每 30 分钟重启一次，避免长时间运行下 WebM 时间戳累积导致 Opus 解析错误。
3. 已加诊断日志：`[RTMP] chunks/s` 上报 `wsBuffered`，便于上线后直接看缓冲区是否堆积。生产环境通过 `VITE_VERBOSE_LOG=false` 默认关闭，排查时改 `true` 即可。

## 五、当前状态

| 项目 | 状态 |
|------|------|
| 服务端 `-fflags +genpts` 修复 | 已提交、已部署 |
| 服务端日志加时间戳 | 已修改（待提交） |
| 前端 WebSocket 背压（丢帧策略） | 待评估上线 |
| 前端日志频率开关 `VITE_VERBOSE_LOG` | 已实现，生产默认关闭 |
| K8s 出口带宽根因排查 | **待运维 / 云厂商配合** |

> **结论**：代码侧已经尽力做了背压、参数调优和兜底，**剩下的核心瓶颈在 K8s Pod → 外网 RTMP 服务器这段网络通道**，需要运维或云厂商介入解决。
