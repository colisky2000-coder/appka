#!/usr/bin/env bash
# Этот скрипт GitHub Actions выполняет на сервере (.github/workflows/server-run.yml)
# при пуше изменений этого файла в ветку claude/**. Вывод — в логах Actions.
# Логи Actions видны всем, у кого есть доступ к репозиторию: не выводи пароли, токены, .env.
#
# Сейчас: осмотр сервера. Только чтение, ничего не меняет.
set -uo pipefail

h() { printf '\n===== %s =====\n' "$*"; }

# Маскирует похожее на секреты в выводе (токены ботов, key=value с паролями, логины в URL)
mask() {
  sed -E \
    -e 's/[0-9]{8,10}:[A-Za-z0-9_-]{30,}/***BOT_TOKEN***/g' \
    -e 's/((token|TOKEN|pass(word)?|PASS(WORD)?|secret|SECRET|key|KEY)[A-Za-z_]*[=:] *)[^ ,;]+/\1***/g' \
    -e 's#://[^/@ ]+@#://***@#g'
}

inspect() {
  h Система
  hostname
  grep PRETTY_NAME /etc/os-release
  uname -r
  uptime

  h Ресурсы
  echo "CPU: $(nproc)"
  free -h
  df -h -x tmpfs -x devtmpfs -x overlay 2>/dev/null || df -h

  h Слушающие порты
  ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null

  h Запущенные сервисы
  systemctl list-units --type=service --state=running --no-pager --no-legend | awk '{print $1}'

  h Свои systemd-сервисы
  ls -la /etc/systemd/system/*.service 2>/dev/null

  h Установленное ПО
  for c in nginx apache2 httpd caddy docker python3 pip3 node npm pm2 git certbot php mysql psql redis-server; do
    printf '%-13s %s\n' "$c" "$(command -v "$c" || echo -)"
  done
  python3 --version 2>&1
  node --version 2>&1
  nginx -v 2>&1

  h Docker
  docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null

  h PM2
  pm2 ls 2>/dev/null

  h Процессы python/node/gunicorn/php
  ps -eo pid,user,etime,args --sort=-rss | grep -Ei 'python|node|gunicorn|uvicorn|php|java' | grep -v grep | cut -c1-220

  h Nginx: сайты
  nginx -T 2>/dev/null | grep -E '^# configuration file|^\s*(server_name|listen|root|proxy_pass)\b'

  h Apache: сайты
  (apache2ctl -S || httpd -S) 2>&1 | head -30

  h Что отвечает на 80/443 локально
  curl -s -o /dev/null -w 'http://127.0.0.1/  -> %{http_code}\n' -m 5 http://127.0.0.1/
  curl -sk -o /dev/null -w 'https://127.0.0.1/ -> %{http_code}\n' -m 5 https://127.0.0.1/

  h "SSL-сертификаты Let's Encrypt"
  ls /etc/letsencrypt/live 2>/dev/null

  h Каталоги
  for d in /var/www /srv /opt /home /root; do echo "--- $d"; ls -la "$d" 2>/dev/null; done

  h Git-репозитории
  find / -xdev -maxdepth 4 -type d -name .git -not -path '*/node_modules/*' 2>/dev/null | while read -r g; do
    d=$(dirname "$g")
    echo "$d | $(git -c safe.directory='*' -C "$d" remote get-url origin 2>/dev/null) | $(git -c safe.directory='*' -C "$d" log -1 --format='%h %cd %s' --date=short 2>/dev/null)"
  done

  h Cron
  crontab -l 2>/dev/null | grep -v '^\s*#'
  ls /etc/cron.d 2>/dev/null

  h Firewall
  ufw status 2>/dev/null
  iptables -S INPUT 2>/dev/null | head -20

  h Отпечаток SSH-ключа сервера
  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null
}

inspect 2>&1 | mask
