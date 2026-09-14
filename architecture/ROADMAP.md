# Roadmap Manu Stream Radio

## Priorité 1 — GitHub / développement propre

- [x] Centraliser les sources web V1.7
- [x] Exclure musiques, enregistrements et secrets
- [x] Préparer GitHub Pages
- [x] Créer le dépôt GitHub `Manu-Stream-Radio`
- [x] Publier ce premier snapshot
- [ ] Remplacer le build historique par un backend source reproductible
- [ ] Générer automatiquement l'EXE Windows dans GitHub Actions
- [ ] Publier automatiquement les versions Windows dans GitHub Releases
- [ ] Finaliser le système de mise à jour automatique de la régie

## Priorité 2 — Conducteur LIVE

- [x] Prévoir le glisser-déposer des blocs
- [ ] Ajouter les heures cibles optionnelles dans le conducteur
- [ ] Ajouter une timeline horaire pour déposer les blocs à une heure prévue
- [ ] Afficher heure prévue / heure réelle
- [ ] Afficher avance ou retard sur le conducteur
- [ ] Garder le compte à rebours avant la prochaine étape
- [ ] Verrouiller uniquement le bloc actuellement à l'antenne

## Priorité 3 — Programmation 24H

- [ ] Créer un onglet séparé `Programmation 24H`
- [ ] Grille de 00:00 à 23:59
- [ ] Blocs : rotation, média précis, jingle, pub, émission préenregistrée
- [ ] Surveillance permanente de l'heure tant que l'application est ouverte
- [ ] Démarrage automatique d'un programme prévu même si l'utilisateur a oublié de l'armer à l'heure exacte
- [ ] Rattrapage horaire d'un média déjà commencé lorsque possible
- [ ] Bouton `Passer en programmation automatique` à la fin d'un LIVE
- [ ] Bouton `Arrêter toute diffusion`

Voir [PROGRAMMATION.md](PROGRAMMATION.md) pour le comportement détaillé.

## Priorité 4 — Streamlabs

- [ ] Fiabiliser définitivement l'arrêt Live/REC après reconnexion
- [ ] Vérifier la route Remote Control utilisée par chaque version Streamlabs
- [ ] Assistant de diagnostic audio
- [ ] Détection de la source audio Streamlabs
- [ ] État Twitch/YouTube visible dans la régie
- [ ] Conserver le live Streamlabs actif lors du passage LIVE → AUTO 24H

## Priorité 5 — Page auditeurs

- [x] Créer la base GitHub Pages
- [x] Remplacer le choix Twitch/YouTube par un lecteur unique
- [x] Préparer la priorité `flux radio direct → Twitch → YouTube`
- [ ] Renseigner la chaîne Twitch
- [ ] Renseigner l'identifiant YouTube
- [ ] Renseigner le futur flux radio direct
- [ ] Afficher automatiquement Live / Hors antenne
- [ ] Afficher l'émission en cours
- [ ] Afficher le prochain direct
- [ ] Ajouter le logo et l'identité visuelle définitive

## Plus tard — radio H24 serveur

- [ ] VPS + AzuraCast
- [ ] AutoDJ serveur
- [ ] médiathèque serveur synchronisée
- [ ] grille hebdomadaire récurrente
- [ ] flux d'écoute radio direct indépendant de Twitch/YouTube
