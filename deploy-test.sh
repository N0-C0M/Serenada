#!/bin/bash
set -euo pipefail

info() {
    echo "[deploy-test] $1"
}

warn() {
    echo "[deploy-test][warn] $1" >&2
}

fail() {
    echo "[deploy-test][error] $1" >&2
    exit 1
}

load_env_file() {
    local env_file="$1"
    if [ ! -f "$env_file" ]; then
        fail "$env_file not found."
    fi

    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
}

require_var() {
    local name="$1"
    if [ -z "${!name:-}" ]; then
        fail "$name is not set."
    fi
}

load_env_file ".env.production"
load_env_file ".env.test.production"

TEST_DOMAIN="${TEST_DOMAIN:-test.serenada-app.ru}"
TEST_REMOTE_DIR="${TEST_REMOTE_DIR:-/opt/serenada-test}"
TEST_COMPOSE_PROJECT="${TEST_COMPOSE_PROJECT:-serenada-test}"
TEST_APP_HTTP_PORT="${TEST_APP_HTTP_PORT:-18080}"
TEST_STACK_HTTP_PORT="${TEST_STACK_HTTP_PORT:-18081}"
TEST_CERTBOT_EMAIL="${TEST_CERTBOT_EMAIL:-${CERTBOT_EMAIL:-}}"

require_var "VPS_HOST"
require_var "DOMAIN"
require_var "REMOTE_DIR"

if [ "$TEST_REMOTE_DIR" = "$REMOTE_DIR" ]; then
    fail "TEST_REMOTE_DIR must differ from REMOTE_DIR."
fi

info "Building frontend..."
(cd client && npm run build)

info "Generating nginx configs..."
mkdir -p nginx/conf.d
export DOMAIN IPV4 IPV6 REMOTE_DIR TEST_DOMAIN TEST_APP_HTTP_PORT TEST_STACK_HTTP_PORT

if [ -n "${IPV6:-}" ]; then
    export IPV6_Run_HTTP="listen [::]:80;"
    export IPV6_Run_HTTPS="listen [::]:443 ssl http2;"
else
    export IPV6_Run_HTTP=""
    export IPV6_Run_HTTPS=""
fi

envsubst '$DOMAIN $IPV4 $IPV6 $REMOTE_DIR $IPV6_Run_HTTP $IPV6_Run_HTTPS' < nginx/nginx.prod.conf.template > nginx/nginx.prod.conf
envsubst '$TEST_DOMAIN' < nginx/nginx.test.conf.template > nginx/nginx.test.conf
envsubst '$TEST_DOMAIN $TEST_STACK_HTTP_PORT $IPV6_Run_HTTP $IPV6_Run_HTTPS' < nginx/nginx.test-proxy.extra.template > nginx/conf.d/test-proxy.extra

info "Syncing test stack to VPS..."
ssh "$VPS_HOST" "mkdir -p '$TEST_REMOTE_DIR'"
rsync -avz \
    --exclude 'server/server' \
    --exclude 'server/server_test' \
    --exclude '*.template' \
    --exclude 'server/data' \
    --exclude 'server/test-data' \
    --exclude 'nginx/conf.d/test-proxy.extra' \
    docker-compose.yml \
    docker-compose.test.yml \
    .env.production \
    .env.test.production \
    server/ \
    client/dist/ \
    nginx/ \
    "$VPS_HOST:$TEST_REMOTE_DIR/"

info "Starting test stack..."
ssh "$VPS_HOST" "cd '$TEST_REMOTE_DIR' && \
    cat .env.production .env.test.production > .env.test.runtime && \
    docker compose --env-file .env.test.runtime -p '$TEST_COMPOSE_PROJECT' -f docker-compose.yml -f docker-compose.test.yml up -d --build app-server nginx"

info "Syncing production nginx runtime files..."
ssh "$VPS_HOST" "mkdir -p '$REMOTE_DIR/nginx/conf.d' '$REMOTE_DIR/client/dist/.well-known/acme-challenge'"
rsync -avz \
    docker-compose.yml \
    docker-compose.prod.yml \
    .env.production \
    nginx/nginx.prod.conf \
    "$VPS_HOST:$REMOTE_DIR/"

info "Applying production nginx compose/runtime updates..."
ssh "$VPS_HOST" "cd '$REMOTE_DIR' && \
    cp .env.production .env && \
    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d nginx"

CERT_PATH="/etc/letsencrypt/live/$TEST_DOMAIN/fullchain.pem"
HAS_TEST_CERT="$(ssh "$VPS_HOST" "if [ -s '$CERT_PATH' ]; then echo yes; else echo no; fi")"

if [ "$HAS_TEST_CERT" != "yes" ]; then
    if [ -z "$TEST_CERTBOT_EMAIL" ]; then
        fail "No certificate for $TEST_DOMAIN and TEST_CERTBOT_EMAIL is empty."
    fi

    info "Issuing Let's Encrypt certificate for $TEST_DOMAIN..."
    ssh "$VPS_HOST" "docker run --rm \
        -v /etc/letsencrypt:/etc/letsencrypt \
        -v '$REMOTE_DIR/client/dist:/var/www/certbot' \
        certbot/certbot:latest certonly \
        --webroot \
        -w /var/www/certbot \
        -d '$TEST_DOMAIN' \
        --email '$TEST_CERTBOT_EMAIL' \
        --agree-tos \
        --non-interactive \
        --keep-until-expiring"
else
    info "Certificate for $TEST_DOMAIN already exists."
fi

info "Publishing test domain proxy config..."
rsync -avz nginx/conf.d/test-proxy.extra "$VPS_HOST:$REMOTE_DIR/nginx/conf.d/"

info "Validating and reloading production nginx..."
ssh "$VPS_HOST" "cd '$REMOTE_DIR' && \
    docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T nginx nginx -t && \
    docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T nginx nginx -s reload"

info "Deployment status (test stack):"
ssh "$VPS_HOST" "cd '$TEST_REMOTE_DIR' && docker compose -p '$TEST_COMPOSE_PROJECT' -f docker-compose.yml -f docker-compose.test.yml ps"

info "Checking test domain response..."
if curl -sI "https://$TEST_DOMAIN" | head -n 1; then
    :
else
    warn "Unable to fetch https://$TEST_DOMAIN from local machine."
fi

info "Done. Test environment is available at https://$TEST_DOMAIN"
