#!/bin/sh
# Set default values for nginx upstream variables if not already set.
# In production (K8s), these MUST be injected via ConfigMap / env — the defaults
# below are only for local dev convenience and will fail-fast in production if
# the variables are accidentally left unset.
export NGINX_WHIP_UPSTREAM="${NGINX_WHIP_UPSTREAM:-}"
export NGINX_IM_UPSTREAM="${NGINX_IM_UPSTREAM:-}"

# Substitute environment variables in the nginx config template.
# Only replace the NGINX_ prefixed vars (prevent leaking other env vars).
envsubst '${NGINX_WHIP_UPSTREAM} ${NGINX_IM_UPSTREAM}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[start-nginx] WHIP upstream: $NGINX_WHIP_UPSTREAM"
echo "[start-nginx] IM   upstream: $NGINX_IM_UPSTREAM"

exec nginx -g 'daemon off;'
