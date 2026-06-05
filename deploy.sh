#!/bin/bash

set -e

# =================== 配置 ===================
GIT_REPO="https://git.code.tencent.com/lxi-tech/liveAssistantH5.git"
BRANCH="master"
SERVER_IP="172.21.0.15"       # 服务器 IP（用于 SRS WebRTC ICE）
PROJECT_DIR="./live-assistant"

echo "======================================"
echo " 直播助手 H5 部署脚本"
echo " 服务器 IP: $SERVER_IP"
echo " 分支: $BRANCH"
echo "======================================"

# =================== 1. 清理旧代码 ===================
echo "[1/6] 清理旧代码..."
rm -rf $PROJECT_DIR
mkdir -p $PROJECT_DIR

# =================== 2. 拉取代码 ===================
echo "[2/6] 克隆代码..."
git clone $GIT_REPO $PROJECT_DIR
cd $PROJECT_DIR
git checkout $BRANCH
echo "代码拉取成功，当前分支: $(git branch --show-current)"

# =================== 3. 安装 Node.js ===================
echo "[3/6] 检查 Node.js..."
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  \. "$NVM_DIR/nvm.sh"
fi

if ! command -v nvm &> /dev/null; then
  echo "安装 NVM..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  \. "$NVM_DIR/nvm.sh"
fi

nvm use 20 || nvm install 20
echo "Node: $(node -v) | npm: $(npm -v)"

# =================== 4. 构建前端 ===================
echo "[4/6] 安装依赖并构建..."
npm install --prefer-offline --no-audit --progress=false
npm run build

[ ! -d "dist" ] && { echo "构建失败：dist 目录未生成"; exit 1; }
echo "构建成功"

# =================== 5. 生成 docker-compose.yml ===================
echo "[5/6] 生成服务配置..."
cat > docker-compose.yml << EOF
version: '3.8'

services:
  srs:
    image: registry.cn-hangzhou.aliyuncs.com/ossrs/srs:5
    container_name: live-srs
    restart: unless-stopped
    environment:
      - CANDIDATE=${SERVER_IP}
      - SRS_DAEMON=off
      - SRS_IN_DOCKER=on
    ports:
      - "1935:1935"
      - "1985:1985"
      - "8000:8000/udp"
      - "8081:8080"

  nginx:
    image: nginx:alpine
    container_name: live-nginx
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./dist:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - srs
EOF

# =================== 6. 生成 nginx.conf ===================
cat > nginx.conf << 'EOF'
server_tokens off;
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;

    location / {
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|gif|ico|svg|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # ES module worker files (.mjs) — nginx:alpine mime.types does not include
    # .mjs by default, which causes browsers to reject them as module scripts.
    location ~* \.mjs$ {
        types { }
        default_type application/javascript;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
    add_header Access-Control-Allow-Headers "Content-Type";
}
EOF

# =================== 7. 启动服务 ===================
echo "[6/6] 启动服务..."
docker compose down 2>/dev/null || true
docker compose up -d

echo ""
echo "======================================"
echo " 部署完成！"
echo "======================================"
echo " 前端页面:    http://${SERVER_IP}"
echo " SRS 控制台:  http://${SERVER_IP}:8081/console"
echo " WHIP 推流:   http://${SERVER_IP}:1985/rtc/v1/whip/?app=live&stream=test"
echo " RTMP 拉流:   rtmp://${SERVER_IP}/live/test"
echo " HLS  拉流:   http://${SERVER_IP}:8081/live/test.m3u8"
echo "======================================"
