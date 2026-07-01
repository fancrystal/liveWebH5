# 用腾讯云镜像源避开 docker.io 不通的问题
FROM mirror.ccs.tencentyun.com/library/nginx:alpine

# ─── 构建说明 ──────────────────────────────────────────────────────────────────
# 此镜像只包含运行时（nginx + 静态文件），构建在 CI 阶段完成：
#
#   测试环境: npm run build:test  &&  docker build -t live-h5:test .
#   生产环境: npm run build:prod  &&  docker build -t live-h5:prod .
#
# nginx 上游地址在容器启动时通过环境变量注入（K8s ConfigMap / Deployment env）：
#   NGINX_WHIP_UPSTREAM  — WHIP 代理上游
#   NGINX_IM_UPSTREAM    — IM REST API 代理上游
# ───────────────────────────────────────────────────────────────────────────────

RUN rm -f /etc/nginx/conf.d/default.conf

# nginx 配置模板 + 启动脚本
COPY nginx.template.conf /etc/nginx/templates/default.conf.template
COPY start-nginx.sh     /start-nginx.sh

# 前端构建产物（CI 阶段已生成 dist/）
COPY dist/ /usr/share/nginx/html/

RUN chmod +x /start-nginx.sh

EXPOSE 80
CMD ["/start-nginx.sh"]
