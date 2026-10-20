# Spécification EARS — Zer0Loot Battle Royale

Description du comportement **réellement implémenté** (déduite du code), au format EARS
(*Easy Approach to Requirements Syntax*). Les valeurs chiffrées viennent de [shared/rules.js](shared/rules.js),
[server/battle.js](server/battle.js), [server/game.js](server/game.js), [server/bets.js](server/bets.js),
[server/index.js](server/index.js) et [server/twitch.js](server/twitch.js).

## Conventions

| Motif EARS | Gabarit |
|---|---|
| Ubiquitaire | Le *système* doit … |
| Événementiel | **Quand** *événement*, le *système* doit … |
| État | **Tant que** *état*, le *système* doit … |
| Option | **Là où** *fonction présente/configurée*, le *système* doit … |
| Comportement non désiré | **Si** *condition indésirable*, **alors** le *système* doit … |
| Complexe | combinaison des motifs ci-dessus |

**Glossaire** — *Serveur* : processus Node (`server/index.js`). *Joueur* : utilisateur de rôle `player`. *Admin* : utilisateur de rôle `admin`.
*Fantôme* (`ghost`) : joueur créé automatiquement par un `!join` sans compte. *Combattant* : participant à une bataille en cours.
*File* : phase d'inscription. *Points* : points de compétence alloués dans une stat. *Chance effective* : `luck` dérivée.
*Phase* de bataille : `idle → queue → ready → battle → ended`.

---

## 1. Système et architecture

- **SYS-1** Le serveur doit servir les fichiers statiques de `public/` ainsi que `shared/` sous `/shared`.
- **SYS-2** Le serveur doit exposer `GET /healthz` répondant `{ ok: true }`.
- **SYS-3** Le serveur doit écouter sur `PORT` (3000 par défaut) sur l'interface `0.0.0.0`.
- **SYS-4** Le serveur doit faire confiance au premier proxy (`trust proxy = 1`).
- **SYS-5** Les règles d'équilibrage doivent résider uniquement dans `shared/rules.js`, utilisable à l'identique côté Node et navigateur (UMD, global `Rules`).
- **SYS-6** La simulation de combat doit être exécutée côté serveur ; les clients doivent se limiter à l'affichage des `frame` reçues. (vérification manuelle : propriété d'architecture)
- **SYS-7** Quand le processus reçoit `SIGINT` ou `SIGTERM`, le serveur doit écrire immédiatement la base sur disque puis se terminer.

## 2. Persistance

- **DB-1** Le serveur doit conserver tout l'état (`users`, `sessions`, `nextId`) en mémoire dans `db.state` ; l'état des paris (`bets`) y est ajouté à la demande par `server/bets.js` et sauvegardé avec le reste.
- **DB-2** Au démarrage, le serveur doit charger `DATA_DIR/db.json` s'il existe et créer `DATA_DIR` sinon (`./data` par défaut).
- **DB-3** Quand `db.save()` est appelé, le serveur doit différer l'écriture de 200 ms et regrouper les appels intermédiaires.
- **DB-4** Quand la base est écrite, le serveur doit écrire dans `db.json.tmp` puis renommer le fichier (écriture atomique).
- **DB-5** Quand `db.flush()` est appelé, le serveur doit écrire immédiatement et annuler l'écriture différée en attente.
- **DB-6** Les identifiants d'utilisateur doivent être des chaînes issues du compteur `nextId`.
- **DB-7** Quand un personnage chargé provient d'une ancienne sauvegarde, le serveur doit le compléter via `upgrade()` (champs `lootStats`, `stats`, `cls`, `counters`, `claimed`, `look`, `owned`, `title`, migration des slots `epee`/`bouclier` vers `arme`/`secondaire` avec `kind`).

## 3. Comptes et sessions

- **ACC-1** Quand une inscription est demandée, le serveur doit exiger un pseudo `^[A-Za-z0-9_\-]{3,20}$` et un mot de passe d'au moins 6 caractères.
- **ACC-2** Si le pseudo est déjà pris par un compte non fantôme, alors le serveur doit refuser l'inscription (400).
- **ACC-3** Quand une inscription réussit, le serveur doit créer un joueur avec un nouveau personnage et ouvrir une session.
- **ACC-4** Le serveur doit stocker les mots de passe sous la forme `sel:scrypt(64 octets)` et les comparer en temps constant.
- **ACC-5** Quand une connexion est demandée, le serveur doit comparer le pseudo sans tenir compte de la casse et ignorer les comptes fantômes.
- **ACC-6** Si les identifiants sont incorrects, alors le serveur doit répondre « Identifiants incorrects » (400).
- **ACC-7** Si le compte est banni, alors le serveur doit refuser la connexion (403).
- **ACC-8** Quand une session est créée, le serveur doit générer un jeton aléatoire de 32 octets, le stocker avec une expiration à 30 jours et le poser dans le cookie `zl_session` (`HttpOnly`, `SameSite=Lax`, `Path=/`, plus `Secure` en production).
- **ACC-9** Quand une requête arrive, le serveur doit résoudre l'utilisateur depuis le cookie et l'ignorer si la session est expirée, inconnue ou si l'utilisateur est banni.
- **ACC-10** Quand la déconnexion est demandée, le serveur doit supprimer la session et effacer le cookie.
- **ACC-11** Toutes les heures, le serveur doit purger les sessions expirées.
- **ACC-12** Les routes réservées aux joueurs doivent répondre 401 sans session et 403 si le rôle n'est pas `player` ; les routes admin doivent répondre 403 si le rôle n'est pas `admin`.
- **ACC-13** Au démarrage, si aucun admin n'existe, le serveur doit en créer un (`ADMIN_USERNAME`, défaut `admin`).
- **ACC-14** Là où `ADMIN_PASSWORD` est défini, le serveur doit réappliquer pseudo et mot de passe admin à chaque démarrage.
- **ACC-15** Si `NODE_ENV=production` et que `ADMIN_PASSWORD` est absent, alors le serveur doit générer un mot de passe aléatoire et l'afficher dans les logs, sans jamais utiliser `admin`.
- **ACC-16** Quand une action joueur via `action()` réussit, le serveur doit sauvegarder la base, pousser l'événement `me` au joueur et répondre `{ ok: true, … }` ; si elle lève une erreur, alors le serveur doit répondre 400 avec le message.

## 4. Liaison du compte Twitch

- **TWL-1** Là où `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET` sont définis, le serveur doit proposer la liaison OAuth Twitch (scope vide).
- **TWL-2** Quand un joueur démarre la liaison, le serveur doit créer un `state` aléatoire valable 10 minutes, associé au joueur, puis le rediriger vers Twitch.
- **TWL-3** Si le `state` est inconnu, expiré ou si le `code` manque au retour OAuth, alors le serveur doit rediriger vers `/character.html?twitch=error`.
- **TWL-4** Quand le retour OAuth est valide, le serveur doit échanger le code, lire le profil (`id`, `login`, `display_name`) et lier le compte.
- **TWL-5** L'URL de retour doit valoir `PUBLIC_URL` si défini, sinon `protocole://hôte` de la requête, suivi de `/auth/twitch/callback`.
- **TWL-6** La liaison « par pseudo » (`/api/twitch/link-dev`) ne doit être autorisée que si `ALLOW_DEV_LINK=1`, ou si le serveur n'est pas en production **et** que l'OAuth n'est pas configuré.
- **TWL-7** Si le login Twitch est déjà lié à un autre compte non fantôme, alors le serveur doit refuser la liaison.
- **TWL-8** Quand le login est déjà porté par un compte fantôme, le serveur doit fusionner le fantôme dans le compte du joueur : XP cumulée (niveaux convertis en XP), golds, coffres, inventaire, équipement, record (batailles/kills/victoires), `lootStats` et compteurs ; puis supprimer le fantôme.
- **TWL-9** Quand un joueur délie son Twitch, le serveur doit effacer `twitchLogin`, `twitchDisplayName` et `twitchId`.

## 5. Chat Twitch et bot

- **CHAT-1** Le serveur doit lire le chat de `TWITCH_CHANNEL` (défaut `zer0loot`) avec tmi.js, connexion sécurisée et reconnexion automatique, en anonyme par défaut.
- **CHAT-2** Là où `TWITCH_CHAT_DISABLED=1`, le serveur ne doit pas se connecter au chat.
- **CHAT-3** Quand un message commence par `!`, le serveur doit transmettre la commande (premier mot, en minuscules) et l'auteur (login, nom affiché, id).
- **CHAT-4** Quand la commande est `!join` et que la phase est `queue`, le serveur doit inscrire le viewer (en créant un fantôme si besoin).
- **CHAT-5** Si la phase n'est pas `queue`, alors `!join` doit être ignoré sans réponse.
- **CHAT-6** Si le viewer est banni, alors son `!join` doit être refusé.
- **CHAT-7** Là où `TWITCH_BOT_USERNAME` et `TWITCH_BOT_OAUTH` sont définis, le serveur doit se connecter avec ce compte (jeton préfixé par `oauth:` si besoin) ; `say()` ne doit écrire dans le chat que si `TWITCH_BOT_OAUTH` est défini et que le chat est connecté, sinon il ne doit rien faire.
- **CHAT-8** Quand un `!join` aboutit, le bot doit confirmer ; si le joueur est un fantôme, il doit ajouter l'invitation à créer un compte et lier son Twitch.
- **CHAT-9** Quand la file s'ouvre, le bot doit l'annoncer avec sa durée ; quand la bataille démarre, il doit l'annoncer (avec l'événement s'il y en a un) ; à la fin, il doit annoncer le vainqueur et ses kills, puis la cagnotte de paris redistribuée.
- **CHAT-10** Quand un abonnement (`subscription`, `resub` ou `subgift`) est reçu, le serveur doit créditer **300 golds** à l'abonné (ou au donateur pour un sub offert), incrémenter son compteur `subs`, lui émettre une récompense `sub` et remercier dans le chat.
- **CHAT-11** Si l'abonné est banni, alors la récompense de sub doit être ignorée.
- **CHAT-12** Toutes les 5 s, le serveur doit diffuser l'état Twitch (`channel`, `chatConnected`, `botCanSpeak`, `oauth`).

## 6. File d'attente

- **Q-1** Quand l'admin ouvre la file, le serveur doit borner la durée entre 10 et 3600 s (180 s par défaut).
- **Q-2** Si une bataille est en cours, alors l'ouverture de la file doit être refusée.
- **Q-3** Quand la file s'ouvre, le serveur doit vider les participants, l'événement et le résultat précédents, passer en phase `queue`, armer un minuteur de fermeture et émettre `cleared` (remboursement des paris).
- **Q-4** Quand le minuteur expire ou que l'admin ferme la file, le serveur doit passer en phase `ready` sans effacer les inscrits.
- **Q-5** Tant que la phase est `queue`, le serveur doit accepter les inscriptions ; chaque participant est identifié par une clé unique (`u<id>` ou `bot<n>`).
- **Q-6** Si la clé est déjà inscrite ou que la phase n'est pas `queue`, alors l'inscription doit être refusée sans erreur.
- **Q-7** Quand un joueur s'inscrit, le serveur doit capturer son nom (Twitch si lié), niveau, classe, titre, apparence, stats dérivées et visuel d'équipement.
- **Q-8** Quand la bataille démarre, le serveur doit rafraîchir les stats de chaque participant humain depuis la base (les changements faits pendant la file comptent).
- **Q-9** Quand l'admin ajoute des bots, le serveur doit en créer un nombre borné entre 1 et 50 (5 si la valeur est absente, nulle ou non numérique), uniquement en phase `queue` : niveau 1-6, points aléatoires hors Chance, équipement visuel aléatoire (40 % par slot), classe et apparence aléatoires, cosmétique 35 % du temps ; ils ne sont jamais sauvegardés.
- **Q-10** Quand l'admin simule un `!join`, le serveur doit valider le pseudo `^[A-Za-z0-9_]{3,25}$` et appliquer le même chemin qu'un vrai `!join`.
- **Q-11** Quand un joueur clique sur « Rejoindre » (`/api/queue/join`), le serveur doit l'inscrire s'il est en phase `queue`, sinon répondre 400.
- **Q-12** Le serveur ne doit révéler l'événement de bataille qu'à partir des phases `battle` et `ended`.

## 7. Bataille

### 7.1 Cycle de vie

- **B-1** Quand l'admin lance la bataille, le serveur doit exiger la phase `queue` ou `ready` et **au moins 2 combattants** (Battle Royale ; 1 suffit dans les modes coopératifs, voir MODE-3), sinon renvoyer une erreur.
- **B-2** Quand la bataille démarre, le serveur doit placer les combattants aléatoirement dans l'arène 1280×720 avec une marge de 60 px et une distance minimale de `clamp(√(aire/n)×0,6, 40, 140)` (60 essais max), puis émettre `start`.
- **B-3** Tant que la phase est `battle`, le serveur doit exécuter un tick toutes les 50 ms et diffuser un `frame` à chaque tick.
- **B-4** Quand l'admin réinitialise l'arène, le serveur doit arrêter la boucle, émettre `cleared` (remboursement des paris), effacer participants/combattants/résultat et passer en `idle`.
- **B-5** Quand `pendingEvent` vaut `random`, le serveur doit tirer un événement parmi `double`, `fog`, `fast`, `meteors` au lancement ; l'événement ne vaut que pour une bataille.

### 7.2 Comportement des combattants (à chaque tick)

- **B-6** Chaque combattant vivant doit cibler un ennemi : le plus proche, en multipliant la distance par `taunt` de l'ennemi (le Guerrier, `taunt = 0,7`, paraît plus proche).
- **B-7** L'Assassin (`hunter`) doit cibler l'ennemi minimisant `pv × (1 + distance/500)`.
- **B-8** Tant qu'un ennemi est dans le brouillard (événement `fog`) et à plus de 80 px, il ne doit pas être ciblable ; si aucun n'est visible, le combattant doit se rabattre sur la meilleure cible ignorant le brouillard.
- **B-9** Si la cible est hors de portée, le combattant doit avancer vers elle à sa vitesse, sans dépasser sa portée.
- **B-10** Si le combattant a un `kite` (Archer) et que la cible est plus proche que 110 px, alors il doit reculer à 80 % de sa vitesse.
- **B-11** Quand la cible est à portée et que le délai de recharge est écoulé, le combattant doit attaquer ; le délai initial est aléatoire (0 à 0,5 s).
- **B-12** Le serveur doit séparer les combattants qui se chevauchent (rayon 16 px ; plus grand pour le Troll et les chefs du donjon, qui poussent les petits plus qu'ils ne sont poussés) et les maintenir dans l'arène.
- **B-13** Tant que le Prêtre est vivant, le serveur doit lui rendre 1,5 % de sa vie max par seconde.

### 7.3 Attaque et dégâts

- **B-14** Quand un combattant attaque, la cible doit esquiver avec la probabilité `esquive × (1 − précision de l'attaquant)`.
- **B-15** Si l'attaque n'est pas esquivée, le serveur doit tirer un critique avec la probabilité `crit` ; les dégâts bruts valent `dégâts × (0,85 + aléa×0,3) × (critique ? 2 : 1)`.
- **B-16** Les dégâts infligés doivent valoir `max(1, round(brut × (1 − réduction de la cible)))`.
- **B-17** Quand des dégâts sont infligés, l'attaquant doit récupérer `dégâts × vol de vie` en vie, plafonnée à la vie max.
- **B-18** Quand des dégâts sont infligés, le serveur doit renvoyer `round(dégâts × épines)` à l'attaquant si ce montant est ≥ 1 ; l'attaquant peut mourir de ce renvoi, le tueur étant alors la cible.
- **B-19** Quand le Mage touche, le serveur doit infliger 60 % des dégâts bruts (avant défense) à tous les autres combattants vivants dans un rayon de 75 px autour de la cible.
- **B-20** Quand un combattant n'a plus de PV, le serveur doit le déclarer mort, enregistrer l'instant de mort et émettre `kill` si un tueur est connu.

### 7.4 Zone, événements et fin

- **B-21** À partir de 45 s, le serveur doit réduire la zone (centrée) d'un rayon max `√(w²+h²)/2` vers 70 px sur 60 s.
- **B-22** Tant qu'un combattant est hors zone, il doit subir `max(1, 5 % de la vie max × dt)` par seconde, sans tueur.
- **B-23** Si un dégât de zone ou de météore tuerait le dernier survivant, alors il ne doit pas être appliqué.
- **B-24** Quand tous les combattants sont morts simultanément, le serveur doit ressusciter celui qui est mort en dernier avec 1 PV et le désigner vainqueur ; en cas d'égalité exacte de l'instant de mort, c'est le premier de la liste des combattants (ordre d'inscription) qui est retenu.
- **B-25** Quand il reste au plus un combattant, ou que la durée dépasse 300 s, le serveur doit terminer la bataille ; à 300 s, le vainqueur est celui au meilleur ratio PV/PV max.
- **B-26** Quand la bataille se termine, le serveur doit passer en phase `ended`, calculer le classement (vainqueur, puis ordre inverse des morts), la durée, émettre `end` et un `queue` mis à jour.

### 7.5 Événements de bataille

- **EVT-1** Là où l'événement est `double`, le serveur doit multiplier par 2 l'XP, les golds et les coffres de toutes les récompenses de la bataille.
- **EVT-2** Là où l'événement est `fog`, le serveur doit créer une nappe toutes les 3 s (3 max, rayon 130-220 px, durée 9 s, apparition 1 s, disparition sur 3 s) ; une nappe n'est active que si son opacité dépasse 0,35.
- **EVT-3** Là où l'événement est `fast`, le serveur doit multiplier la vitesse de tous les combattants par 5.
- **EVT-4** Là où l'événement est `meteors`, le serveur doit lancer un météore toutes les 1,1 s (le premier à 2 s), 60 % du temps près d'un combattant vivant, avec 1,4 s entre l'alerte et l'impact (rayon 70 px, dégâts `12 + 15 % de la vie max`, ignorant la défense).

### 7.6 Séries de kills

- **STK-1** Quand un combattant fait le premier kill de la bataille, le serveur doit émettre la série `firstblood`.
- **STK-2** Quand un combattant enchaîne un 2ᵉ kill moins de 8 s après le précédent, le serveur doit émettre `double` ; au 3ᵉ enchaîné, `triple`.
- **STK-3** Quand un combattant atteint 5 kills dans la bataille, le serveur doit émettre `massacre`.

### 7.7 Modes de jeu

- **MODE-1** Il doit exister trois modes : `br` (Battle Royale, mode principal, chacun pour soi), `boss` (Combat de Boss, coopératif) et `dungeon` (Raid de Donjon, coopératif).
- **MODE-2** Quand l'admin ouvre la file, le serveur doit prendre le mode demandé (`br` par défaut), le conserver jusqu'à la prochaine ouverture et le diffuser dans l'état de la file ; si le mode est inconnu, alors l'ouverture doit être refusée.
- **MODE-3** Quand l'admin lance la partie, le serveur doit exiger au moins 2 combattants en Battle Royale et au moins 1 en mode coopératif.
- **MODE-4** Tant que le mode est coopératif, tous les combattants doivent former une seule équipe qui ne s'attaque pas elle-même ; un combattant ne cible que l'équipe adverse et les dégâts de zone (Mage, Troll) ne touchent que l'équipe adverse.
- **MODE-5** Tant que le mode est coopératif, le serveur ne doit appliquer ni événement de bataille (l'événement choisi attend la prochaine bataille royale), ni zone qui se referme, ni paris, ni récompense de kill ou de série (les kills de monstres ne rapportent rien en eux-mêmes et ne comptent pas dans le record de kills).
- **MODE-6** Quand une partie coopérative se termine, le serveur doit passer en `ended`, classer les combattants par dégâts infligés, émettre `coopEnd`, puis donner à chaque combattant humain (mort ou vivant) 25 XP de participation, +1 bataille et la récompense commune éventuelle, et diffuser `leaderboard`.

### 7.8 Combat de Boss

- **BOSS-1** Quand le Combat de Boss démarre, le serveur doit placer les combattants dans la partie gauche de l'arène et créer Grokk le Troll avec `200 + 300 × n` PV et `6 + 0,2 × n` dégâts (`n` = combattants au lancement), un rayon de 58 px, 15 % de réduction, 20 % de précision et 1,5 s de recharge.
- **BOSS-2** Quand le Troll frappe sa cible, il doit aussi infliger 50 % des dégâts bruts aux autres combattants situés à moins de 75 px de la cible.
- **BOSS-3** Le Troll doit lancer une attaque spéciale toutes les 6,5 s, annoncée au sol 1,3 s avant l'impact, en alternant l'onde de choc (rayon 150 px autour de lui) et le rocher (rayon 100 px, sur le combattant entouré du plus grand nombre d'alliés) ; l'impact inflige `dégâts × 1,1` (±10 %) à chaque combattant dans la zone.
- **BOSS-4** Quand la vie du Troll passe sous 66 % puis sous 33 %, il doit passer une phase : dégâts ×1,3, vitesse d'attaque ×1,35, attaques spéciales 20 % plus fréquentes ; le serveur émet l'événement `bossPhase`.
- **BOSS-5** À partir de 150 s de combat, le Troll doit entrer en rage finale : dégâts ×3.
- **BOSS-6** Quand le Troll meurt, la partie doit se terminer par une victoire ; si tous les combattants sont morts ou que la durée dépasse 300 s, par une défaite.
- **BOSS-7** Quand le Troll est vaincu, chaque combattant humain (mort ou vivant) doit gagner 3 coffres, 500 XP et 500 golds, et +1 au compteur `bossWins` ; en cas de défaite, seulement l'XP de participation.

### 7.9 Raid de Donjon

- **DNG-1** Le raid doit enchaîner des salles numérotées à partir de 1 ; une salle contient `clamp(round(n × (0,55 + 0,06 × (salle − 1))), 2, 36)` monstres (`n` = aventuriers au départ du raid), tirés parmi les types débloqués : gobelin et slime dès la salle 1, chauve-souris dès la 2, squelette archer dès la 3.
- **DNG-2** Les monstres doivent gagner +8 % de vie et +6 % de dégâts par salle ; toutes les 5 salles, l'un d'eux doit être un chef (vie ×5, dégâts ×1,5, taille ×1,9).
- **DNG-3** Chaque salle doit enchaîner : écran noir (1,8 s ; 1,2 s avant la première salle), entrée des aventuriers par la gauche (2 s, sans combat), combat, pause (1,3 s), sortie par la droite (2 s), puis la salle suivante.
- **DNG-4** Quand tous les monstres d'une salle sont morts, le serveur doit émettre `roomClear` et passer à la pause.
- **DNG-5** Un aventurier mort ne doit jamais réapparaître ; à l'entrée d'une nouvelle salle, les survivants doivent récupérer 30 % de leur vie max (sans dépasser le maximum).
- **DNG-6** Au-delà de 45 s de combat dans une même salle, les dégâts des monstres doivent augmenter de 5 % par seconde supplémentaire.
- **DNG-7** Quand tous les aventuriers sont morts, le raid doit se terminer ; la salle atteinte est celle où l'équipe est tombée.
- **DNG-8** La récompense commune doit dépendre du palier de 5 salles atteint : moins de 5 → rien ; 5 → 50 XP et 50 golds ; 10 → 150 / 150 ; 15 → 1 coffre, 300 / 300 ; 20 → 2 coffres, 500 / 500 ; ensuite +1 coffre et +250 XP / golds tous les 5 salles. Le compteur `dungeonBest` doit garder la meilleure salle atteinte.

## 8. Classes

- **CLS-1** Il doit exister cinq classes : Guerriloot (guerrier), Archiloot (archer), Magiloot (mage), Lootassin (assassin), Saint-Loot (prêtre). Un personnage sans classe est un « Vagaloot » neutre (portée 40).
- **CLS-2** Chaque classe doit définir bonus % de stats, bonus plats, comportement de combat, une arme et un objet secondaire exclusifs :

| Classe | Bonus / malus | Combat | Arme · secondaire |
|---|---|---|---|
| Guerrier | Vie +30 %, Défense +25 % | portée 40, `taunt` 0,7 | épée · bouclier |
| Archer | Vie −10 %, Force −15 %, Précision +15 pts | portée 230, recule < 110, flèche | arc · carquois |
| Mage | Vie −15 %, Force +25 % | portée 170, boule de feu, AoE 75 px × 60 %, recharge ×1,35 | bâton · grimoire |
| Assassin | Vie −15 %, Vitesse d'attaque +25 %, Critique +10 pts | portée 36, traque le plus faible | dagues · dague de parade |
| Prêtre | Vie +10 %, Défense +10 %, Force −10 % | portée 40, régénère 1,5 %/s | masse · relique |

- **CLS-3** Quand un joueur choisit sa première classe, le serveur doit l'attribuer gratuitement.
- **CLS-4** Quand un joueur change de classe, le serveur doit débiter 100 golds ; si les golds sont insuffisants, alors il doit refuser.
- **CLS-5** Si la classe demandée est inconnue ou identique à l'actuelle, alors le serveur doit refuser.
- **CLS-6** Quand la classe change, le serveur doit renvoyer à l'inventaire les objets équipés incompatibles avec la nouvelle classe.

## 9. Stats et valeurs dérivées

- **STAT-1** Il doit exister 11 stats : vie, force, défense, vitesse, esquive, critique, vitesse d'attaque, vol de vie, précision, épines, chance.
- **STAT-2** Le serveur doit calculer les valeurs dérivées à partir des points (compétences + bonus de panoplie), des bonus % d'équipement et des bonus de classe ; le multiplicateur d'une stat vaut `max(0, 1 + (équipement% + classe%)/100)`.
- **STAT-3** Formules : PV max `(100 + 10·vie)×m` ; dégâts `(10 + 2·force)×m` ; armure `(5 + 3·déf)×m` et réduction `armure/(armure+100)` ; vitesse `min(220, (60 + 5·vit)×m)` ; esquive `min(0,6, r/(r+100))` avec `r = (5 + 3·esq)×m`.
- **STAT-4** Formules : critique `min(0,60, (1 + 2·crit)×m/100 + plat classe)`, dégâts ×2 ; vitesse d'attaque `min(2,5, (1 + 0,05·va)×m)` et recharge `1 s × cooldownMult / vitesse` ; vol de vie `min(0,4, (2 + 1,5·vdv)×m/100)` ; précision `min(0,8, (5 + 3·pré)×m/100 + plat classe)` ; épines `min(0,5, (2 + 2·ép)×m/100)`.
- **STAT-5** La chance effective doit valoir `points + bonus d'équipement` (les % d'équipement s'**ajoutent** en points pour la Chance et ne multiplient pas).
- **STAT-6** Quand un joueur alloue un point, le serveur doit exiger un point de compétence disponible et une stat connue, puis retirer 1 point et ajouter 1 à la stat.

## 10. Progression et récompenses

- **PRG-1** L'XP nécessaire pour passer du niveau `n` au suivant doit valoir `300 + 200·(n−1)`.
- **PRG-2** Quand de l'XP est ajoutée, le serveur doit enchaîner les passages de niveau et donner 1 point de compétence par niveau.
- **PRG-3** Quand un joueur fait un kill, il doit gagner 100 XP, 1 coffre, 10 golds, et son record de kills augmente.
- **PRG-4** Quand la bataille se termine, chaque combattant humain doit gagner 25 XP de participation et +1 bataille ; le vainqueur doit en plus gagner 300 XP, 1 coffre, 30 golds et +1 victoire.
- **PRG-5** Quand une série est déclenchée, le serveur doit créditer : `firstblood` +1 coffre ; `double` +1 coffre ; `massacre` +2 coffres ; `triple` aucune récompense (annonce seule) ; et incrémenter le compteur de succès correspondant (sauf `triple`).
- **PRG-6** Les bots, qui n'ont pas de `userId`, ne doivent recevoir aucune récompense.
- **PRG-7** Quand une récompense est attribuée, le serveur doit émettre `reward` au joueur avec le type, les montants et le nombre de niveaux gagnés.
- **PRG-8** Quand l'admin donne des ressources, le serveur doit borner chaque montant entre 0 et 10 000 000, refuser « rien à donner » et émettre une récompense `gift`.

## 11. Équipement, loot et coffres

- **LOOT-1** Il doit exister 8 emplacements : casque, plastron, gants, ceinture, pantalon, boucles, arme, secondaire.
- **LOOT-2** Il doit exister 5 raretés avec lignes de stats, fourchette de valeur et clics d'ouverture : Commun (1 ligne, 1-3, 3 clics), Peu commun (2, 4-6, 5), Rare (3, 7-10, 10), Épique (4, 11-15, 20), Légendaire (5, 15-25, 30).
- **LOOT-3** La table de loot doit valoir, pour une chance `l` bornée à [0 ; 85], `[90, 6, 3, 0,9, 0,1] + l × [−1, +0,4, +0,3, +0,21, +0,09]` (%), arrondie à 0,01.
- **LOOT-4** Quand un objet est créé, le serveur doit tirer ses stats sans doublon selon les poids de prédilection de l'emplacement ou du type d'arme, avec un générateur cryptographique.
- **LOOT-5** Pour les emplacements `arme` et `secondaire`, le serveur doit choisir le type de l'objet : celui de la classe du joueur avec 50 % de chance (100 % à la fusion), sinon un type aléatoire de l'emplacement.
- **LOOT-6** Quand un objet est créé, il doit appartenir à une panoplie avec la probabilité 5 / 8 / 12 / 18 / 25 % selon la rareté.
- **LOOT-7** Le nom d'un objet doit être `<base> <préfixe de rareté> <suffixe>` ; le suffixe est celui de la panoplie si elle existe, sinon celui de la première stat.
- **CHEST-1** Quand un joueur achète des coffres, le serveur doit débiter 100 golds par coffre (quantité ≥ 1) et refuser si les golds sont insuffisants.
- **CHEST-2** Quand un joueur ouvre un coffre, le serveur doit exiger au moins un coffre, en consommer un, créer 3 objets (rareté tirée selon sa chance effective), les ajouter à l'inventaire illimité, mettre à jour `lootStats` et les compteurs `chests` et `legendary`, puis renvoyer la meilleure rareté et le nombre de clics requis.
- **CHEST-3** Le client doit animer l'ouverture : lumières blanc, vert (4ᵉ clic), bleu (6ᵉ), violet (11ᵉ), orange (21ᵉ) ; l'ouverture est déjà décidée côté serveur.
- **EQP-1** Quand un joueur équipe un objet, le serveur doit exiger que l'objet soit dans l'inventaire et compatible avec sa classe, puis renvoyer l'objet précédent du même emplacement à l'inventaire.
- **EQP-2** Quand un joueur déséquipe un emplacement, le serveur doit renvoyer l'objet à l'inventaire, ou refuser si l'emplacement est vide.
- **EQP-3** Quand un joueur recycle des objets de son inventaire, le serveur doit les supprimer et créditer 3 golds par objet quelle que soit la rareté, et incrémenter le compteur `recycled` ; si aucun objet n'est trouvé, alors il doit refuser.

## 12. Forge

- **FRG-1** Quand un joueur fusionne, le serveur doit exiger exactement 3 objets distincts de son inventaire, de même rareté.
- **FRG-2** Le serveur doit monter d'une rareté avec la probabilité `base + min(25, 0,5 × chance effective)` où la base vaut 40 / 30 / 20 / 10 / 0 % (Commun → Légendaire) ; un Légendaire reste Légendaire.
- **FRG-3** Quand la fusion réussit, le serveur doit détruire les 3 objets, créer un objet pour la classe du joueur, incrémenter `fused` (et `legendary` si Légendaire) et renvoyer l'objet, le succès de la montée, la chance et la rareté d'origine.
- **FRG-4** Si les 3 objets fusionnés appartiennent à la même panoplie, alors l'objet créé doit en faire partie.
- **FRG-5** Quand un joueur relance une ligne (objet équipé ou en inventaire), le serveur doit débiter 10 / 20 / 40 / 80 / 150 golds selon la rareté, remplacer la ligne par une stat absente de l'objet avec une nouvelle valeur dans la fourchette de rareté, et incrémenter `rerolled`.
- **FRG-6** Si la ligne est invalide, que les golds manquent ou qu'aucune autre stat n'est possible, alors le serveur doit refuser sans débiter.

## 13. Panoplies

- **SET-1** Il doit exister 6 panoplies (Nosferatu, Bastion, Ouragan, Œil de Lynx, Fortune, Ronces), chacune liée à deux stats.
- **SET-2** Quand des pièces d'une même panoplie sont équipées, le serveur doit ajouter des points dans chacune de ses deux stats selon le palier : 2 pièces → +2, 4 → +4, 6 → +7, 8 → +10.

## 14. Paris

- **BET-1** Tant que la phase est `queue` ou `ready` et que le mode est le Battle Royale, le serveur doit accepter les paris ; ils sont fermés dès `battle` et `ended`, et toujours dans les modes coopératifs.
- **BET-2** Quand un joueur parie, le serveur doit exiger une mise entière ≥ 1, un combattant inscrit, et que ce ne soit pas lui-même.
- **BET-3** Quand un joueur parie, le serveur doit retirer la mise immédiatement et sauvegarder ; il ne doit y avoir qu'un pari par joueur.
- **BET-4** Quand un joueur modifie son pari, le serveur doit lui rendre l'ancienne mise avant de débiter la nouvelle (les golds disponibles incluent l'ancienne mise).
- **BET-5** Quand un joueur annule son pari, le serveur doit le rembourser, ou refuser s'il n'a pas de pari ou si les paris sont fermés.
- **BET-6** Quand un pari change, le serveur doit diffuser la file mise à jour, avec la cagnotte, le nombre de parieurs et les totaux par cible, sans révéler qui a misé quoi.
- **BET-7** Quand la bataille a un vainqueur auquel des paris sont attachés, le serveur doit verser à chaque gagnant sa mise + une part des mises perdues proportionnelle à sa mise, par répartition entière au plus fort reste, sans perte de gold.
- **BET-8** Si personne n'a parié sur le vainqueur, ou s'il n'y a pas de vainqueur, alors le serveur doit rembourser toutes les mises.
- **BET-9** Quand la file est rouverte, l'arène réinitialisée, un combattant banni, ou après un redémarrage du serveur, le serveur doit rembourser les paris concernés (au redémarrage : tous).
- **BET-10** Quand un pari est gagné, le serveur doit incrémenter le compteur `betsWon` du joueur et lui émettre le résultat `bet`.
- **BET-11** Après règlement, le serveur doit vider la liste des paris et conserver le dernier résultat (vainqueur, cagnotte, gagnants, distribué) pour l'affichage.

## 15. Succès et titres

- **ACH-1** Le serveur doit suivre les métriques `battles`, `kills`, `wins`, `level`, `cosmetics`, `setPieces` et les compteurs `chests`, `legendary`, `recycled`, `fused`, `rerolled`, `betsWon`, `firstblood`, `double`, `massacre`, `subs`, `bossWins` et `dungeonBest` (meilleure salle du donjon ; lors de la fusion d'un fantôme, on garde le maximum au lieu d'additionner).
- **ACH-2** Quand un succès atteint son objectif, le joueur doit pouvoir récupérer une seule fois sa récompense en golds ; sinon (non terminé ou déjà récupéré), le serveur doit refuser.
- **ACH-3** Quand un joueur choisit un titre, le serveur doit exiger un succès terminé ; le titre est le nom du succès et s'affiche sous le pseudo et dans les classements.

## 16. Apparence et boutique

- **LOOK-1** Le serveur doit permettre gratuitement de changer la couleur (15 teintes, ou `null` = automatique), les yeux, les sourcils et la bouche parmi des options connues.
- **LOOK-2** Quand un joueur achète un cosmétique (chapeau, cape, chaussures, accessoire, aura), le serveur doit débiter son prix, l'ajouter aux articles possédés et l'équiper ; il doit refuser un article déjà possédé ou trop cher.
- **LOOK-3** Quand un joueur équipe un cosmétique, le serveur doit exiger qu'il le possède et que l'emplacement corresponde ; `null` retire l'article.
- **LOOK-4** Les cosmétiques doivent rester purement visuels (un chapeau remplace l'apparence du casque sans retirer ses stats).

## 17. Classements

- **LB-1** Le serveur doit calculer trois classements (victoires, kills, batailles), limités à 10 entrées, hors joueurs bannis et hors valeurs nulles, départagés par niveau.
- **LB-2** Quand une bataille se termine, qu'un titre change ou qu'un bannissement est modifié, le serveur doit diffuser `leaderboard`.

## 18. Administration

- **ADM-1** L'admin doit pouvoir choisir le mode de jeu avant d'ouvrir la file, ouvrir/fermer la file, lancer ou réinitialiser la bataille, choisir l'événement de la prochaine bataille (aucun, aléatoire ou l'un des quatre), ajouter des bots, simuler `!join` et sub.
- **ADM-2** L'admin doit pouvoir lister les joueurs (nom, pseudo, Twitch, fantôme, banni, classe, niveau, golds, coffres, record, titre).
- **ADM-3** Quand l'admin donne des ressources à un joueur, le serveur doit l'appliquer et notifier le joueur.
- **ADM-4** Quand l'admin bannit un joueur, le serveur doit supprimer ses sessions, lui émettre `banned`, et, si une file est en cours, le retirer des participants et rembourser son pari et les paris placés sur lui.
- **ADM-5** Si le joueur ciblé n'existe pas ou n'est pas un joueur, alors l'admin doit recevoir « Joueur introuvable ».

## 19. Temps réel (Socket.IO)

- **RT-1** Quand un client se connecte, le serveur doit l'ajouter à la room `user:<id>` s'il a une session valide, puis lui envoyer l'état de la file et un `frame`.
- **RT-2** Le serveur doit diffuser à tous : `queue`, `frame`, `leaderboard`, `twitch`.
- **RT-3** Le serveur doit envoyer à la room d'un joueur : `me` (vue complète du personnage et pari), `reward`, `bet`, `banned`.

## 20. Interface

Ces exigences se vérifient dans un navigateur (skill `smoke-arena`) : elles sont marquées « (vérification manuelle) » et le script `spec:coverage` ne les compte pas comme manquantes.

- **UI-1** `/` doit permettre l'inscription et la connexion. (vérification manuelle)
- **UI-2** `/character.html` doit proposer les onglets Personnage, Inventaire, Boutique, Succès, Classements et Règles, ainsi que l'inscription à la file et les paris. (vérification manuelle)
- **UI-3** `/admin.html` doit afficher l'arène, les contrôles de file, les événements, les inscrits, les outils de test, la liste des joueurs et les classements. (vérification manuelle)
- **UI-4** `/arena.html` doit afficher uniquement l'arène en plein écran pour une source navigateur OBS (1280×720 ou 1920×1080), avec annonces de séries et sons. (vérification manuelle)
- **UI-6** Pour les modes coopératifs, l'arène doit afficher le mode sur l'écran de file, la grosse barre de vie du Troll avec ses coches à 66 % et 33 %, les zones d'attaque spéciale au sol, l'explosion du Troll suivie d'une pluie de coffres et de golds, la salle de donjon (dallage, torches) avec fondu au noir et grand « SALLE X », et un écran de fin commun (récompense, meilleurs dégâts) ; la page admin propose le choix du mode et l'onglet Règles explique les deux modes et leurs récompenses. (vérification manuelle)
- **UI-5** Les pages doivent être en français, sans framework ni étape de build, les scripts étant chargés dans l'ordre des dépendances. (vérification manuelle)

## 21. Déploiement et configuration

- **DEP-1** Le serveur doit être configurable par variables d'environnement : `PORT`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `TWITCH_CHANNEL`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `PUBLIC_URL`, `TWITCH_BOT_USERNAME`, `TWITCH_BOT_OAUTH`, `ALLOW_DEV_LINK`, `TWITCH_CHAT_DISABLED`, `DATA_DIR`, `NODE_ENV`.
- **DEP-2** Là où `NODE_ENV=production`, le serveur doit poser des cookies `Secure`, refuser le mot de passe admin par défaut et désactiver la liaison par pseudo (sauf `ALLOW_DEV_LINK=1`).
- **DEP-3** L'image Docker (Node 22 Alpine) doit définir `NODE_ENV=production` et `DATA_DIR=/data`, installer sans dépendances de développement et embarquer `server`, `shared` et `public`.
- **DEP-4** Railway doit utiliser `/healthz` comme sonde, redémarrer en cas d'échec et ne faire tourner qu'une seule réplique (l'état est en mémoire).
- **DEP-5** Un volume persistant doit être monté sur `/data` dans l'interface Railway, sans quoi la base est perdue à chaque déploiement (voir `DEPLOIEMENT.md`). (vérification manuelle)

## 22. Exigences non fonctionnelles

- **NFR-1** Les tirages de loot et de forge doivent utiliser `crypto` (aléa cryptographique) ; la simulation de combat utilise `Math.random`.
- **NFR-2** Le serveur ne doit jamais écrire la base de façon partielle (fichier temporaire puis renommage).
- **NFR-3** Les golds engagés dans un pari ne doivent jamais pouvoir être dépensés deux fois.
- **NFR-4** Les formules d'équilibrage doivent être couvertes par les tests de `test/*.test.js` (`npm test`), dont le nom est préfixé par les identifiants de cette spécification (ex. `[BET-7]`).
