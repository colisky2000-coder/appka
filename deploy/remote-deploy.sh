#!/usr/bin/env bash
# Выполняется НА СЕРВЕРЕ из .github/workflows/deploy.yml:
#   remote-deploy.sh env                   — записать KEY=VALUE из stdin в /etc/appka/appka.env
#   remote-deploy.sh release <каталог>     — сделать релиз текущим, перезапустить сервис,
#                                            проверить и откатить на предыдущий при ошибке
set -euo pipefail

APP=/opt/appka
ENV_FILE=/etc/appka/appka.env
SERVICE=appka
KEEP_RELEASES=5

pkg_install() {
  if command -v apt-get >/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
  elif command -v dnf >/dev/null; then
    dnf install -y -q "$@"
  else
    yum install -y -q "$@"
  fi
}

update_env() {
  umask 077
  mkdir -p "$(dirname "$ENV_FILE")"
  touch "$ENV_FILE"
  local line key n=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    key=${line%%=*}
    { grep -v "^${key}=" "$ENV_FILE" || true; printf '%s\n' "$line"; } > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
    echo "  $key — обновлено"
    n=$((n + 1))
  done
  echo "Переменных из секретов GitHub: $n (файл $ENV_FILE)"
}

healthy() {
  local port
  port=$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | tail -1)
  port=${port:-5000}
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "http://127.0.0.1:${port}/"; then
      echo "Сервис отвечает на 127.0.0.1:${port}"
      return 0
    fi
    sleep 1
  done
  return 1
}

activate() {
  ln -sfn "$1" "$APP/current.new"
  mv -Tf "$APP/current.new" "$APP/current"
  systemctl restart "$SERVICE"
}

deploy_release() {
  local rel=$1 prev
  [ -f "$rel/server.py" ] || { echo "Нет релиза в $rel"; exit 1; }

  command -v python3 >/dev/null || pkg_install python3
  command -v curl >/dev/null || pkg_install curl
  if [ ! -x "$APP/venv/bin/pip" ]; then
    rm -rf "$APP/venv"
    if ! python3 -m venv "$APP/venv" 2>/dev/null; then
      rm -rf "$APP/venv"
      pkg_install python3-venv
      python3 -m venv "$APP/venv"
    fi
  fi
  echo "Установка Python-зависимостей…"
  "$APP/venv/bin/pip" install -q --upgrade pip
  "$APP/venv/bin/pip" install -q -r "$rel/requirements.txt"

  id "$SERVICE" >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin "$SERVICE"
  mkdir -p "$(dirname "$ENV_FILE")" && touch "$ENV_FILE" && chmod 600 "$ENV_FILE"
  install -m 644 "$rel/deploy/appka.service" "/etc/systemd/system/$SERVICE.service"
  systemctl daemon-reload
  systemctl enable -q "$SERVICE"

  prev=$(readlink -f "$APP/current" 2>/dev/null || true)
  activate "$rel"

  if ! healthy; then
    echo "::error::Сервис не поднялся. Последние строки журнала:"
    journalctl -u "$SERVICE" -n 60 --no-pager || true
    if [ -n "$prev" ] && [ -d "$prev" ] && [ "$prev" != "$rel" ]; then
      echo "Откат на предыдущий релиз: $prev"
      activate "$prev"
      healthy || true
    fi
    exit 1
  fi

  # Оставить только последние релизы (текущий не трогаем)
  ls -1dt "$APP"/releases/*/ | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
    [ "$(readlink -f "$old")" = "$(readlink -f "$APP/current")" ] || rm -rf "$old"
  done
  echo "Готово: текущий релиз $(readlink -f "$APP/current")"
}

case "${1:-}" in
  env) update_env ;;
  release) deploy_release "${2:?каталог релиза}" ;;
  *) echo "Использование: $0 env | release <каталог>"; exit 2 ;;
esac
