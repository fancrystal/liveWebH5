# 用腾讯云镜像源避开 docker.io 不通的问题
FROM mirror.ccs.tencentyun.com/library/nginx:alpine

RUN rm -f /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/      /usr/share/nginx/html/

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
