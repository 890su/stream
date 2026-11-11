#!/usr/bin/env bash
# Install or update Stream on srv-150, isolated from other projects.
# Run on the server:  sudo bash deploy/install.sh [git-ref]
# Idempotent: re-running updates the code to <git-ref> (default: main) and restarts the container.
set -euo pipefail

REF="${1:-main}"
REPO="https://github.com/890su/stream.git"
ROOT=/srv/stream
APP="$ROOT/app"
ENV_FILE="$ROOT/.env"
PORT=3790

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
command -v docker >/dev/null || { echo "Docker is required"; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose plugin is required"; exit 1; }

# Dedicated system user without login and home: the container runs as this uid.
id stream >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin stream
UID_S=$(id -u stream); GID_S=$(id -g stream)

install -d -m 755 "$ROOT"
install -d -m 700 -o stream -g stream "$ROOT/data" "$ROOT/backups"

# Code: public repository, owned by root, read-only for the service.
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch --quiet origin
else
  git clone --quiet "$REPO" "$APP"
fi
git -C "$APP" checkout --quiet --detach "origin/$REF" 2>/dev/null || git -C "$APP" checkout --quiet --detach "$REF"
echo "Code: $(git -C "$APP" log -1 --format='%h %s')"

# Secrets: generated once on the server, never in git.
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  {
    echo "STREAM_OWNER_TOKEN=$(openssl rand -hex 32)"
    echo "STREAM_UID=$UID_S"
    echo "STREAM_GID=$GID_S"
  } > "$ENV_FILE"
  echo "Created $ENV_FILE with a new owner token (read it with: sudo grep TOKEN $ENV_FILE)"
fi
chmod 600 "$ENV_FILE"
ln -sfn "$ENV_FILE" "$APP/deploy/.env"   # compose reads variables from the project directory

if ss -ltn "sport = :$PORT" | grep -q LISTEN && ! docker ps --format '{{.Names}}' | grep -q '^stream-stream-1$'; then
  echo "Port $PORT is already used by another service"; exit 1
fi

cd "$APP/deploy"
docker compose build --quiet
docker compose up -d --remove-orphans

install -m 644 stream-backup.service stream-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now stream-backup.timer >/dev/null

for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && { echo "Stream is up on 127.0.0.1:$PORT"; break; }
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null || { docker compose logs --tail 50; exit 1; }

# Public HTTPS: add one ingress rule to the existing locally managed tunnel (backup kept, validated first).
CFG=/etc/cloudflared/config.yml
HOSTNAME_PUBLIC="${STREAM_HOST:-stream.sekond.pl}"
if [ -f "$CFG" ] && ! grep -q "hostname: $HOSTNAME_PUBLIC" "$CFG"; then
  cp -p "$CFG" "$CFG.bak-$(date +%Y%m%d%H%M%S)"
  awk -v h="$HOSTNAME_PUBLIC" -v p="$PORT" '
    /^[[:space:]]*- service: http_status:404/ && !done { print "  - hostname: " h; print "    service: http://127.0.0.1:" p; print ""; done=1 }
    { print }' "$CFG" > "$CFG.new"
  cloudflared tunnel ingress validate --config "$CFG.new" >/dev/null
  mv "$CFG.new" "$CFG"
  TUNNEL_ID=$(awk '/^tunnel:/ {print $2}' "$CFG")
  cloudflared tunnel --origincert /etc/cloudflared/cert.pem route dns "$TUNNEL_ID" "$HOSTNAME_PUBLIC" \
    || echo "DNS record for $HOSTNAME_PUBLIC not created (may already exist) - check in Cloudflare"
  systemctl restart cloudflared
  echo "Tunnel: $HOSTNAME_PUBLIC -> http://127.0.0.1:$PORT"
fi

sleep 3
curl -fsS "https://$HOSTNAME_PUBLIC/healthz" >/dev/null 2>&1 \
  && echo "OK: https://$HOSTNAME_PUBLIC" \
  || echo "https://$HOSTNAME_PUBLIC not answering yet - DNS may need a minute"
