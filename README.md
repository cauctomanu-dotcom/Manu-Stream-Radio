# Manu Stream Radio

Manu Stream Radio est la régie radio de Manu.

## Architecture active

- **Studio Windows V4** : le code de l’interface et du moteur est embarqué dans l’EXE. Le Studio ne télécharge plus son interface depuis GitHub au démarrage.
- **Bibliothèque média du Studio** : stockage local configurable (actuellement `C:\Users\cauct\Documents\media Manu Stream`). Aucun média de la bibliothèque principale ne doit être restauré depuis Supabase.
- **Icecast** : sortie MASTER vers `192.168.1.11:8000/manustream` sur le réseau local.
- **Remote Studio** : publiée par GitHub Pages dans `docs/remote-studio/`. Supabase peut rester utilisé uniquement comme pont Remote (commandes, signalisation WebRTC et transferts Remote nécessaires).
- **Page auditeurs** : publiée par GitHub Pages depuis `docs/`.

## Important — anciennes versions

Les anciens mécanismes de mise à jour automatique GitHub et les sources `app/web` V1/V2 ont été retirés du `main`. Ils ne doivent plus être utilisés comme source de démarrage ou de restauration du Studio.

Il n’existe plus de manifeste `docs/update.json` chargé de remplacer automatiquement l’interface locale du Studio.

## Règle de compatibilité

La V3.9.25 reste la référence fonctionnelle pour l’interface et les fonctions historiques du Studio. Les versions V4 doivent conserver ces fonctions sauf remplacement explicitement demandé (notamment ancien serveur web radio → Icecast et bibliothèque cloud → bibliothèque locale).

## GitHub Pages

Le workflow Pages ne publie que le dossier `docs/`. Il ne doit jamais publier ni remplacer le moteur local du Studio Windows.
