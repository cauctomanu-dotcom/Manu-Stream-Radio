MANU STREAM RADIO — ARCHIVE DE RÉCUPÉRATION STABLE
15 septembre 2026

BUT
Cette archive contourne le blocage « Ouverture de la régie… » en utilisant un lanceur local neuf qui sert explicitement index.html, style.css ET app.js.

UTILISATION
1. Fermer les anciennes fenêtres Manu Stream Radio si elles sont encore ouvertes.
2. Extraire TOUTE l'archive dans un dossier normal de Windows (Bureau, Documents, etc.).
3. Ne pas déplacer l'EXE tout seul : le dossier « web » doit rester à côté.
4. Double-cliquer sur Manu-Stream-Radio-RECOVERY-STABLE.exe.
5. Microsoft Edge doit s'ouvrir automatiquement en mode application.

DONNÉES LOCALES
Le lanceur essaie d'utiliser d'abord 127.0.0.1:17340 afin de retrouver le même origin navigateur et donc les données locales déjà enregistrées quand elles sont présentes dans le profil Edge utilisé.
Si une ancienne instance MSR bloquée occupe encore ce port, le lanceur tente de la fermer proprement avant de démarrer.

DIAGNOSTIC
Un fichier msr-recovery.log est créé à côté de l'EXE. Il permet de voir immédiatement si un fichier manque ou si le port local est occupé.

OVERLAY
L'overlay local est servi par le nouveau lanceur et son état temps réel est pris en charge.

STREAMLABS REMOTE CONTROL
Cette archive de récupération remet d'abord la régie audio locale en état de démarrage. Le Remote Control Streamlabs n'est pas inclus dans ce lanceur de secours ; la régie reste utilisable localement et Streamlabs peut toujours capturer la fenêtre / le son comme auparavant.

IMPORTANT
Aucune mise à jour automatique n'est effectuée par ce lanceur.
