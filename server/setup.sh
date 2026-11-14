#!/bin/sh
# Установка сервера DuckChance на чистый Ubuntu/Debian VPS.
# Запуск на сервере от root:  TG_TOKEN=<токен> DOMAIN=<домен> sh setup.sh
# Если своего домена нет, подойдёт бесплатный вида 1-2-3-4.sslip.io (цифры это IP сервера через дефис).
# Если на сервере уже есть nginx на портах 80/443, Caddy не нужен: сайт подключается через nginx и certbot
# (так сделано на текущем VPS: duck.2-27-12-205.sslip.io -> 127.0.0.1:8787).
set -eu
: "${TG_TOKEN:?Нужен TG_TOKEN}"
: "${DOMAIN:?Нужен DOMAIN, например 1-2-3-4.sslip.io}"
APP=/opt/duckchance

apt-get update -q
apt-get install -y -q python3 caddy git

id duck >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin duck
mkdir -p "$APP"
cp app.py "$APP/"
cp ../bot_poller.py "$APP/"
chown -R duck:duck "$APP"

# токен лежит только здесь, доступен одному root и сервису
umask 077
cat > /etc/duckchance.env <<EOF
TG_TOKEN=$TG_TOKEN
DB=$APP/duckchance.db
PAY_LOG=$APP/payments.log
SEEN_FILE=$APP/seen_users.json
BOT=1
APP_VER=${APP_VER:-13}
EOF
umask 022

cat > /etc/systemd/system/duckchance.service <<EOF
[Unit]
Description=DuckChance server and bot
After=network-online.target

[Service]
User=duck
WorkingDirectory=$APP
EnvironmentFile=/etc/duckchance.env
ExecStart=/usr/bin/python3 -I $APP/app.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Caddy сам получает сертификат HTTPS
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  reverse_proxy 127.0.0.1:8787
}
EOF

systemctl daemon-reload
systemctl enable --now duckchance
systemctl reload caddy || systemctl restart caddy
sleep 2
curl -fsS "https://$DOMAIN/health" && echo " Готово: https://$DOMAIN"
