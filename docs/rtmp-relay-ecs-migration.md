# rtmp-relay 迁移到独立 ECS 部署方案

> 编制日期：2026-05-22
> 目标：把 rtmp-relay 从 K8s 集群迁出，部署到独享带宽的公网 ECS，绕开 K8s NAT 出网瓶颈

## 一、为什么选这个方案

### 约束条件
- 必须推到**固定的外网 RTMP 地址**（`rtmp-push-huaxia-m.lxi-tech.com`）
- 不能换 WHIP 或其他协议（推流目的地不变）
- 改动越小越好，代码不动

### 收益
| 维度 | 现状（K8s） | 迁移后（独立 ECS） |
|------|------------|---------------------|
| 出网路径 | Pod → NAT 网关（共享） | 独立公网网卡 |
| 带宽保证 | 不确定，受集群整体争抢 | 可固定 5M / 10M 独享 |
| 故障隔离 | 影响集群其他流量 | 仅影响推流 |
| 成本 | NAT 网关流量费 | 一台轻量 ECS ≈ 50 元/月 |
| 代码改动 | - | 零改动 |
| 配置改动 | - | 仅前端 `VITE_RTMP_WS_URL` 一行 |

## 二、目标架构

```
┌──────────────────────────┐
│  主播浏览器              │
│  https://<h5 域名>/      │
└──────┬───────────────────┘
       │ ① HTTPS 加载页面
       ▼
┌──────────────────────────┐
│  H5 静态站（K8s nginx Pod）│
│  仅托管 SPA 静态文件      │
└──────┬───────────────────┘
       │ 返回 index.html / JS
       ▼
┌──────────────────────────┐
│  主播浏览器              │
│  执行 JS                │
└──────┬───────────────────┘
       │ ② WSS 直连 ECS（不再经过 K8s）
       │ wss://relay.<域名>/rtmp-relay?rtmp=...
       ▼
┌──────────────────────────┐
│  独立公网 ECS            │
│  ┌────────────────────┐  │
│  │ caddy / nginx      │  │  TLS 终止 + WS 反向代理
│  │ :443               │  │
│  └─────────┬──────────┘  │
│            │ ws://localhost:8080
│            ▼              │
│  ┌────────────────────┐  │
│  │ rtmp-relay 容器     │  │
│  │ node server.js     │  │
│  │ :8080              │  │
│  └─────────┬──────────┘  │
│            │ spawn ffmpeg │
│            ▼              │
│  ┌────────────────────┐  │
│  │ ffmpeg             │  │
│  └─────────┬──────────┘  │
└────────────┼─────────────┘
             │ ③ RTMP（独享公网带宽）
             ▼
   rtmp-push-huaxia-m.lxi-tech.com:1935
```

## 三、ECS 选型

### 厂商和区域
- **首选**：腾讯云，**与 RTMP 服务器同区域**
  - `rtmp-push-huaxia-m.lxi-tech.com` 域名带 "huaxia"，应该是华东/华南节点 → ECS 选**广州 / 上海 / 南京**
- **次选**：阿里云、华为云（同区域原则）

### 规格
- **轻量应用服务器** 2核 2GB / 4Mbps 起步
- 推流 1 路约 2Mbps → 4Mbps 带宽足够
- 多路推流时升级：5M / 10M / 按量计费

### 推荐配置
```
腾讯云轻量应用服务器
- 地域：上海 / 广州（看 RTMP 服务器 ping 值）
- 规格：2C 2G 60GB SSD
- 带宽：5Mbps 独享
- 操作系统：Ubuntu 22.04 LTS
- 价格：约 50-80 元/月
```

## 四、部署步骤

### 4.1 准备 ECS 环境

```bash
# 1. SSH 登录 ECS
ssh ubuntu@<ECS 公网 IP>

# 2. 安装 Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# 3. 验证
docker --version
```

### 4.2 拉取并运行 rtmp-relay 镜像

```bash
# 1. 登录腾讯云容器镜像服务（如果镜像非公开）
docker login qdd-ome.tencentcloudcr.com -u <用户名>

# 2. 拉取镜像
docker pull qdd-ome.tencentcloudcr.com/qdd/rtmp-relay:latest

# 3. 运行容器
docker run -d \
  --name rtmp-relay \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -e PORT=8080 \
  -e FFMPEG_PATH=ffmpeg \
  qdd-ome.tencentcloudcr.com/qdd/rtmp-relay:latest

# 4. 验证
docker logs -f rtmp-relay
# 应看到：[relay] listening on ws://0.0.0.0:8080/rtmp-relay

# 5. 本地测试
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  http://127.0.0.1:8080/rtmp-relay
# 应返回 101 Switching Protocols
```

**注意**：`-p 127.0.0.1:8080:8080` 只绑定本地回环，让 caddy/nginx 反向代理后再对外，避免 8080 直接暴露公网。

### 4.3 域名与 TLS 证书

由于 H5 页面是 HTTPS，浏览器必须用 WSS 连接 relay，否则会触发 Mixed Content 阻塞。

#### 方案：用 Caddy 自动签发证书（推荐，最简单）

```bash
# 1. 安装 Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# 2. 配置 Caddyfile
sudo tee /etc/caddy/Caddyfile <<'EOF'
relay.example.com {
    # 关闭缓冲，保证实时流不被攒包
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
        transport http {
            keepalive 3600s
            response_header_timeout 3600s
        }
    }

    # CORS（如果前端跨域加载）
    header Access-Control-Allow-Origin *
    header Access-Control-Allow-Methods "GET, POST, OPTIONS"
}
EOF

# 3. 把 relay.example.com 改成你的真实域名（先在 DNS 解析 A 记录到 ECS 公网 IP）

# 4. 重启
sudo systemctl restart caddy
sudo systemctl enable caddy

# 5. 验证证书已自动签发
curl -I https://relay.example.com
```

Caddy 会自动通过 Let's Encrypt 申请证书并定期续期，**零运维成本**。

#### 备选：用 nginx + certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/rtmp-relay <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name relay.example.com;

    location /rtmp-relay {
        proxy_pass         http://127.0.0.1:8080/rtmp-relay;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host       $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;

        proxy_buffering         off;
        proxy_request_buffering off;
        tcp_nodelay             on;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/rtmp-relay /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 签发证书（会自动改 nginx 配置为 443）
sudo certbot --nginx -d relay.example.com
```

### 4.4 ECS 安全组

放行端口：
- `22`（SSH）
- `80`（HTTP，证书签发用）
- `443`（HTTPS / WSS）

**不要**对外开放 `8080`（已绑定本机）。

### 4.5 修改前端配置

只需改一行环境变量：

**修改 `.env.production`：**
```diff
- VITE_RTMP_WS_URL=
+ VITE_RTMP_WS_URL=wss://relay.example.com/rtmp-relay
```

**前端代码无需改动**，[useRTMP.ts:27-28](src/composables/useRTMP.ts) 已经支持环境变量优先：
```ts
const WS_ENDPOINT = import.meta.env.VITE_RTMP_WS_URL
  || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/rtmp-relay`
```

### 4.6 重新构建并部署 H5

```bash
# 本地
npm run build
# 把 dist/ 上传到 K8s nginx Pod，或重新打镜像部署
```

### 4.7 下线 K8s 内的 rtmp-relay（验证稳定后）

```bash
# 等新方案稳定 1-2 天后
kubectl delete -f k8s/deployment.yaml

# 同时清理前端 nginx.conf 里的 /rtmp-relay location 块（可选，留着也无害）
```

## 五、灰度切换策略

避免直接全量切换出问题：

### 阶段 1：双轨并行（1-2 天）
- ECS 上的 rtmp-relay 跑起来，但前端配置**先不改**
- 手动测试 ECS 链路：用 `wscat` 或临时改本地 `.env` 验证可用
- 同步对比 ECS 和 K8s 两个 relay 的日志

### 阶段 2：灰度切换（半天）
- 临时给少数主播一个测试入口（`?relay=ecs`）
- 通过前端运行时判断切换 WS 地址
- 监控 `wsBuffered`、卡顿反馈

### 阶段 3：全量切换
- 改 `.env.production` 全量切到 ECS
- K8s rtmp-relay 保留 1 周作为回滚备份

### 阶段 4：下线 K8s rtmp-relay
- 删除 Deployment / Service
- 清理 nginx.conf

## 六、运维要点

### 监控
- **基础**：ECS 控制台看 CPU / 内存 / 出网带宽曲线
- **业务**：rtmp-relay 自身的 `[relay]` 日志（连接数、ffmpeg 异常）
- **告警**：出网带宽达 80% → 升级套餐

### 日志收集
```bash
# 实时看
docker logs -f rtmp-relay

# 持久化（避免容器重启丢日志）
docker run -d \
  --name rtmp-relay \
  --restart unless-stopped \
  --log-driver json-file \
  --log-opt max-size=100m \
  --log-opt max-file=5 \
  -p 127.0.0.1:8080:8080 \
  qdd-ome.tencentcloudcr.com/qdd/rtmp-relay:latest
```

### 高可用
- 单台 ECS 是单点。如果业务关键：
  - 买 2 台 ECS，前面挂个 SLB（腾讯云负载均衡）
  - WS 协议下 SLB 选**最小连接数**或**源 IP hash**

### 升级 / 部署
```bash
# 拉新镜像
docker pull qdd-ome.tencentcloudcr.com/qdd/rtmp-relay:latest

# 重启容器
docker stop rtmp-relay && docker rm rtmp-relay
docker run -d --name rtmp-relay ...（同上）
```

或写个 `update.sh` 脚本：
```bash
#!/bin/bash
docker pull qdd-ome.tencentcloudcr.com/qdd/rtmp-relay:latest
docker stop rtmp-relay && docker rm rtmp-relay
docker run -d \
  --name rtmp-relay \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  qdd-ome.tencentcloudcr.com/qdd/rtmp-relay:latest
docker logs --tail 20 rtmp-relay
```

## 七、回滚方案

如果切换后发现问题：

1. **立即回滚（< 5 分钟）**
   - 改 `.env.production` 把 `VITE_RTMP_WS_URL=` 改回空
   - 重新构建并部署 H5
   - 前端自动用回 K8s 内的 rtmp-relay

2. **不需要重新构建的快速回滚**
   - 前端可以加运行时配置（如读 `window.__RTMP_WS_URL__` 或后端 API），运维即时改

## 八、成本估算

| 项目 | 单价 | 说明 |
|------|------|------|
| 腾讯云轻量 2C2G 5Mbps | ≈ 60 元/月 | 上海 / 广州 |
| 域名（如果新买） | ≈ 60 元/年 | 可复用现有域名加子域 |
| TLS 证书 | 0 | Let's Encrypt 自动签发 |
| **合计** | **≈ 60-80 元/月** | |

对比 K8s 现状的隐性成本：
- NAT 网关流量费（按 GB 计）
- 卡顿影响主播留存
- 排查问题的人力

## 九、验证清单

部署完成后逐项验证：

- [ ] `docker ps` 看到 rtmp-relay 容器 running
- [ ] `docker logs rtmp-relay` 看到 listening on 8080
- [ ] ECS 上 `curl -I https://relay.example.com` 返回 200 / 301
- [ ] 浏览器开 H5 页面，开始推流，控制台看到 `[RTMP] WS open`
- [ ] `wsBuffered` 长时间稳定（不持续上涨）
- [ ] 观众端拉流流畅，无周期性卡顿
- [ ] 连续推流 30 分钟 → 1 小时无中断
- [ ] ECS 出网带宽曲线稳定在预期值（约 2-3Mbps）
- [ ] ECS CPU 使用率 < 30%

## 十、相关文档

- [架构总览](architecture-rtmp-flow.md)
- [卡顿问题分析](rtmp-stutter-analysis.md)
- [生产部署说明](deployment.md)

---

**核心思路**：让 rtmp-relay 拥有独享、可控、可监控的公网出口，是当前问题最直接、最经济的解法。
