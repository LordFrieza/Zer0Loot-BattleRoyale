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
  | ⚔️ Guerriloot (guerrier) | Corps à corps, attire l'aggro | +30 % Vie, +25 % Défense | Épée · Bouclier |
  | 🏹 Archiloot (archer) | À distance (230 px), recule si un ennemi approche | +15 pts Précision, −10 % Vie, −15 % Dégâts | Arc · Carquois |
  | 🔮 Magiloot (mage) | À distance (170 px), explosion : 60 % des dégâts autour de la cible | +25 % Dégâts, −15 % Vie, attaque 35 % plus lente | Bâton · Grimoire |
  | 🗡️ Lootassin (assassin) | Traque l'ennemi le plus faible | +10 pts Critique, +25 % Vitesse d'attaque, −15 % Vie | Dagues · Dague de parade |
  | ✨ Saint-Loot (prêtre) | Corps à corps, régénère 1,5 % de sa vie / s | +10 % Vie, +10 % Défense, −10 % Dégâts | Masse · Relique |

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
  - Chance : points + bonus d'équipement (les lignes de Chance des objets s'ajoutent en points) → table de loot et forge
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
- **Apparence** (onglet Personnage, gratuit) : couleur du personnage (15 teintes ou automatique selon le pseudo),
  7 styles d'yeux, 5 de sourcils, 8 de bouches. Visible sur la fiche, dans l'arène et dans les aperçus.
- **Boutique** (onglet Boutique) : 25 cosmétiques purement visuels achetés avec des golds (150 à 2 000) :
  chapeaux, capes, chaussures, accessoires de visage, auras animées. Essayage sur l'aperçu avant achat ; un article
  acheté se porte / retire gratuitement. **Un chapeau remplace l'apparence du casque** (le casque reste équipé et ses
  bonus actifs). Succès liés : « Coquet » (1 article) et « Icône de mode » (10 articles).
- **Page perso en onglets** : Personnage (fiche, caractéristiques, apparence), Inventaire (coffres, équipement,
  coffre personnel paginé par 20 objets, forge), Boutique, Succès, Classements, Règles. Pastilles : points à répartir, coffres à ouvrir,
  succès à récupérer. Lien direct possible (`/character.html#boutique`).
- **Modes de jeu** (choisis par l'admin avant d'ouvrir la file ; le Battle Royale reste le mode principal) :
  - **Combat de Boss** (coopératif, dès 1 joueur) : tout le monde contre Grokk le Troll. Vie et dégâts selon le nombre
    de combattants au lancement (200 PV + 300 PV par combattant). Coup de massue qui touche les voisins, attaques
    spéciales annoncées au sol (onde de choc, rocher sur le plus gros groupe). Grosse barre de vie avec coches à 66 % et
    33 % : à chaque coche, +30 % de dégâts et +35 % de vitesse d'attaque. Rage finale à 2 min 30 (dégâts ×3).
    Victoire : **3 coffres, 500 XP et 500 golds pour TOUS les participants** (morts compris), avec explosion du Troll
    et pluie de coffres et de golds. Défaite : XP de participation seulement.
  - **Raid de Donjon** (coopératif, dès 1 joueur) : salles successives de gobelins, slimes, chauves-souris et
    squelettes archers, plus nombreux et plus forts à chaque salle, avec un chef 👑 toutes les 5 salles. Entrée par la
    gauche, sortie par la droite, fondu au noir et grand « SALLE X ». Pas de réapparition ; les survivants récupèrent
    30 % de vie entre deux salles. Récompense pour tous selon la salle atteinte : 5 → 50 XP / 50 golds, 10 → 150 / 150,
    15 → 1 coffre + 300 / 300, 20 → 2 coffres + 500 / 500, puis +1 coffre et +250 toutes les 5 salles.
  - En coopération, les kills de monstres ne rapportent rien en eux-mêmes ; pas de paris ni d'événements de bataille.
    Difficulté réglée par simulation (des centaines de combats) dans `shared/rules.js` (`BOSS`, `DUNGEON`, `ELITE`).
    5 succès liés (Tueur de troll, Fléau des trolls, Explorateur, Aventurier, Seigneur du donjon).
- **Style néon / jeu vidéo** : logo Zer0Loot (barre du haut, accueil, écrans d'attente de l'arène), fond parquet
  Zer0Loot (`public/img/fond.webp`) assombri avec halos rose / cyan, panneaux translucides à liseré néon, titres en police
  Orbitron (Google Fonts). Les images sont dans `public/img/` (logo, favicon, fond) : il suffit de les remplacer pour
  changer l'identité visuelle. Le champ de bataille garde son décor de pré (herbe et cailloux) ; le donjon a sa salle de
  pierre avec torches.
- **Panoplies** : 6 panoplies (Nosferatu, Bastion, Ouragan, Œil de Lynx, Fortune, Ronces), chacune liée à 2 stats.
  Équiper 2 / 4 / 6 / 8 pièces d'une même panoplie donne +2 / +4 / +7 / +10 points dans ces 2 stats (comme des points de
  compétence). Chance qu'un objet soit une pièce de panoplie : 5 % (Commun) à 25 % (Légendaire). Fusionner 3 pièces
  d'une même panoplie donne une pièce de cette panoplie.
- **Événements de bataille** (choisis par l'admin avant chaque bataille, annoncés au lancement, puis remis à « Aucun ») :
  Loot double (XP, golds et coffres ×2), Brouillard (nappes qui apparaissent / disparaissent ; on n'y est ciblé que de
  près), Zone rapide (déplacements ×5), Pluie de météores (impacts de 12 + 15 % de la vie max), ou Random.
- **Succès** : 42 succès (batailles, kills, victoires, niveaux, coffres, légendaires, recyclage, forge, paris, boss, donjon,
  panoplies…) avec barre de progression. Terminé → bouton « Récupérer » (golds selon la difficulté) et possibilité de
  porter son nom comme titre, affiché sous le pseudo dans l'arène et dans les classements.
- **Classements** : top 10 victoires, kills et batailles jouées, avec podium pour le top 3 (page perso et page admin).
- **Abonnements Twitch** : chaque sub, resub ou sub offert rapporte 300 golds à celui qui s'abonne ou qui offre
  (lu dans le chat ; les viewers sans compte les récupèrent en liant leur Twitch).
- **Outils admin** : liste de tous les joueurs (recherche), don de golds / coffres / XP, bannissement (déconnexion
  immédiate, retrait de la file, paris remboursés), simulation de `!join` et de sub pour les tests.
- **Tirages** : générateur aléatoire cryptographique ; un test statistique (`npm test`) vérifie que les fréquences
  observées correspondent à la table. La page perso affiche l'historique réel des tirages de chaque joueur.
- **Recyclage** : bouton « Recycler » dans le coffre personnel, sélection multiple (ou par rareté), 3 golds par objet
  quelle que soit sa rareté. Les objets équipés ne sont pas recyclables ; confirmation demandée pour Épique/Légendaire.

## Sons

Les **effets sonores** sont synthétisés dans le navigateur ([`public/js/sound.js`](public/js/sound.js)), sans fichier.
Les **musiques** de partie sont des MP3 dans [`public/audio/`](public/audio/) (128 kbit/s, volume normalisé à -16 LUFS),
jouées en boucle pendant le combat, une par mode :

| Mode | Musique | Fichier |
|---|---|---|
| Battle Royale | « Not dead YET! » (battle theme, remix chiptune) | `battle-royale.mp3` |
| Combat de Boss | BOSSFIGHT — « Milky Ways » | `boss.mp3` |
| Raid de Donjon | Mattashi — « The Final Battle » (Epic 8-Bit Orchestral Battle) | `donjon.mp3` |

Pour changer une musique, il suffit de remplacer le fichier (même nom) ; la liste est dans `TRACKS` (`sound.js`).

**Volume** : en haut des pages perso et admin, deux curseurs, **🔊 Sons** (combats, début et fin de partie, coffres…)
et **🎵 Musique**. Un clic sur l'icône coupe / remet ; bouger le curseur Musique sans partie en cours fait entendre un
extrait. Les réglages sont mémorisés par navigateur. Les fenêtres de coffre et de forge gardent un bouton pour couper
les sons.

| Moment | Son |
|---|---|
| Ouverture de la file / inscription d'un viewer | Cor d'appel / petit « pop » |
| Début de bataille | Clairon médiéval + timbales, puis la musique du mode en boucle (fondu à l'arrêt) |
| Coups, kills | Cliquetis discrets, impact |
| Victoire | Fanfare triomphale + roulement + cymbale |
| Combat de Boss | Rugissement du Troll (début, changements de phase), alerte et impact des attaques spéciales, explosion + pièces |
| Raid de Donjon | Porte qui grince à chaque salle, petite fanfare de salle terminée, marche funèbre en cas d'échec |
| Équiper / déséquiper | Cliquetis métallique montant / son sourd descendant |
| Ouvrir un coffre / acheter un coffre | Souffle magique / « ka-ching » + pièces |
| Recycler | Broyage + pluie de pièces |
| Point de compétence, récompense reçue | Petit arpège / pièces |

Dans OBS, le son de l'arène passe par la source navigateur `/arena.html` (cocher « Contrôler l'audio via OBS ») ;
le volume s'y règle dans le mixeur d'OBS (la page arène n'a pas de curseurs).

Toutes les valeurs d'équilibrage sont centralisées dans [`shared/rules.js`](shared/rules.js).

## Structure

```
server/
  index.js    serveur Express + Socket.IO, routes, sessions, récompenses
  battle.js   file d'attente et simulation du combat (côté serveur, 20 ticks/s) : Battle Royale, Boss, Donjon
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
