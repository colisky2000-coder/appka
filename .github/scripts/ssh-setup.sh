#!/usr/bin/env bash
# Настраивает SSH-доступ к серверу внутри GitHub Actions и создаёт команду `srv`:
#   srv 'команда'            — выполнить команду на сервере
#   srv 'bash -s' < file.sh  — выполнить локальный скрипт на сервере
# Данные берутся из секретов репозитория (см. SERVER.md):
#   SERVER_HOST, SERVER_USER (по умолчанию root), SERVER_PORT (по умолчанию 22),
#   SERVER_PASSWORD (передаётся как SSHPASS) или SERVER_SSH_KEY.
set -euo pipefail

missing=()
[ -n "${SERVER_HOST:-}" ] || missing+=(SERVER_HOST)
[ -n "${SSHPASS:-}${SERVER_SSH_KEY:-}" ] || missing+=("SERVER_PASSWORD (или SERVER_SSH_KEY)")
if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::Не заданы секреты репозитория: ${missing[*]}. Добавь их: Settings → Secrets and variables → Actions → New repository secret (подробности в SERVER.md)."
  exit 1
fi

mkdir -p ~/.ssh ~/bin
chmod 700 ~/.ssh

opts=(-p "${SERVER_PORT:-22}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=30)
target="${SERVER_USER:-root}@${SERVER_HOST}"

if [ -n "${SERVER_SSH_KEY:-}" ]; then
  printf '%s\n' "$SERVER_SSH_KEY" > ~/.ssh/id_server
  chmod 600 ~/.ssh/id_server
  cmd=(ssh -i ~/.ssh/id_server -o BatchMode=yes)
else
  if ! command -v sshpass >/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq sshpass >/dev/null
  fi
  cmd=(sshpass -e ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no)
fi

{
  echo '#!/usr/bin/env bash'
  printf 'exec'
  printf ' %q' "${cmd[@]}" "${opts[@]}" "$target"
  echo ' "$@"'
} > ~/bin/srv
chmod +x ~/bin/srv
echo "$HOME/bin" >> "$GITHUB_PATH"

~/bin/srv true
echo "SSH: подключение к серверу работает"
