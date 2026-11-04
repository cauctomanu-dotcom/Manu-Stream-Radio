#!/usr/bin/env bash
# MSR V9 preflight: READ ONLY. No changes to production or secrets.
set -u
printf '\n=== Manu Stream Radio V9 : diagnostic Ubuntu (lecture seule) ===\n'
date -Is
printf '\n[OS]\n'
if [ -r /etc/os-release ]; then
  grep -E '^(NAME|VERSION|VERSION_ID)=' /etc/os-release || true
fi
printf '\n[Logiciels]\n'
for program in python3 liquidsoap ffmpeg ffprobe curl; do
  if command -v "$program" >/dev/null 2>&1; then
    printf '%s : PRESENT (%s)\n' "$program" "$(command -v "$program")"
  else
    printf '%s : absent ou non dans PATH\n' "$program"
  fi
done
if command -v liquidsoap >/dev/null 2>&1; then
  liquidsoap --version 2>&1 | head -n 3 || true
fi
printf '\n[Disque et montage des médias]\n'
path="/srv/msr-v9-media"
printf 'Chemin V9 attendu : %s\n' "$path"
if [ -d "$path" ]; then
  df -h "$path" || true
  findmnt -T "$path" -o TARGET,SOURCE,FSTYPE | cut -c1-155 || true
  if mountpoint -q "$path"; then
    echo 'Montage direct : OUI'
  else
    echo 'Montage direct : NON (attention au disque interne de la VM)'
  fi
else
  echo 'Chemin absent : aucune bibliothèque V9 montée ici.'
fi
printf '\n[Icecast local]\n'
if command -v systemctl >/dev/null 2>&1; then
  systemctl is-active icecast2.service 2>/dev/null || true
fi
if command -v curl >/dev/null 2>&1; then
  curl --silent --show-error --max-time 3 --output /dev/null \
       --write-out 'GET /status-json.xsl HTTP %{http_code}\n' \
       http://127.0.0.1:8000/status-json.xsl || true
fi
printf '\n[Projet V9]\n'
test -e /opt/manustream-v9/v9/engine.py && echo 'Sources V9 : présentes' || echo 'Sources V9 : non installées'
test -e /etc/msr-v9/station.env && echo 'Configuration : présente (contenu non affiché)' || echo 'Configuration : absente'
printf '\nAucune modification effectuée. Ne partagez pas les mots de passe.\n'
