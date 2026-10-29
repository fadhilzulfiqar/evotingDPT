#!/usr/bin/env bash
set -e
if ! pgrep -f "node server.js" >/dev/null 2>&1; then
  nohup npm start > /tmp/dpt-evoting.log 2>&1 &
fi
sleep 2
echo "DPT E-Voting aktif di port 3000."
echo "Untuk membagikan: buka tab PORTS, klik kanan port 3000, pilih Port Visibility > Public, lalu salin URL."
