# Manu Stream Radio

Manu Stream Radio est une régie radio personnelle pour Windows, pensée pour piloter un direct, gérer plusieurs micros et invités, lancer des médias, organiser un conducteur et synchroniser Streamlabs Desktop.

## État actuel

La base GitHub correspond à la **V1.7** de Manu Stream Radio.

Le dépôt est désormais la source de vérité du projet. Les musiques, enregistrements et secrets Streamlabs restent **hors GitHub**.

## Architecture actuelle

- **Manu Stream Radio** : régie principale.
- **Streamlabs Desktop** : diffusion vers Twitch et YouTube, enregistrement vidéo et scènes.
- **GitHub** : code source, historique, documentation et futures versions.
- **GitHub Pages** : future page publique pour les auditeurs.

Le projet de serveur radio permanent / AutoDJ (AzuraCast, VPS, diffusion H24 indépendante du PC) est volontairement conservé pour une phase ultérieure.

## Fonctionnalités déjà présentes

- bibliothèque musicale locale ;
- lecteurs A/B et crossfader ;
- conducteur d'émission ;
- blocs Live avec musique de fond et ducking ;
- micros multiples ;
- invités / appels séparés des micros ;
- capture d'appels WhatsApp / Discord ;
- soundboard ;
- enregistrement MASTER local ;
- intégration Streamlabs Remote Control ;
- synchronisation REC / LIVE avec Streamlabs ;
- reconnexion Streamlabs ;
- test audio MASTER ;
- grille AUTO 24H locale expérimentale ;
- overlay radio ;
- page publique GitHub Pages en préparation.

## Structure

```text
app/web/             Interface et moteur audio de la régie
architecture/        Décisions et roadmap du projet
docs/                Site public GitHub Pages
tools/               Outils de maintenance / migration
.github/workflows/   Automatisation GitHub
```

## Sécurité et fichiers locaux

Le dépôt ne doit jamais contenir :

- token Streamlabs ;
- mots de passe ou clés API ;
- musique personnelle ou commerciale ;
- jingles / émissions non destinés au dépôt ;
- enregistrements ;
- fichiers de configuration locale contenant des secrets.

Les exclusions principales sont définies dans `.gitignore`.

## Page publique

La page publique est située dans `docs/`.

Elle a vocation à devenir l'adresse unique que Manu peut donner aux auditeurs pendant ses heures de direct, tout en conservant **Streamlabs comme moteur de diffusion vers Twitch et YouTube**.

Les identifiants Twitch et YouTube seront renseignés dans `docs/config.js`.

Aucun mot de passe ni token ne doit être placé dans `docs/config.js`.

## Versions

Voir [CHANGELOG.md](CHANGELOG.md).

## Suite

Voir [architecture/ROADMAP.md](architecture/ROADMAP.md).
