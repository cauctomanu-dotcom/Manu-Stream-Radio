# Décisions d'architecture

## 2026-09 — Diffusion

- Twitch et YouTube restent pilotés par **Streamlabs Desktop**.
- Manu Stream Radio déclenche les commandes Streamlabs via son API Remote Control.
- La page GitHub Pages est une **façade publique**, pas un serveur audio.
- Les auditeurs peuvent regarder/écouter les players intégrés sans avoir à manipuler l'application Windows.

## Bibliothèque média

- La bibliothèque personnelle reste locale à Manu Stream Radio.
- Aucun fichier musical, enregistrement ou média lourd ne doit être commité dans GitHub.

## Projet serveur H24 — différé

À conserver pour une phase ultérieure :

- VPS
- AzuraCast
- Liquidsoap / AutoDJ
- bibliothèque serveur synchronisée
- programmation récurrente
- écoute directe hors Twitch/YouTube
- passage automatique AutoDJ ↔ direct Manu Stream Radio

Cette phase est volontairement mise de côté pendant le développement GitHub + Streamlabs.
