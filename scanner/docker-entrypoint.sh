#!/usr/bin/env bash
# Container entrypoint for the IntelliRecon image.
#
# The image binds 0.0.0.0 (so the published port works), but the engine refuses
# to bind a non-loopback address without dashboard auth. Rather than fail a
# plain `docker run`, we generate a random admin password when none is supplied,
# print it once, and start. Operators can override by passing their own
# INTELLIRECON_USERNAME + INTELLIRECON_PASSWORD (or INTELLIRECON_PASSWORD_HASH).
set -euo pipefail

# Persist dashboard-configured settings on the /data volume. The engine writes
# runtime settings (LLM model/key, integrations, etc.) to ~/.intellirecon.env
# (=/root/.intellirecon.env). Symlinking it onto /data means anything you set under
# Settings survives `docker run --rm` / container recreation, not just restarts.
mkdir -p /data
if [ ! -e /data/.intellirecon.env ]; then
  if [ -f /root/.intellirecon.env ] && [ ! -L /root/.intellirecon.env ]; then
    mv /root/.intellirecon.env /data/.intellirecon.env
  else
    : >/data/.intellirecon.env
  fi
fi
ln -sf /data/.intellirecon.env /root/.intellirecon.env

bind="${INTELLIRECON_BIND:-0.0.0.0}"

# Is the bind address loopback (no auth required by the engine)?
is_loopback=false
case "$bind" in
  127.0.0.1 | localhost | ::1 | "") is_loopback=true ;;
esac

# Is dashboard auth already configured?
has_auth=false
if [ -n "${INTELLIRECON_USERNAME:-}" ] && { [ -n "${INTELLIRECON_PASSWORD:-}" ] || [ -n "${INTELLIRECON_PASSWORD_HASH:-}" ]; }; then
  has_auth=true
fi

if [ "$is_loopback" = false ] && [ "$has_auth" = false ]; then
  export INTELLIRECON_USERNAME="${INTELLIRECON_USERNAME:-admin}"
  export INTELLIRECON_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)"
  echo "============================================================"
  echo "  IntelliRecon — no dashboard auth was provided."
  echo "  Generated one-time credentials so the container can start:"
  echo ""
  echo "      username: ${INTELLIRECON_USERNAME}"
  echo "      password: ${INTELLIRECON_PASSWORD}"
  echo ""
  echo "  Override by setting INTELLIRECON_USERNAME + INTELLIRECON_PASSWORD"
  echo "  (or INTELLIRECON_PASSWORD_HASH). Rotate these before exposing"
  echo "  the dashboard on an untrusted network."
  echo "============================================================"
fi

exec intellirecon "$@"
