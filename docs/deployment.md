# 部署指南

## 架构概览

```
浏览器（主播/观众）
      │
      ▼
┌─────────────────────────────┐
│        172.21.0.15          │
│                             │
│  ┌──────────┐  ┌─────────┐ │
│  │  nginx   │  │   SRS   │ │
│  │  :80     │  │ :1935   │ │
│  │ (前端)   │  │ :1985   │ │
│  └──────────┘  │ :8000   │ │
│                └─────────┘ │
└─────────────────────────────┘
```

- **nginx**：提供前端静态文件（Vue3 构建产物）
- **SRS 5**：WebRTC (WHIP) 推流 + RTMP 分发

---

## 环境要求

| 工具 | 最低版本 | 用途 |
|------|---------|------|
| Docker | 20+ | 运行 SRS 和 nginx |
| Docker Compose | v2 | 编排容器 |
| Node.js | 18+ | 构建前端 |
| Git | 任意 | 拉取代码 |

---

## 首次部署

### 1. 登录服务器

浏览器打开 Web 终端：
```
http://172.21.0.15/ssh
账号：yangfan
```

### 2. 检查环境

```bash
docker --version
docker compose version
git --version
node --version
```

如果缺少 Node.js，执行：
```bash
# 使用 nvm 安装（推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

如果缺少 Docker，执行：
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### 3. 克隆项目

```bash
cd ~
git clone https://git.code.tencent.com/lxi-tech/liveAssistantH5.git
cd liveAssistantH5
```

> 输入腾讯 Git 账号密码完成克隆。

### 4. 构建前端

```bash
npm install
npm run build
```

构建产物输出到 `dist/` 目录。

### 5. 启动服务

```bash
docker compose up -d
```

容器启动成功后输出：
```
✔ Container live-srs    Started
✔ Container live-nginx  Started
```

### 6. 验证部署

| 验证项 | 地址 |
|--------|------|
| 前端页面 | http://172.21.0.15 |
| SRS API | http://172.21.0.15:1985/api/v1/versions |
| SRS 控制台 | http://172.21.0.15:8081/console |

---

## 推流 / 拉流地址

| 协议 | 地址 |
|------|------|
| WHIP 推流 | `http://172.21.0.15:1985/rtc/v1/whip/?app=live&stream=test` |
| RTMP 拉流 | `rtmp://172.21.0.15/live/test` |
| HTTP-FLV 拉流 | `http://172.21.0.15:8081/live/test.flv` |
| HLS 拉流 | `http://172.21.0.15:8081/live/test.m3u8` |

> 前端推流地址在"直播设置"里填写 WHIP 地址。

---

## 更新部署

代码有更新时，在服务器上执行：

```bash
cd ~/liveAssistantH5

# 拉取最新代码
git pull

# 重新构建前端
npm install
npm run build

# 重启 nginx（SRS 不需要重启）
docker compose restart nginx
```

---

## 常用运维命令

```bash
# 查看运行状态
docker compose ps

# 查看 SRS 日志
docker compose logs -f srs

# 查看 nginx 日志
docker compose logs -f nginx

# 停止所有服务
docker compose down

# 完全重启
docker compose down && docker compose up -d
```

---

## 故障排查

### 推流失败 / WHIP 连接超时
1. 确认 SRS 容器正在运行：`docker compose ps`
2. 检查 CANDIDATE IP 是否正确（应为 `172.21.0.15`）：
   ```bash
   docker compose logs srs | grep CANDIDATE
   ```
3. 确认防火墙开放端口 1985（TCP）和 8000（UDP）

### 前端打不开（502 / 404）
```bash
# 确认 dist 目录存在
ls ~/liveAssistantH5/dist/index.html

# 重启 nginx
docker compose restart nginx
```

### WebRTC 画面黑屏
- 推流端使用 Chrome 浏览器（推荐）
- 确认摄像头/麦克风权限已授予
- 检查 WHIP URL 是否带 `?app=live&stream=xxx` 参数

---

## 环境变量说明

生产环境配置文件：`.env.production`

| 变量 | 说明 | 生产值 |
|------|------|--------|
| `VITE_SASS_URL` | SaaS 接口基地址（鉴权换取 + 云盘业务共用） | `https://qdd-test.lxi-tech.com:15816` |
| `VITE_SIGNAL_URL` | 信令服务器地址（socket.io），留空则跳过连接 | 留空 |
| `VITE_RTMP_WS_URL` | RTMP 中转 WebSocket，留空则按当前域名自动拼接 | 留空 |
| `VITE_WHIP_URL` | 默认 WHIP 推流地址兜底（服务端下发 `pushStreamUrl` 时不使用） | 留空 |
| `VITE_VERBOSE_LOG` | 详细诊断日志开关，正式上线应改回 `false` | `true`（当前部署于测试环境） |

> **推流地址来源**：主播经管理门户「网页开播」进入时，H5 用一次性 `code` 换取 token 时会一并拿到该房间的 WHIP 推流地址 `pushStreamUrl`，自动填入推流设置。`VITE_WHIP_URL` 仅作为未下发时的兜底。详见 [auth-and-portal-entry-flow.md](auth-and-portal-entry-flow.md)。

修改后需要重新执行 `npm run build` 并重启 nginx。
