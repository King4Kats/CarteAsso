#!/usr/bin/env bash
# (VPS) Installe le cron keepalive (via keepalive.sh, voir piege explique dedans) et lance le
# runner maintenant. Idempotent. NB : le nom de CE script ne doit pas contenir "runner.sh".
cd ~/carteasso-enrich || exit 1
chmod +x keepalive.sh runner.sh
( crontab -l 2>/dev/null | grep -v -e 'runner\.sh' -e 'keepalive\.sh'
  echo '@reboot ~/carteasso-enrich/keepalive.sh'
  echo '*/2 * * * * ~/carteasso-enrich/keepalive.sh'
) | crontab -
./keepalive.sh
sleep 3
echo "runner pids: $(pgrep -f '[r]unner\.sh' | tr '\n' ' ')"
