# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目简介

H5 网页端直播推流助手，支持 WebRTC（WHIP 协议）和 RTMP（MediaRecorder + WebSocket 中转）双推流模式，集成白板教学、聊天互动、连麦、互动工具等功能。详细产品方案见 `docs/product-design.md`。

## 技术栈

- **框架**：Vue 3 + TypeScript + Vite 5
- **状态管理**：Pinia
- **样式**：TailwindCSS + SCSS
- **白板**：Fabric.js
- **实时通信**：socket.io-client（信令/聊天）
- **文档渲染**：pdfjs-dist

## 常用命令

项目尚未初始化，初始化后常用命令为：

```bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器
npm run build        # 生产构建
npm run preview      # 预览构建产物
npm run lint         # ESLint 检查
npm run type-check   # TypeScript 类型检查
```

## 架构概览

### 推流核心链路

所有媒体源（白板 Canvas、摄像头 `<video>`、屏幕共享）通过 **StreamMixer** 合流到一个 offscreen canvas，再由 `canvas.captureStream(30)` 生成视频轨道，混合麦克风音频后得到完整 `MediaStream`：

```
白板Canvas + 摄像头Video + 屏幕共享
         ↓ (requestAnimationFrame 逐帧绘制)
      offscreen canvas
         ↓ captureStream(30)
      MediaStream (视频 + 音频)
         ↓
  WebRTC(WHIP) 或 RTMP(WebSocket→ffmpeg)
```

### 推流模式

- **WebRTC**：使用 WHIP 协议，`POST SDP offer` 到 SRS 服务器，建立 ICE 连接推流，延迟 < 1s
- **RTMP**：`MediaRecorder` 产出 WebM 数据块，通过 WebSocket 发送到中转服务，服务端 ffmpeg 管道转为 RTMP flv 格式

### 连麦信令

通过 socket.io 信令服务器中转 WebRTC offer/answer/ICE，支持最多 9 路连麦。连麦视频同样通过 StreamMixer 合流进推流画面，布局规则见 `docs/product-design.md` 第 5.3 节。

### 目录规划

```
src/
├── components/        # UI 组件（layout / whiteboard / chat / costream / tools）
├── composables/       # 业务逻辑 hooks（useWebRTC / useRTMP / useStreamMixer 等）
├── stores/            # Pinia 状态（stream / media / whiteboard / chat / costream / room）
├── services/          # 服务层（SignalService / WHIPService / RTMPService）
├── types/             # TypeScript 类型定义
└── utils/             # 工具函数（canvas / media / format）
```

核心业务逻辑放在 `composables/`，组件只做展示和事件分发，不直接操作 WebRTC/MediaRecorder。
