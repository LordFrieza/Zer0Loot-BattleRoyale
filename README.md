# ⚔️ Zer0Loot Battle Royale

Mini-jeu web relié au chat Twitch de [twitch.tv/zer0loot](https://www.twitch.tv/zer0loot).
Le streamer ouvre une file, les viewers tapent `!join`, puis leurs petits personnages s'affrontent
automatiquement à l'écran. Chaque kill rapporte de l'XP, des golds et des coffres de LOOT.

> 🚀 **Mettre le jeu en ligne 24 h/24** : suis le guide pas à pas [DEPLOIEMENT.md](DEPLOIEMENT.md).

## Lancer le prototype (sur ton PC)

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
npm install
npm start
```

Ouvre ensuite <http://localhost:3000>.

| Page | Rôle |
|---|---|
| `/` | Connexion / création de compte |
| `/character.html` | Page du joueur : stats, équipement, coffres, inventaire, explication de la chance |
| `/admin.html` | Écran de combat + contrôle de la file (compte admin) |
| `/arena.html` | Arène seule, plein écran : à ajouter dans OBS comme **Source navigateur** (1280×720 ou 1920×1080) |

**Compte admin par défaut : `admin` / `admin`.** Change-le avec la variable `ADMIN_PASSWORD` avant toute mise en ligne.

### Tester sans viewers

Dans la page admin, la section « Tests » permet :
- d'ajouter des **bots** (non sauvegardés) dans la file ;
- de **simuler un `!join`** d'un pseudo Twitch (exactement comme si la personne l'avait tapé dans le chat).

## Configuration (variables d'environnement)

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port du serveur web |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin` | Compte admin |
| `TWITCH_CHANNEL` | `zer0loot` | Chaîne dont le chat est écouté pour `!join` |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | — | Application Twitch pour le bouton « Se connecter avec Twitch » |
| `PUBLIC_URL` | URL de la requête | URL publique du site (sert à construire l'URL de retour OAuth) |
| `TWITCH_BOT_USERNAME` / `TWITCH_BOT_OAUTH` | — | Optionnel : compte bot qui répond dans le chat |
| `ALLOW_DEV_LINK` | — | `1` pour garder la liaison « par pseudo » même avec l'OAuth configuré |
| `TWITCH_CHAT_DISABLED` | — | `1` pour ne pas se connecter au chat (tests hors ligne) |
| `DATA_DIR` | `./data` | Dossier de sauvegarde (`db.json`) |
| `NODE_ENV` | — | `production` en ligne (déjà réglé dans le `Dockerfile`) : cookies sécurisés, pas de mot de passe admin par défaut, liaison par pseudo désactivée |

Exemple : `ADMIN_PASSWORD=monSuperMdp npm start`

### Lecture du chat (`!join`)

Aucune configuration n'est nécessaire : le serveur lit le chat de `#zer0loot` en **anonyme**.
Le point vert en haut de la page admin indique que la connexion au chat fonctionne.

### Liaison du compte Twitch (OAuth)

1. Crée une application sur <https://dev.twitch.tv/console/apps>.
2. URL de redirection OAuth : `http://localhost:3000/auth/twitch/callback` (ou `https://ton-domaine/auth/twitch/callback`).
3. Lance le serveur avec `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (et `PUBLIC_URL` en ligne).

Sans ces variables, la page perso propose une **liaison par pseudo** (mode test, pas de vérification).
Cette liaison est désactivée en production (sauf `ALLOW_DEV_LINK=1`).

### Bot qui répond dans le chat (optionnel)

Avec `TWITCH_BOT_USERNAME` et `TWITCH_BOT_OAUTH` (token `chat:read chat:edit`), le bot annonce l'ouverture
de la file, confirme les `!join` et annonce le vainqueur.

## Règles implémentées

- **File** : l'admin ouvre la file pour X minutes ; `!join` dans le chat (ou le bouton « Rejoindre » du site) inscrit le joueur.
  À la fin du compteur la file se ferme et l'admin lance la bataille quand il veut (2 combattants minimum).
- **Viewers sans compte** : un `!join` crée un personnage rattaché au pseudo Twitch. Quand la personne crée un compte et lie
  son Twitch, elle récupère tout (XP, golds, coffres, objets).
- **Classes** : à la première visite, le joueur choisit sa classe (gratuit), puis peut en changer pour 100 golds.
  | Classe | Combat | Bonus / malus | Arme · secondaire |
  |---|---|---|---|
  | ⚔️ Guerrier | Corps à corps, attire l'aggro | +30 % Vie, +25 % Défense | Épée · Bouclier |
  | 🏹 Archer | À distance (230 px), recule si un ennemi approche | +15 pts Précision, −10 % Vie, −15 % Dégâts | Arc · Carquois |
  | 🔮 Mage | À distance (170 px), explosion : 60 % des dégâts autour de la cible | +25 % Dégâts, −15 % Vie, attaque 35 % plus lente | Bâton · Grimoire |
  | 🗡️ Assassin | Traque l'ennemi le plus faible | +10 pts Critique, +25 % Vitesse d'attaque, −15 % Vie | Dagues · Dague de parade |
  | ✨ Prêtre | Corps à corps, régénère 1,5 % de sa vie / s | +10 % Vie, +10 % Défense, −10 % Dégâts | Masse · Relique |

  Les armes et objets secondaires sont **réservés à leur classe**. Dans les coffres, ils sont pour ta classe 1 fois sur 2
  (sinon une classe au hasard). En changeant de classe, les objets incompatibles retournent dans le coffre personnel.
  Les anciennes épées / anciens boucliers (d'avant les classes) sont devenus des objets de Guerrier.
- **Combat** : placements aléatoires, chaque perso prend en aggro l'ennemi le plus proche (sauf l'Assassin).
  Après 45 s, une zone se referme pour éviter les combats interminables.
- **Récompenses** : kill = 100 XP + 1 coffre + 10 golds ; victoire = 300 XP + 1 coffre + 30 golds ;
  participation = 25 XP pour chaque combattant à la fin de la bataille (gagnant compris, pas si l'admin annule).
- **Séries de kills** (annoncées en grand sur le stream avec un son) : premier kill de la bataille = +1 coffre ;
  double kill (2 kills d'affilée en moins de 8 s) = +1 coffre ; triple kill = annonce seulement ;
  massacre (5 kills dans la bataille) = +2 coffres.
- **Niveaux** : il faut 300 XP pour passer niveau 2, puis 200 XP de plus à chaque niveau (300, 500, 700, 900…) ; chaque niveau donne 1 point de compétence.
- **Stats** (valeurs de base, chaque point en plus, puis × les bonus % d'équipement et de classe) :
  - Vie : 100 PV + 10 par point
  - Force : 10 dégâts + 2 par point
  - Défense : armure 5 + 3 par point → réduction des dégâts `armure / (armure + 100)`
  - Vitesse : 60 px/s + 5 par point (plafond 220)
  - Esquive : 5 + 3 par point → chance d'esquive `valeur / (valeur + 100)`, plafond 60 %
  - Critique : 1 % + 2 % par point, plafond 60 % ; un coup critique inflige le double de dégâts
  - Vitesse d'attaque : 1 attaque / s, +5 % par point, plafond ×2,5
  - Vol de vie : 2 % + 1,5 % par point des dégâts infligés rendus en vie, plafond 40 %
  - Précision : 5 % + 3 % par point → réduit d'autant l'esquive de la cible, plafond 80 %
  - Épines : 2 % + 2 % par point des dégâts reçus renvoyés à l'attaquant, plafond 50 %
  - Chance : points × bonus d'équipement → modifie la table de loot
- **Table de loot** : chance 0 → 90 / 6 / 3 / 0,9 / 0,1 % ; chance 10 → 80 / 10 / 6 / 3 / 1 %.
  Variation linéaire par point de chance, plafonnée à 85 de chance effective.
- **Objets** : 8 emplacements (casque, plastron, gants, ceinture, pantalon, boucles d'oreilles, arme, main secondaire).
  Commun 1 ligne (+1–3 %), Peu commun 2 (+4–6 %), Rare 3 (+7–10 %), Épique 4 (+11–15 %), Légendaire 5 (+15–25 %).
  Chaque emplacement / type d'arme a ses stats de prédilection (ex. plastron → Vie/Défense/Épines, arc → Précision,
  dagues → Critique/Vitesse d'attaque, boucles → Chance).
- **Forge** :
  - Fusion : 3 objets de même rareté → 1 nouvel objet, toujours équipable par ta classe. Chance de monter d'une rareté :
    40 % (Commun), 30 % (Peu commun), 20 % (Rare), 10 % (Épique), + 0,5 % par point de chance effective (max +25 %).
    Sinon, nouvel objet de même rareté. 3 Légendaires → un nouveau Légendaire.
  - Relance : remplace une ligne d'un objet (équipé ou non) par une autre stat au hasard, absente de l'objet.
    Prix : 10 / 20 / 40 / 80 / 150 golds selon la rareté.
- **Coffres** : 3 objets par coffre, achat 100 golds, stockage illimité. Clics pour ouvrir selon la meilleure rareté :
  3 / 5 / 10 / 20 / 30. Lumières : blanc, puis vert (4ᵉ clic), bleu (6ᵉ), violet (11ᵉ), orange (21ᵉ).
- **Paris** : dès que la file est ouverte, chaque joueur voit les combattants inscrits dans l'encart « 🎲 Paris » de sa
  page perso et peut miser des golds sur **un** combattant (pas sur lui-même). La mise est retirée immédiatement ; le pari
  peut être modifié ou annulé jusqu'au lancement du combat, où les paris ferment. Si le combattant choisi gagne, le parieur
  récupère sa mise + une part des mises perdues au prorata de sa mise parmi les gagnants (1 contre 9 → 10 % / 90 %),
  répartie en golds entiers sans perte. Si personne n'a parié sur le gagnant, si la bataille est annulée ou si le serveur
  redémarre pendant la file, toutes les mises sont remboursées. La cagnotte s'affiche aussi sur l'écran de stream.
- **Tirages** : générateur aléatoire cryptographique ; un test statistique (`npm test`) vérifie que les fréquences
  observées correspondent à la table. La page perso affiche l'historique réel des tirages de chaque joueur.
- **Recyclage** : bouton « Recycler » dans le coffre personnel, sélection multiple (ou par rareté), 3 golds par objet
  quelle que soit sa rareté. Les objets équipés ne sont pas recyclables ; confirmation demandée pour Épique/Légendaire.

## Sons

Tous les sons sont **synthétisés dans le navigateur** ([`public/js/sound.js`](public/js/sound.js)) : aucun fichier audio,
aucun droit d'auteur. Un bouton **🔊 Son** (page perso, page admin, ouverture de coffre) coupe ou remet le son ;
le choix est mémorisé.

| Moment | Son |
|---|---|
| Ouverture de la file / inscription d'un viewer | Cor d'appel / petit « pop » |
| Début de bataille | Clairon médiéval + timbales, puis musique de marche épique en boucle |
| Coups, kills | Cliquetis discrets, impact |
| Victoire | Fanfare triomphale + roulement + cymbale |
| Équiper / déséquiper | Cliquetis métallique montant / son sourd descendant |
| Ouvrir un coffre / acheter un coffre | Souffle magique / « ka-ching » + pièces |
| Recycler | Broyage + pluie de pièces |
| Point de compétence, récompense reçue | Petit arpège / pièces |

Dans OBS, le son de l'arène passe par la source navigateur `/arena.html` (cocher « Contrôler l'audio via OBS »).

Toutes les valeurs d'équilibrage sont centralisées dans [`shared/rules.js`](shared/rules.js).

## Structure

```
server/
  index.js    serveur Express + Socket.IO, routes, sessions, récompenses
  battle.js   file d'attente et simulation du combat (côté serveur, 20 ticks/s)
  bets.js     paris sur le vainqueur (mises, répartition des gains, remboursements)
  game.js     personnages : XP, coffres, objets, équipement, liaison Twitch
  twitch.js   lecture du chat (tmi.js), bot, OAuth
  db.js       stockage JSON (data/db.json)
shared/rules.js  règles et formules (utilisées par le serveur et le navigateur)
public/          pages HTML, CSS et scripts du navigateur
test/            tests (npm test)
```

## Limites du prototype

- Les tirages enregistrés dans « Tes tirages » ne comptent que les coffres ouverts depuis l'ajout de cette fonctionnalité.
- Stockage dans un fichier JSON : très bien pour tester, à remplacer par une vraie base (SQLite/PostgreSQL) en production.
- La liaison « par pseudo » n'est pas sécurisée : configure l'OAuth Twitch avant d'ouvrir le site au public.
