#!/bin/bash

set -e

# =================== 参数 ===================
if [ $# -ne 3 ]; then
  echo "用法: $0 <Git HTTPS 或 SSH 地址> <分支名称> <Tag 标识>"
  echo "示例: $0 git@git.code.tencent.com:lxi-tech/liveAssistantH5.git master v1.0"
  exit 1
fi

# ⚠️ 生产环境：部署前确认 .env.production 中 VITE_SASS_URL / VITE_IM_BASE_URL 已填写生产地址
TCR_USERNAME="100043284329"
TCR_PASSWORD="eyJhbGciOiJSUzI1NiIsImtpZCI6IkJYN0U6VDNZUToyUVVEOllUTkM6VDc0UTpWVkZUOkVNVkM6UVBZUDo0RzdLOlNWUlo6RFBDQTpNQzVXIn0.eyJvd25lclVpbiI6IjEwMDA0MzI4NDMyOSIsIm9wZXJhdG9yVWluIjoiMTAwMDQzMjg0MzI5IiwidG9rZW5JZCI6ImQyZzNuanI4a2Nna3EyN3A0aDMwIiwiZXhwIjoyMDcwNjkxNTM1LCJuYmYiOjE3NTUzMzE1MzUsImlhdCI6MTc1NTMzMTUzNX0.mHajPcV7evXOTlepPXdKFKEDB4vDXUxt9eSXIOerlTSwsqcRAVD32JufYHxD25Qr6JFYMII6tJwjRYHfuQ7dMztNGWmSTPAjM30WXrtMsIMYmgz-AfGZ5FDwgBQ-iuJlHWsfw038b5Uuby7nYKWkz5oxhWx_hzYcSPj0ZAPf7H2FZAds4YnvTMo7fHkTH87GvPGFQUSUKDgN2vGzbchKjDnjxvfCfGLUFyjS8oYCh1RQVjvgyOWXWyhK3A4BahTQ73gH6GdKy0FIxndZlW-3W3iT7Pq7HOfVkQXEAIjoR2saa3EJf5-d84DltYfUlBKEA-ZkwPktTSkqqNtYB3NWXg"
REGISTRY="qdd-ome.tencentcloudcr.com/qdd"
IMAGE_NAME="live-assistant-h5"
GIT_REPO=$1
BRANCH=$2
TAG=$3

FULL_IMAGE_NAME="${REGISTRY}/${IMAGE_NAME}:${TAG}-$(date +%Y%m%d-%H%M%S)"
LATEST_IMAGE_NAME="${REGISTRY}/${IMAGE_NAME}:latest"

echo "=============================================="
echo "  生产环境构建"
echo "  镜像: $FULL_IMAGE_NAME"
echo "  代码库: $GIT_REPO"
echo "=============================================="

# =================== 1. 清理旧代码 ===================
echo "清理旧代码..."
rm -rf ./vue-project
mkdir -p ./vue-project

# =================== 2. 拉取代码 ===================
echo "正在克隆代码..."
git clone "$GIT_REPO" ./vue-project

cd ./vue-project

echo "检出分支: $BRANCH"
git checkout "$BRANCH" || { echo "切换分支失败"; exit 1; }
git pull origin "$BRANCH" || { echo "拉取代码失败"; exit 1; }

echo "代码拉取成功"
ls -l

# =================== 3. Node.js / NVM ===================
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  \. "$NVM_DIR/nvm.sh"
fi
if ! command -v nvm &> /dev/null; then
  echo "NVM 未找到，正在安装..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  \. "$NVM_DIR/nvm.sh"
else
  echo "NVM 已加载，版本: $(nvm --version)"
fi
echo "安装并切换到 Node 24..."
nvm use 24.15.0 || nvm install 24.15.0
echo "Node: $(node -v)"
echo "npm: $(npm -v)"

# =================== 4. 构建前端（生产环境）====================
echo "安装依赖..."
rm -rf node_modules package-lock.json
npm install --no-audit --progress=false --registry=https://registry.npmmirror.com

echo "构建前端（生产环境）..."
npm run build:prod

[ ! -d "dist" ] && { echo "构建失败：dist 目录未生成"; exit 1; }
echo "构建成功"

# 校验仓库里的必要文件都在
[ ! -f "Dockerfile" ]          && { echo "仓库缺少 Dockerfile"; exit 1; }
[ ! -f "nginx.template.conf" ] && { echo "仓库缺少 nginx.template.conf"; exit 1; }
[ ! -f "start-nginx.sh" ]      && { echo "仓库缺少 start-nginx.sh"; exit 1; }

cd ..

# =================== 5. 构建并推送镜像 ===================
echo "构建镜像: $FULL_IMAGE_NAME"
docker build -f ./vue-project/Dockerfile -t "$FULL_IMAGE_NAME" -t "$LATEST_IMAGE_NAME" ./vue-project/

echo "正在登录 TCR..."
docker login qdd-ome.tencentcloudcr.com -u "$TCR_USERNAME" -p "$TCR_PASSWORD" || { echo "登录 TCR 失败"; exit 1; }

echo "推送镜像..."
docker push "$FULL_IMAGE_NAME"
# docker push "$LATEST_IMAGE_NAME"

echo "构建并推送成功！"
echo "镜像: $FULL_IMAGE_NAME"

# =================== 6. 清理 ===================
echo "清理 Docker 构建缓存..."
docker image prune -f || true

echo "删除 Docker 本地镜像..."
docker rmi $(docker images | grep "$IMAGE_NAME" | awk '{print $1":"$2}') || true
