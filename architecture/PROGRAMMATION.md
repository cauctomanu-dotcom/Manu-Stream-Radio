# Programmation Manu Stream Radio

## 1. Conducteur LIVE

Le conducteur LIVE sert aux émissions animées en direct.

Chaque élément du conducteur peut fonctionner de deux façons :

- **enchaînement libre** : pas d'heure imposée, le bloc suit simplement le précédent ;
- **heure cible** : le bloc possède une heure prévue et peut être glissé sur une timeline horaire.

L'interface doit afficher :

- heure prévue ;
- heure réelle de démarrage ;
- avance ou retard ;
- compte à rebours avant la prochaine étape ;
- glisser-déposer pour réordonner les blocs.

Le bloc actuellement à l'antenne reste verrouillé pour éviter une modification accidentelle.

## 2. Programmation 24H

La programmation 24H est indépendante du conducteur LIVE et possède son propre onglet.

Elle couvre la journée de 00:00 à 23:59 avec une grille horaire. Elle peut contenir :

- rotation musicale ;
- titre précis ;
- jingle ;
- publicité ;
- émission préenregistrée ;
- pause ou habillage ;
- reprise automatique après une émission LIVE.

Le moteur 24H surveille l'heure système tant que Manu Stream Radio est ouvert.

### Démarrage automatique

L'utilisateur n'a pas besoin de cliquer exactement à l'heure prévue. Si l'application est ouverte et qu'un élément programmé doit être en cours, le moteur doit reprendre automatiquement la programmation correspondante.

Pour un média long déjà commencé, le comportement cible est un **rattrapage horaire** : démarrer au bon décalage dans le média lorsque cela est techniquement possible afin de rester calé sur la grille.

Si Windows est éteint, en veille profonde ou si l'application est fermée, aucune diffusion locale ne peut démarrer.

## 3. Fin d'un LIVE

Quand un direct se termine, deux commandes distinctes sont proposées :

### PASSER EN PROGRAMMATION AUTOMATIQUE

- coupe les micros / la partie LIVE avec transition propre ;
- garde l'antenne active ;
- rejoint immédiatement le programme 24H correspondant à l'heure actuelle ;
- conserve Streamlabs en diffusion si celui-ci est utilisé comme transport du direct.

### ARRÊTER TOUTE DIFFUSION

- arrête le conducteur LIVE ;
- arrête la programmation 24H ;
- arrête les lecteurs et le Master ;
- remet l'état antenne sur OFF AIR ;
- arrête le live Streamlabs lorsqu'il est connecté ;
- arrête l'enregistrement associé si l'utilisateur confirme l'arrêt total.

## 4. Page auditeurs

La page GitHub Pages utilise un lecteur unique. L'auditeur ne choisit pas Twitch ou YouTube.

Ordre de préférence prévu :

1. flux radio audio direct ;
2. Twitch intégré ;
3. YouTube intégré ;
4. écran hors antenne si aucune source n'est disponible.

GitHub Pages reste uniquement la façade publique. Un véritable flux audio H24 indépendant nécessitera toujours un serveur de streaming (par exemple AzuraCast / Icecast) lors de la phase serveur.
