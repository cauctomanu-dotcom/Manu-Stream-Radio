# Manu Stream Radio V9 — antenne autonome (préproduction)

**État : V9 en expérimentation sur le montage Icecast `/manustream-v9-test` (non reliée au flux public). La correction des autorisations de rotation ci-dessous est uniquement sur la branche GitHub tant qu'elle n'a pas été testée et déployée explicitement.**
La V8.3 Windows et la source Icecast /manustream restent inchangées.

## Principe

- Ubuntu exécute Liquidsoap en permanence, indépendant de Chromium et du PC.
- Les médias définitifs sont sur le partage Freebox de 2 To (musique, jingles,
  chroniques, émissions, publicités). SQLite conserve les métadonnées, pas le son.
- Python choisit les pistes à préparer pour les prochaines fins de morceau.
  Liquidsoap précharge des requêtes ; la synchronisation exacte entre titres réellement diffusés et programmés reste à valider.
- **Rotation musicale sur liste blanche** : chaque musique doit être explicitement
  autorisée en rotation (`rotation_enabled`, désactivé par défaut).
  Ni les musiques non autorisées ni les nouveaux fichiers ne sont tirés au sort.
  Les autorisations sont conservées pendant les analyses successives de médiathèque.
  Si aucune musique n'est autorisée, le secours diffuse temporairement du silence
  plutôt que de contourner la sélection. Importer d'abord les autorisations de l'ancien Studio
  ou les cocher dans la régie V9 avant la mise en production.
- Une chronique prévue doit être lancée après la chanson et son jingle ; la précision
  horaire reste à confirmer par des essais réels.
- Seul le dossier **Jingles/Général** alimente les jingles automatiques
  (entre deux titres et avant les programmes). Les jingles Noël, Halloween
  et ceux des émissions restent disponibles pour une programmation explicite.
  Si le dossier Général est vide, aucun jingle saisonnier n'est choisi en secours.
- Une prise de direct volontaire est prioritaire ; à sa déconnexion, Liquidsoap
  revient automatiquement à l'automatisation.
- La page auditeurs pourra afficher les programmes via une API publique.
- Le panneau web permet l'importation et la programmation sans PowerShell.

## Fichiers

- v9/engine.py : médiathèque, programmation hebdomadaire et ponctuelle, rotation,
  anti-répétitions, journal, API public/admin.
- v9/admin.html : panneau d'import, grille et consultation.
- v9/liquidsoap/main.liq : AutoDJ et entrée live, avec sortie /manustream-v9-test
  **séparée du vrai flux**.
- v9/systemd : services de redémarrage permanent.
- v9/station.env.example : configuration sans secrets réels.
- v9/tests : tests hors ligne.
- docs/site.js : future synchronisation 30 secondes et priorité au vrai flux
  audio lorsqu'il sera correctement configuré (désactivé par défaut).

## Stockage sur les 2 To : attention

La présence d'un fichier Manu-Stream.vm.raw sur le disque Freebox ne veut
PAS dire que l'Ubuntu invité voit automatiquement les 2 To. Avant de
déployer, vérifier ses montages (df -h), et monter depuis Ubuntu le partage
SMB/CIFS Freebox ou un montage déjà validé.

Le moteur utilise désormais les noms **exacts** de ton studio Windows. Le
dossier Radio-V9 conserve l'arborescence copiée avec Robocopy :

    /srv/msr-v9-media/Musique
    /srv/msr-v9-media/Jingles
    /srv/msr-v9-media/Chroniques
    /srv/msr-v9-media/Emissions
    /srv/msr-v9-media/Pubs

Il conserve aussi Best Of, Effets, Fonds d'antenne, Infos et Météo et les
sous-dossiers existants, sans renommer les fichiers. Le répertoire caché
.studio-edit n'est pas ouvert à la création par l'API. La copie Robocopy
avec /XF * a copié **les dossiers uniquement** : aucun média n'est encore
présent sur le partage V9.

Faire pointer /srv/msr-v9-media vers un vrai dossier du disque 2 To, avec
montage automatique et permissions adaptées. Ne PAS déplacer ni supprimer
le fichier de la VM. Garder la base de données SQLite sur le disque
Linux local (/var/lib/msr-v9), jamais sur un partage SMB.

## Installation et validation (après inspection de la VM)

1. Sauvegarder la configuration existante et vérifier espace libre / montages.
2. Vérifier la version Ubuntu, Python (3.12+) et Liquidsoap.
   Le script actuel passe la vérification syntaxique sur Liquidsoap 2.2.4
   installé sur la VM. Les transitions réelles restent à qualifier.
3. Créer l'utilisateur système msr, /var/lib/msr-v9, les dossiers médias
   sur le 2 To et déposer le repo sous /opt/manustream-v9.
4. Copier station.env.example vers /etc/msr-v9/station.env, configurer de
   vrais secrets aléatoires et limiter les permissions (0600).
5. Tester les programmes et la syntaxe avant d'activer des services :

       cd /opt/manustream-v9
       python3 -m unittest discover -s v9/tests -v
       python3 -m py_compile v9/engine.py
       python3 v9/engine.py scan
       python3 v9/engine.py status
       liquidsoap --check v9/liquidsoap/main.liq

6. Installer et démarrer les 2 unités systemd sur le **montage de test
   /manustream-v9-test**, sans changer la source /manustream.
7. Accéder au panneau /admin/ uniquement en local ou derrière un proxy
   HTTPS fortement protégé. Importer un MP3 court et une chronique de
   24 minutes, programmer des événements et observer les enchaînements.
8. Tester 24 h et vérifier : chanson jamais coupée, jingle, horaire,
   longue chronique, fermeture du PC, reconnexion, redémarrage de VM,
   panne de l'interface Windows, métadonnées du site.
9. Après validation seulement, planifier le basculement de la source publique,
   en gardant un retour immédiat à V8.3 en cas d'échec.

**Validation des nouvelles autorisations** : exécuter les tests Python et `liquidsoap --check` dans un répertoire temporaire avant toute mise à jour des services V9 en cours. Ne jamais appliquer cette version en production sans avoir renseigné la liste autorisée. Les anciens fichiers de la V9 test ont déjà été essayés sur Ubuntu, mais cette nouvelle modification n'a pas encore été testée sur la VM.

## API

Public, lecture seule :
- GET /api/public/status : dernier média choisi, prochain rendez-vous et
  vérification du mount Icecast si elle est configurée. Cela ne constitue
  pas encore une mesure indépendante du son entendu par les auditeurs.
- GET /api/public/schedule : prochaines occurrences programmées.

Administrateur, jeton requis :
- GET /api/admin/state : programmation, médiathèque et drapeaux `rotation_enabled`.
- POST /api/admin/rotation : `{ "media_path": "Musique/Mon titre.mp3", "enabled": true }`
  (jeton administrateur obligatoire, musique déjà indexée).
- POST /api/admin/scan : indexation des fichiers audio.
- POST /api/admin/rules : créer une programmation.
- POST /api/admin/folders : créer un nouveau sous-dossier dans une catégorie
  existante (parent + name), puis rafraîchir toutes les interfaces.
  Ex. {"parent":"Jingles","name":"Saint-Valentin"}.
  Le serveur valide les noms UTF-8, rejette les chemins dangereux et interdit
  d'écrire en dehors de la médiathèque.
- DELETE /api/admin/rules/{id} : supprimer une règle.
- PUT /api/admin/media/{category}/{sous-dossier}/{filename} : transférer un
  média directement vers un dossier existant sur le serveur, par petits blocs,
  sans écraser les médias existants.

Exemple de règle JSON :

    {"title":"Actu Gaming","media_path":"Chroniques/Actu Gaming/gaming.mp3",
     "local_time":"15:15","weekdays":[0,1,2,3,4,5,6]}

Le moteur vérifie les événements **au changement de piste**. Si une
chronique prévue à 15:15 trouve une chanson toujours en lecture, elle
passe après la chanson et un jingle. Une occurrence n'est pas rejouée
le même jour, et un retard supérieur à 90 minutes est ignoré par défaut.

## Site web et accès distant

La page GitHub Pages est statique. Elle ne peut pas appeler directement
une API HTTP sur le réseau local de la Freebox. Il faudra une passerelle
HTTPS publique pour les seuls endpoints de lecture, avec CORS limité aux
domaines autorisés. Le panneau /admin/ et les endpoints de modification
doivent rester protégés et non publics.

La configuration du site contient deux options, audioStreamUrl et
programApiUrl, encore vides. Leur activation attend une URL HTTPS testée :
**aucun changement n'est fait sur la radio publique aujourd'hui**.

## Points à finaliser avant mise en production

- Vérifier la compatibilité réelle du script Liquidsoap sur la VM et assurer
  les fondus/transitions du studio.
- Relier l'EXE V8.3 à l'entrée Harbor 18005 (code source Windows absent de ce
  dépôt) et vérifier la reprise du mode AUTO après déconnexion.
- Ajouter une mesure de l'audio réellement reçu par les auditeurs.
- Bloquer l'écriture sur le disque interne si le partage 2 To n'est pas monté.
- Valider les horaires Europe/Paris, les redémarrages, la résilience du proxy.
- Prévoir un onduleur pour Freebox/VM : une panne électrique de leur
  alimentation reste une coupure de diffusion.

## Nouveau dossier depuis la Remote et le Studio

Le panneau V9 (`/admin/`) propose dès maintenant « Nouveau sous-dossier » :
on choisit son dossier parent (ex. Jingles), on saisit Saint-Valentin et le
serveur crée `Jingles/Saint-Valentin`. Les listes sont réactualisées dans
l'interface, y compris lors d'une nouvelle connexion.

Pour le **Studio V8.3 Windows et la Remote actuels**, leur raccordement
à l'API V9 reste à effectuer : le code Windows n'est pas dans GitHub et la
Remote actuelle fonctionne encore avec sa signalisation Supabase. **Ne pas
injecter le jeton administrateur serveur dans le JavaScript public GitHub
Pages ni dans une clé partagée à tous les chroniqueurs.** Prévoir une API
d'actions médiathèque avec authentification nominative et permissions
(lecture, création de dossier, envoi de fichier), puis faire appeler
`POST /api/admin/folders` uniquement par la passerelle serveur autorisée.

Lorsque la Remote et le Studio sont raccordés, une création de dossier doit
apparaître dans leurs deux explorateurs sans duplication locale. Aucune
réorganisation des noms historiques ni déplacement de médias ne se fait
automatiquement pendant cette phase de développement.
