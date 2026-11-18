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
  | 🗡️ Lootassin (assassin) | Traque l'ennemi le plus faible | +10 pts Critique, +25 % Vitesse d'attaque, +15 pts Précision, +1 pt Vol de vie, −10 % Vie | Dagues · Dague de parade |
  | ✨ Saint-Loot (prêtre) | Corps à corps, régénère 1,5 % de sa vie / s | +10 % Vie, +10 % Défense, −10 % Dégâts | Masse · Relique |

  Les armes et objets secondaires appartiennent à une classe, mais **tout le monde peut les équiper** : avec un objet de
  sa propre classe, on gagne un **bonus de classe** dans la stat de prédilection (Guerriloot : Défense, Archiloot :
  Précision, Magiloot : Force, Lootassin : Critique, Saint-Loot : Vie) de +2 / +3 / +4 / +5 / +7 % selon la rareté.
  Dans les coffres, ils sont pour ta classe 1 fois sur 2 (sinon une classe au hasard), et toujours à la forge. En changeant
  de classe, l'équipement reste en place et le bonus suit la nouvelle classe.
- **Verrou** : le bouton 🔓 / 🔒 d'un objet (coffre ou équipement) le protège comme un objet de preset : il ne peut plus
  être fusionné, sacrifié à l'Alchimie noire, recyclé ni vendu par mégarde (il peut toujours être relancé ou renforcé).
  Les anciennes épées / anciens boucliers (d'avant les classes) sont devenus des objets de Guerrier.
- **Combat** : placements aléatoires, chaque perso prend en aggro l'ennemi le plus proche (sauf l'Assassin).
  Après 45 s, une zone se referme pour éviter les combats interminables. Après chaque attaque, un combattant reste
  **immobile un court instant** (récupération : Archer 0,6 s, Mage 0,5 s, Guerrier et Prêtre 0,3 s, Assassin presque rien ;
  les squelettes archers des donjons aussi, 0,6 s),
  raccourci par la vitesse d'attaque ; en reculant, les classes à distance **longent les murs** au lieu de rester coincées.
- **Style de combat** (onglet du même nom) :
  - **Tactique** : posture (Équilibré, Agressif : ne recule jamais, Prudent : recule plus loin et fuit sous 30 % de vie),
    cible préférée (selon la classe, la plus proche, la plus faible, la plus dangereuse) et distance de recul réglable
    (classes à distance).
  - **Techniques signature** débloquées par le niveau, indépendantes de l'ultime : 1 emplacement au niveau 5, 2 au
    niveau 15, parmi 14 techniques (Roulade, Charge, Second souffle, Frénésie, et 2 par classe : Cri de guerre, Coup de
    bouclier, Flèche repoussante, Tir rapide, Clignement, Nova de givre, Pas de l'ombre, Lame empoisonnée, Prière de
    soin, Lumière aveuglante). Détails : `TECHNIQUES` dans `shared/rules.js`.
- **Récompenses** : kill = 100 XP + 1 coffre + 10 golds ; victoire = 300 XP + 1 coffre + 30 golds ;
  participation = 25 XP pour chaque combattant à la fin de la bataille (gagnant compris, pas si l'admin annule).
- **Récompenses équilibrées** (Battle Royale, Roi de la Colline, Guerre des clans) : chaque combattant a une
  **💪 Puissance** = niveau + total des % de son équipement ÷ 10 (affichée sur la fiche). Les récompenses de victoire et
  de série sont multipliées par *puissance moyenne des adversaires ÷ sa puissance* (en Guerre des clans : l'équipe
  adverse), celles d'un kill par *puissance de la victime ÷ sa puissance*, entre ×0,4 et ×2. Les coffres sont arrondis au
  hasard (0,4 coffre = 40 % de chance d'en avoir un). La participation, les modes coopératifs, le Golden Shower et le Solo
  ne changent pas. Battre plus fort que soi rapporte plus ; écraser des joueurs bien plus faibles rapporte moins.
- **Séries de kills** (annoncées en grand sur le stream avec un son) : premier kill de la bataille = +1 coffre ;
  double kill (2 kills d'affilée en moins de 8 s) = +1 coffre ; triple kill = annonce seulement ;
  massacre (5 kills dans la bataille) = +2 coffres.
- **Niveaux** : il faut 300 XP pour passer niveau 2, puis 200 XP de plus à chaque niveau (300, 500, 700, 900…) ; chaque niveau donne 1 point de compétence.
- **Répartition des points** (onglet Personnage) : le bouton **+** place un point libre tout de suite ; le bouton **−**
  retire un point pour le replacer ailleurs : les changements s'affichent en direct (ancienne valeur barrée → nouvelle
  valeur de la stat, en vert ou en rouge), puis on **valide** d'un coup
  (50 golds par point retiré, 500 golds au plus ; placer des points libres reste gratuit).
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
  - Stamina : +5 % de vitesse de remplissage de la barre de stamina par point (plafond ×2,5). Barre pleine en 40 s
    (Guerrier), 38 s (Archer), 42 s (Mage), 36 s (Assassin), 40 s (Prêtre) sans bonus. Jamais sur les objets.
- **Table de loot** : chance 0 → 90 / 6,5 / 2,8 / 0,65 / 0,05 % ; chance 40 → 73 / 15 / 8,75 / 2,69 / 0,56 % ;
  chance 200 → 5 / 49 / 32,55 / 10,85 / 2,6 %.
  Variation linéaire par point de chance, plafonnée à 200 de chance effective.
- **Objets** : 8 emplacements (casque, plastron, gants, ceinture, pantalon, boucles d'oreilles, arme, main secondaire).
  Commun 1 ligne (+1–3 %), Peu commun 2 (+2–6 %), Rare 3 (+4–10 %), Épique 4 (+5–15 %), Légendaire 5 (+6–25 %).
  Les fourchettes se chevauchent : un très bon objet Rare peut valoir mieux qu'un Épique moyen (rappel dans la Forge).
  Chaque emplacement / type d'arme a ses stats de prédilection (ex. plastron → Vie/Défense/Épines, arc → Précision,
  dagues → Critique/Vitesse d'attaque, boucles → Chance).
- **Forge** :
  - Fusion (10 / 20 / 40 / 80 / 150 golds selon la rareté) : 3 objets de même rareté → 1 nouvel objet, toujours
    équipable par ta classe. Chance de monter d'une rareté : 40 % (Commun), 30 % (Peu commun), 15 % (Rare), 5 % (Épique),
    + 0,5 % par point de chance effective (max +20 %, moitié moins pour un Épique). Sinon, nouvel objet de même rareté.
    3 Légendaires → un nouveau Légendaire. Bouton **🎲 Remplir au hasard** (3 objets non protégés de la rareté choisie).
  - Forge en série : jusqu'à 30 fusions d'un coup pour une rareté ; les objets sont tirés au hasard dans le coffre
    (jamais un objet verrouillé ou dans un preset), tout est vérifié avant (objets et golds pour toute la série) ; les
    objets forgés s'affichent ensemble, améliorations en premier.
  - Option **⏩ Passer l'animation** (forge et coffres, mémorisée dans le navigateur) : résultat ou loot affiché tout de
    suite ; Espace / Entrée ouvre le coffre suivant.
  - Relance : remplace une ligne d'un objet (équipé ou non) par une autre stat au hasard, absente de l'objet.
    Prix : 10 / 20 / 40 / 80 / 150 golds selon la rareté.
  - **Alchimie noire** : sacrifie un objet de **même rareté** (+ 15 / 30 / 60 / 120 / 250 golds) pour renforcer une ligne
    choisie d'un autre objet, **sans changer sa stat** : +1 (Commun), +1 à 2 (Peu commun, Rare), +1 à 3 (Épique),
    +2 à 4 (Légendaire). La ligne peut dépasser le maximum de sa rareté jusqu'au plafond de l'alchimie (1,4 × le maximum :
    4 / 8 / 14 / 21 / 35) ; elle porte la marque ⚗️. Animation du chaudron ; succès « Alchimiste noir » (10 transmutations).
- **Coffres** : 3 objets par coffre, achat 100 golds, stockage illimité. Clics pour ouvrir selon la meilleure rareté :
  3 / 5 / 10 / 20 / 30. Lumières : blanc, puis vert (4ᵉ clic), bleu (6ᵉ), violet (11ᵉ), orange (21ᵉ).
- **Paris** : dès que la file est ouverte, chaque joueur voit les combattants inscrits dans l'encart « 🎲 Paris » de sa
  page perso et peut miser des golds sur **un** combattant (pas sur lui-même). La mise est retirée immédiatement ; le pari
  peut être modifié ou annulé jusqu'au lancement du combat, où les paris ferment. Si le combattant choisi gagne, le parieur
  récupère sa mise + une part des mises perdues au prorata de sa mise parmi les gagnants (1 contre 9 → 10 % / 90 %),
  répartie en golds entiers sans perte. Si personne n'a parié sur le gagnant, si la bataille est annulée ou si le serveur
  redémarre pendant la file, toutes les mises sont remboursées. La cagnotte s'affiche aussi sur l'écran de stream.
- **Apparence** (onglet Personnage, gratuit) : couleur du personnage (15 teintes ou automatique selon le pseudo),
  8 styles d'yeux, 5 de sourcils, 8 de bouches (chaque partie peut aussi être invisible). Visible sur la fiche, dans l'arène et dans les aperçus.
- **Boutique** (onglet Boutique) : 59 cosmétiques purement visuels achetés avec des golds (150 à 2 000) :
  chapeaux, capes, chaussures, accessoires de visage, auras animées, et des **skins d'équipement** (plastron, pantalon,
  gants, ceinture) qui remplacent l'apparence de la pièce. Les **skins d'arme et d'objet secondaire** sont réservés à une
  classe (2 armes et 1 objet secondaire par classe) : achetables par tous, portés seulement avec la bonne classe.
  Un article **« Vide »** à 100 golds par emplacement (casque, plastron, pantalon, gants, ceinture, arme, objet
  secondaire) cache la pièce équipée (tête nue, simple tunique, mains nues…) sans toucher à ses stats.
  Essayage sur l'aperçu avant achat ; un article acheté se porte / retire gratuitement. **Un chapeau remplace l'apparence
  du casque** (le casque reste équipé et ses bonus actifs). Succès liés : « Coquet » (1 article) et « Icône de mode » (10).
  - **Visage à dessiner** (1 500 golds) : le joueur dessine son visage (grille 12 × 12, 8 couleurs) dans l'onglet
    Personnage ; il remplace yeux, sourcils et bouche en bataille. L'arène ne reçoit qu'une référence et charge le dessin
    une fois ; l'admin peut effacer un dessin inapproprié (liste des joueurs).
  - **Cosmétiques d'exploit** (11), visibles mais verrouillés 🔒 avec la progression, puis gratuits : peaux légendaires
    d'ogre / de dragon / spectrale / gueule de mimic / liche glaciaire / carapace de veuve noire (vaincre le Troll / le
    Dragon / le Magicien / le Mimic / la Liche de glace / Maexxna en **Défi des boss, en Héroïque ou Légendaire**), couronne d'os (salle 30 du
    donjon), étendard des mille batailles (500 kills), bottes de légende (10 légendaires), masque des abysses
    (profondeur 25 en Expédition), aura du champion (100 victoires).
- **Page perso en onglets** : Personnage (fiche, case de potion, caractéristiques, apparence et visage dessiné),
  Inventaire (coffres, équipement avec boutons 🔓 verrou et « ✕ Retirer », presets, coffre personnel paginé par 20 objets
  avec filtres par emplacement / stat / panoplie et badge « Nouveau ! » sur les objets sortis d'un coffre ou de la fusion
  jusqu'au survol, forge et alchimie), Arbre de
  compétences, Style de combat, Boutique (potions puis cosmétiques), Marché, Solo, puis les activités en icônes (Familier,
  Casino, Survivor, Maison, Entraînement ; l'onglet ouvert montre son nom) — une seule ligne d'onglets, qui défile
  horizontalement sur petit écran. Les onglets d'infos — Historique, Statistiques, Succès
  (avec sa pastille), Classements, Règles — sont dans le bandeau du haut, avec leur nom sur grand écran et en icônes
  sinon ; le lien vers l'arène et la déconnexion passent aussi en icônes pour garder le bandeau sur une ligne.
- **Historique** (onglet Historique) : les 50 dernières parties (stream et solo, pas l'entraînement) avec le résultat,
  le rang, les kills, les morts, les dégâts infligés et subis, les dégâts sur les boss, la durée, les gains de la partie et
  un détail propre au mode (points et temps sur la colline, équipe et MVP, golds ramassés, % de vie restant du boss, salle,
  boss vaincus, profondeur…). Une ligne se déplie : niveau, classe, puissance, stats et équipement portés à ce moment-là.
- **Statistiques** (onglet Statistiques) : tout ce que le personnage a accompli (parties et victoires par mode, défaites,
  morts, dégâts, temps de jeu et sur la colline, records, boss vaincus, raids, Boss Rush, Solo, golds gagnés, objets
  obtenus, coffres, forge, marché, paris, potions, collection). Les statistiques détaillées démarrent à la mise à jour ;
  les compteurs plus anciens (batailles, kills, coffres…) remontent au début.
  Pastilles : points à répartir, coffres à ouvrir, points d'arbre, techniques à choisir, énergie, succès à récupérer.
  L'énergie du mode Solo (⚡) et les Clés de boss (🗝️) s'affichent aussi en haut de la page. Lien direct possible (`/character.html#boutique`).
- **Coffre personnel** : case « Afficher les objets des autres classes » (mémorisée) et filtre **🚫 Hors classe** qui
  n'affiche que les armes / objets secondaires des autres classes (pratique pour les recycler en masse). Filtre **par
  stat** (seulement les objets qui ont la Vie, la Force…, triés par la valeur de cette stat), combinable avec
  l'emplacement, et bouton **🏪 Vendre** sur chaque objet. Les golds restent affichés en haut de la page, sur tous les onglets.
- **Marché** (onglet Marché) : chaque joueur peut mettre en vente jusqu'à **5 objets** de son coffre personnel (ni équipés,
  ni protégés par un preset), au prix de son choix (5 à 1 000 000 golds). Pour placer la vente, il paie une **taxe de 20 %**
  du prix (jamais remboursée). Une vente dure **96 h** ; sans acheteur, l'objet revient dans son coffre. Acheter ne coûte
  que le prix affiché (**pas de taxe**) ; le vendeur reçoit les golds tout de suite, même s'il n'est pas connecté, et un
  **courrier ✉️** (bouton en haut de la page, avec le nombre de messages non lus). L'onglet montre les ventes en cours (avec
  un bouton pour les retirer), un **historique** (mises en vente, ventes, achats, retraits, expirations) et la liste des
  objets en vente, filtrable par emplacement, rareté, stat et classe, triable par prix, rareté ou date. Succès : Marchand
  (1 vente), Négociant (10 ventes), Client (1 achat).
- **Presets d'équipement** (panneau Équipement) : jusqu'à 5 presets nommés ; « Équiper » remet exactement l'équipement
  sauvegardé (⟳ pour le mettre à jour, 🗑 pour le supprimer). Les objets d'un preset sont **protégés** 🔐 : ni
  recyclage, ni fusion à la forge, tant que le preset existe.
- **Potions** (onglet Boutique, en haut) : 9 consommables payés en golds, stock jusqu'à 99 chacun. On en équipe **une**
  dans la case à côté du personnage ; elle est **consommée au lancement de la prochaine partie** (tous les modes), qu'elle
  se déclenche ou non, et ne se déclenche qu'une fois (une fois par raid dans le donjon). Jamais utilisée en Golden Shower
  (sans combat) ni en Solo :
  | Potion | Prix | Déclencheur | Effet |
  |---|---|---|---|
  | 🧪 Potion de vie | 90 | vie < 50 % | +4 % de vie max par seconde pendant 6 s |
  | 🍷 Potion de berserker | 120 | vie < 50 % | dégâts ×1,5 pendant 8 s |
  | 🧴 Potion de défense | 120 | vie < 50 % | dégâts subis ×0,4 pendant 4 s |
  | 💨 Potion de célérité | 105 | premier ennemi à portée | vitesse et vitesse d'attaque ×1,4 pendant 10 s |
  | 🌀 Téléportation d'urgence | 135 | vie < 20 % | téléportation au plus loin des ennemis |
  | 👻 Potion d'invisibilité | 150 | vie < 20 % | invisible 5 s : plus ciblable (les zones touchent quand même) |
  | 🌹 Potion de ronces | 105 | vie < 50 % | +40 % d'épines pendant 8 s |
  | 🔋 Élixir d'endurance | 180 | début du combat | barre de stamina à 50 % |
  | 🪶 Plume de phénix | 375 | en tombant | renaît avec 30 % de sa vie (pas de kill pour l'adversaire) |
- **Arbre de compétences** (onglet visible mais verrouillé avant le niveau 4 ; tutoriel en fenêtre au déblocage, puis
  derrière le bouton ?) : 1 point d'arbre tous les 3 niveaux (niveaux 4, 7, 10, 13…). Deux chemins par classe, chacun
  menant à une spécialisation ; prendre le premier rond d'un chemin bloque l'autre, et à chaque carrefour on choisit un
  rond sur trois. Remise à zéro : 250 golds (gratuite en changeant de classe). Une branche complète demande 7 points
  (niveau 22) : ultime → stats → carrefour → stats (+3 Stamina) → carrefour → stats → spécialisation.
  | Classe | Chemin gauche (ultime) | Chemin droit (ultime) |
  |---|---|---|
  | Guerriloot | Paladin — Rempart sacré | Berserker — Tourbillon |
  | Archiloot | Tireur d'élite — Flèche perforante | Spammeur — Pluie de flèches |
  | Magiloot | Pyromancien — Météore | Cryomancien — Blizzard (gel) |
  | Lootassin | Ombre — Exécution | Venimeux — Nuage toxique |
  | Saint-Loot | Saint — Prière (soins) | Inquisiteur — Châtiment |
  L'**ultime** part tout seul quand la **barre de stamina** (barre bleue sous la vie, très longue à remplir) est pleine ;
  la spécialisation renomme la classe et améliore l'ultime (ex. Flèche perforante plus grosse qui rebondit 2 fois).
  Bots et mannequins reçoivent un arbre au hasard selon leur niveau. Détails chiffrés : `ULTS` dans `shared/rules.js`.
- **Entraînement** (onglet Entraînement) : duel privé, visible seulement par le joueur, contre un mannequin (classe et
  niveau 1 à 50 au choix) ou le fantôme d'un autre joueur (son build, son arbre et son équipement actuels). Règles du
  Battle Royale, 2 min 30 maximum, aucune récompense ni statistique ; la potion équipée s'active sans être consommée.
  On peut aussi y **répéter le mode Solo** (Expédition, ou Défi des boss avec boss et difficulté au choix) **sans dépenser
  d'énergie** et sans rien gagner : mêmes règles qu'en Solo (reliques, vitesse ×1 / ×2, pas de potion), 10 min maximum.
  Et faire un **Boss Rush en solo** (difficulté au choix) : entre deux boss, on choisit soi-même en cliquant (bonus,
  grand soin ou quitte ou double, pas de résurrection puisqu'on est seul).
- **Mode Solo** (onglet Solo) : une Expédition coûte **1 ⚡ énergie** (3 au maximum, +1 toutes les 10 h), un Défi des boss
  **1 🗝️ Clé de boss** (sans limite, une offerte au départ, affichées en haut de la page à côté de l'énergie). Partie
  privée, visible seulement par le joueur, en vitesse ×1 ou ×2, sans potion ; on peut abandonner, ou fermer la page (la
  partie continue et les gains arrivent à la fin). Une partie interrompue par un redémarrage rend son énergie (ou sa clé).
  - **Expédition** : descente sans fin, seul contre des monstres de plus en plus forts (croissance exponentielle). Toutes
    les 3 profondeurs, le joueur choisit **une relique parmi 3** (13 reliques cumulables : dégâts, peau de pierre,
    vitesse, vol de vie, épines, régénération, critique, soin, ultime, pacte sanglant, vie en plus, trésor…). Une fois sur
    dix, l'une des propositions est une **Clé de boss** : la prendre la garantit à la fin de l'expédition. Butin pour
    `n` profondeurs nettoyées : 2/3 × `(25n + 2n²)` XP, 2/3 × `(20n + 1,5n²)` golds, 1 coffre tous les 5 (ex. profondeur 10 : 300 XP,
    233 golds, 2 coffres). Vie et dégâts ajustés par classe pour que le corps à corps descende aussi loin que les
    classes à distance.
  - **Défi des boss** : l'un des 6 boss (Troll, Dragon, Magicien, Mimic, Liche de glace, Maexxna), seul, calculé pour son niveau, en Normal (450 XP, 375 golds,
    2 coffres), Héroïque (900, 750, 3) ou Légendaire (1 500, 1 350, 6). Une victoire en Héroïque ou Légendaire débloque la peau légendaire du boss.
    Les boss sont nettement renforcés en solo (le Légendaire est réservé aux meilleurs builds) ; la vie et les dégâts du
    joueur sont ajustés par classe (Archer, Mage et Assassin renforcés, régénération du Prêtre réduite), et un Prêtre seul
    ne purifie pas sa propre malédiction face au Magicien.
- **Modes de jeu** (choisis par l'admin avant d'ouvrir la file ; le Battle Royale reste le mode principal) :
  - **Combat de Boss** (coopératif, dès 1 joueur) : tout le monde contre un boss choisi par l'admin (boutons sous
    « Combat de Boss », avant d'ouvrir la file) : Grokk le Troll, Pyrax le Dragon, Malvorath le Magicien des ténèbres,
    Grignotor le Mimic, Givrenoire la Liche de glace ou Maexxna la Veuve noire. Même récompense pour tous, même rage
    finale à 2 min 30. Chaque boss vaincu a 5 % de chance de laisser son **familier** à chaque héros (voir plus bas).
  - **Grokk le Troll** : vie et dégâts selon le nombre
    de combattants au lancement (200 PV + 300 PV par combattant, puis +6 % par niveau moyen des joueurs au-delà du 1, ×2,5 au plus). Coup de massue qui touche les voisins, attaques
    spéciales annoncées au sol (onde de choc, rocher sur le plus gros groupe). Grosse barre de vie avec coches à 66 % et
    33 % : à chaque coche, +30 % de dégâts et +35 % de vitesse d'attaque. Rage finale à 2 min 30 (dégâts ×3).
    Victoire : **3 coffres, 500 XP et 500 golds pour TOUS les participants** (morts compris), avec explosion du Troll
    et pluie de coffres et de golds. Défaite : XP de participation seulement.
  - **Pyrax le Dragon** (200 PV + 400 par combattant) : griffes qui touchent les voisins, souffle de feu en cône vers le
    plus gros groupe et coup de queue tout autour. À **75 %** et **30 %**, il **s'envole** 12 s : seuls les combattants
    à distance (portée ≥ 150 : Archer, Mage) peuvent le toucher, il bombarde le sol de boules de feu et lâche des
    **flammèches** : le corps à corps les chasse, chacune abattue brûle le dragon (1 % de sa vie) et le fait atterrir
    1 s plus tôt. Il atterrit ensuite lourdement sur le plus gros groupe. À **50 %**, il part **pondre** : 1 œuf pour 4 combattants (3 à 10) à détruire en
    16 s, sinon ils éclosent en **dragonnets** ; il revient furieux (dégâts +25 %, attaques +20 %).
  - **Malvorath le Magicien des ténèbres** (180 PV + 200 par combattant) : attaque de loin (traits d'ombre) et se
    téléporte toutes les 15 s. Alterne **malédictions** (2,5 % de la vie par seconde pendant 8 s ; un **Prêtre** à moins
    de 120 px purifie aussitôt, lui compris, sauf seul en Défi des boss) et **zones d'ombre** sous les pieds des combattants. À **70 %** et **20 %**,
    **bouclier** : il est intouchable tant que ses 4 **cristaux** tiennent (et ils le soignent). À **45 %**, il se
    **dédouble** en 3 illusions fragiles qui attaquent aussi : les dégâts de zone font la différence.
  - **Grignotor le Mimic** (200 PV + 280 par combattant) : un coffre aux dents acérées. Il **vomit** en cône le contenu
    de son ventre (armes : gros dégâts ; os : saignement ; bile : poison et ralentissement ; pièces : héros assommés) et
    **bondit** sur le héros le plus éloigné. À **75 %**, **50 %** et **25 %**, il **copie** un héros au hasard : 2, 4 puis
    6 copies de niveau 1 (même classe, même apparence) qui le protègent (−40 % de dégâts subis tant qu'elles sont debout).
  - **Givrenoire la Liche de glace** (220 PV + 330 par combattant) : attaque de loin et **garde ses distances** (un héros
    trop près → elle se téléporte 240 px plus loin, au plus toutes les 9 s, en laissant une explosion de givre). Elle **gèle** des héros 5 s (1 à la
    fois, puis 2 sous 66 %), de nouveau 10 s plus tard. Gelé : il ne bouge plus, n'attaque plus, ne remplit plus sa
    stamina et perd 1,5 % de sa vie max par seconde (5 % seul, en Défi des boss), mais personne ne peut le toucher et on peut le soigner. Pics de glace sous les
    héros, **lance de givre** (un long couloir qui transperce tous ceux qui s'y trouvent) et nova de givre (ralentissement). À **33 %**, elle **relève tous les héros morts** depuis le début (ils
    combattent pour elle et s'effondrent à sa mort) ; si personne n'est tombé, elle gèle 3 héros, puis 2.
  - **Maexxna la Veuve noire** (200 PV + 280 par combattant) : araignée géante aux morsures venimeuses. Elle tisse des
    **toiles** partout (héros ralentis de 65 %), crache sa toile et son venin, appelle des **nuées d'araignées**. À
    **70 %** et **20 %**, elle enferme des héros dans des **cocons** à briser ; à **45 %**, elle remonte au **plafond**
    (pluie de toiles et de venin, grosse nuée) et redescend plus rapide ; **frénésie** sous 20 %.
  - **Boss Rush** (coopératif, dès 1 joueur) : les boss s'enchaînent au hasard (chacun une fois avant de revenir, jamais
    deux fois de suite), de plus en plus forts : +30 % de vie par boss passé, et des dégâts qui s'accélèrent (× (1 + 0,3 × (k − 1)) ×
    1,08^(k − 1), soit ×3 au 5e boss, ×7,4 au 10e, ×15,3 au 15e). Entre deux boss, le chat
    vote 40 s (`!1`, `!2`, `!3` ou sur le site) : **un bonus** tiré au hasard pour le reste de la run (fureur, peau de
    pierre, adrénaline, vol de vie, ronces, vigueur, sève de vie, second souffle ; un même bonus permanent 2 fois au plus), **une résurrection** (ou un grand soin
    si personne n'est tombé) ou **Quitte ou double** (boss suivants ×1,25, mais golds et XP tout de suite). Fin quand
    tout le monde tombe : pour k boss vaincus, 150 + 200 + 250 + … XP et autant de golds, et 1 coffre par boss, pour tous.
  - **Roi de la Colline** (chacun pour soi, dès 2 joueurs, 2 min 30) : **personne n'est éliminé**. Une colline
    (grand cercle doré) se tient au sol ; chaque seconde dessus rapporte 2 points à chacun, **5 points si l'on y est
    seul** (le Roi 👑), et chaque kill 2 points. Hors de la colline, un combattant sans ennemi à portée y retourne. Toutes les 30 s, la colline change de place (annoncée en pointillés 5 s avant). Les morts
    reviennent au bord de l'arène au bout de 4 s, protégés 1,5 s. Le meilleur score gagne (égalité : le plus de kills) et
    reçoit la récompense de victoire du Battle Royale ; les paris sont ouverts comme en Battle Royale, pas les
    événements de bataille ni les récompenses de kill. Classement en direct dans l'arène.
  - **Guerre des clans** (deux équipes, dès 2 joueurs, 3 min) : **🔴 Rouges contre Bleus 🔵**. On choisit son camp avec
    `!rouge` / `!bleu` dans le chat ou les boutons de la fiche personnage (`!join` place dans l'équipe la moins nombreuse) ;
    on peut changer d'équipe tant que la bataille n'a pas commencé. Chaque équipe a un **cristal** dans son camp (400 PV +
    60 par adversaire), qui tire sur les ennemis proches : détruire le cristal adverse = victoire. Les combattants foncent
    vers le cristal adverse, mais défendent le leur et répondent à qui les colle. Les morts reviennent dans leur camp au
    bout de 5 s, puis **5 s de plus à chaque mort** (30 s au plus). L'équipe la plus faible est renforcée selon la
    **puissance totale** de ses membres (pas leur nombre) : × √(puissance forte ÷ puissance faible), jusqu'à ×1,75 en vie
    et dégâts. À 1 min 30, **mort subite** : les cristaux prennent ×3 ; à 3 min, le cristal le moins entamé
    gagne. Chaque membre de l'équipe gagnante reçoit 200 XP, 40 golds et 1 coffre, le **MVP** (le plus de dégâts) 1 coffre
    de plus. Les **paris** se font sur une équipe.
  - **Golden Shower** (mode bonus, dès 1 joueur, 75 s) : **pas de combat**. Les personnages se baladent au hasard et
    ramassent ce qui tombe du ciel : une pluie de pièces (1 gold chacune), des **coffres** en parachute (plus rares) et
    des bonus (💰 sac de 25 golds, 🧲 aimant, ⭐ étoile de vitesse). La **Chance** agrandit le rayon de ramassage, la
    **Vitesse** fait parcourir plus de terrain. Les 15 dernières secondes : **JACKPOT** (pluie ×3, pièces à 2 golds).
    Ambiance « bonus game » : lumière dorée et rayons, arc-en-ciel pendant le jackpot, compteur géant, podium et
    confettis à la fin. Chacun **garde son butin** (+1 coffre pour le meilleur ramasseur) ; ni paris ni potion consommée.
  - **Raid de Donjon** (coopératif, dès 1 joueur) : salles successives de gobelins, slimes, chauves-souris,
    squelettes archers, et deux monstres **venimeux** dont les coups empoisonnent : le rat pestiféré (dès la salle 2) et
    le gobelin violet (dès la salle 4) ; aussi en Expédition. Ils sont plus nombreux et plus forts à chaque salle, avec un chef 👑 toutes les 5 salles. Entrée par la
    gauche, sortie par la droite, fondu au noir et grand « SALLE X ». L'ambiance change toutes les 5 salles : Cachots,
    Crypte oubliée (flammes vertes, toiles), Forges infernales (lave), Abysses (yeux dans le noir), puis le Néant.
    Pas de réapparition ; les survivants récupèrent
    30 % de vie entre deux salles. Récompense pour tous selon la salle atteinte : 5 → 50 XP / 50 golds, 10 → 150 / 150,
    15 → 1 coffre + 300 / 300, 20 → 2 coffres + 500 / 500, puis +1 coffre et +250 toutes les 5 salles.
  - **Sondage du chat (Donjon)** : après chaque salle de chef (5, 10, 15…), le raid se met en pause **60 s** et tout le
    monde vote (participant ou simple spectateur) entre **2 bonus tirés au hasard** parmi 13, avec la commande du bonus
    dans le chat (`!vie`, `!or`…) ou `!1` / `!2`, ou avec les boutons de la fiche personnage. Une voix par personne (le
    dernier vote compte), égalité tirée au sort ; l'admin peut clore le sondage plus tôt. Grand cartel « LE CHAT
    DÉCIDE ! » dans l'arène avec les voix en direct, annonce dans le chat Twitch si le compte bot est configuré.

    | Bonus | Commande | Effet |
    |---|---|---|
    | ❤️ Grand soin | `!vie` | +50 % de vie max aux survivants |
    | 💰 Pluie d'or | `!or` | 10 golds × salle à tous les participants, tout de suite (50 en salle 5) |
    | 📚 Savoir ancien | `!xp` | 20 XP × salle à tous les participants, tout de suite (100 en salle 5) |
    | 🎁 Coffre au trésor | `!coffre` | 1 coffre à tous les participants, tout de suite |
    | 🔋 Second souffle | `!stamina` | +40 % de barre de stamina aux survivants |
    | 👼 Résurrection | `!mort` | un aventurier tombé (au hasard) revient avec 50 % de vie ; proposé seulement s'il y a un mort |
    | 😡 Fureur | `!rage` | dégâts ×1,25 jusqu'au prochain sondage |
    | 🛡️ Peau de pierre | `!armure` | dégâts subis ×0,75 jusqu'au prochain sondage |
    | ⚡ Adrénaline | `!vitesse` | vitesse et vitesse d'attaque ×1,2 jusqu'au prochain sondage |
    | 🧛 Soif de sang | `!vampire` | +15 % de vol de vie jusqu'au prochain sondage |
    | 🌵 Armure de ronces | `!ronces` | renvoie 25 % des dégâts reçus jusqu'au prochain sondage |
    | 💀 Quitte ou double | `!defi` | monstres +25 % de vie et de dégâts pour le reste du raid, récompense finale ×1,5 (cumulable) |
    | 🗝️ Passage secret | `!raccourci` | le groupe saute 2 salles, qui comptent pour la récompense |

    Les golds, l'XP et le coffre vont à tous les participants humains, morts compris.
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
- **Casino** (onglet Casino, musique « Luigi's Casino ») : une salle animée où se promènent les personnages des autres
  joueurs (et le sien) en lançant des répliques au hasard (« Allez, une dernière… », « Encore une défaite et Don Paolo va
  m'allumer ») — devant une table, ils parlent de ce jeu, et son propre personnage réagit à ses gains —, et six jeux tenus par les boss en smoking (mises de 10 à 500 golds, tirages côté serveur) :
  - **Machine à sous de Pyrax** : 3 rouleaux, trois symboles identiques paient ×5 (cerises) à ×150 (trois 7 : JACKPOT),
    deux cerises ×2 (taux de retour ≈ 94,6 %).
  - **Blackjack de Maexxna** : tirer, rester, doubler ; la banque reste sur 17 ; blackjack payé 3 pour 2.
  - **Roulette de Grokk** : européenne (0 à 36), jusqu'à 12 jetons de 10 à 100 golds (500 au total) : numéro ×36,
    douzaine / colonne ×3, rouge / noir, pair / impair, 1-18 / 19-36 ×2.
  - **Caisse de Grignotor** (100 golds) : défilé façon caisse à ouvrir, petits lots 80 % (golds, arme commune ou peu
    commune), bons lots 19 % (arme rare ou épique, Clé de boss), lots incroyables 1 % (arme légendaire, familier).
  - **Lac gelé de Givrenoire** : 25 cases dont 3 / 5 / 10 / 15 fissures ; chaque case sûre fait monter le gain, on
    encaisse quand on veut, une fissure fait tout perdre.
  - **Gobelets du mage Malvorath** : la bille sous l'un des 3 gobelets mélangés, ×2,85.
  Les gros gains (10× la mise ou plus, jackpots, lots incroyables) s'affichent pour tout le monde ; statistiques de
  casino dans l'onglet et dans Statistiques ; 3 succès (25 parties, jackpot, lot incroyable).
- **Survivor** (onglet Survivor, 300 golds la partie) : jeu de survie par vagues sur une grande carte (7 200 × 7 200 px,
  9 lieux-dits : village, forêt sombre, lac gelé, cimetière, champs de blé, volcan, ruines, marais, prairie fleurie, avec
  leurs ennemis favoris, aux frontières naturelles). Carte dessinée au naturel : sol lissé et fondu, routes de terre
  sinueuses vers la clairière de chaque autel, rivière du lac gelé jusqu'à la mare du marais (avec des ponts), cratère de
  lave. Projectiles animés en douceur ; ceux des ennemis sont rouges (ou colorés pour les boss) avec un contour. On se déplace avec **ZQSD** / les flèches (ou au doigt) ; les armes attaquent seules. Tout est
  simulé par le serveur (la position envoyée est bornée à la vitesse permise). **Les stats habituelles ne comptent pas** :
  base commune (120 PV, vitesse 150…), améliorée seulement par la méta-progression du Survivor. Musique : *Last Battle*
  (`public/audio/survivor.mp3`).
  - **Lieux-dits** : chacun a un effet tant qu'on y est (guide dans le camp, rappel dans le HUD). Village : +1 PV/s mais
    −25 % d'XP (camper au centre ne paie plus) ; forêt +30 % d'XP (ennemis +20 % de vie) ; lac : ennemis ralentis de
    25 % ; cimetière : gemmes ×2 (ennemis +15 % de vie) ; champs +15 % de vitesse et +30 % d'aimant ; volcan +30 % de
    dégâts mais −1,5 PV/s (jamais mortel) ; ruines +15 % de critiques ; marais +25 % de zone (−10 % de vitesse) ; prairie
    +50 % d'aimant et +0,5 PV/s.
  - **Exploration** : un **autel** par lieu-dit (2 s dessus → bénédiction de 40 s : ses bonus × 1,5, partout et sans
    contrepartie, + 25 % des PV ; recharge 150 s), des **éclats d'émeraude** loin du joueur (+1 émeraude chacun, toutes
    les 35 s, 3 au plus) et un **trésor gardé** à 90 s puis toutes les 150 s (une élite et 6 gardiens qui restent à leur
    poste ; 2 améliorations + 3 émeraudes). Mini-carte et flèches au bord de l'écran pour les trouver.
  - Vagues de 30 s (monstres du donjon, de plus en plus nombreux et costauds), un ennemi d'élite toutes les 50 s (coffre
    d'une amélioration), un **boss toutes les 5 vagues** (la vague suivante attend qu'il soit vaincu ; ignoré 3 min, il s'enrage : vitesse et dégâts ×1,5) (Grokk, Maexxna, Grignotor, Pyrax, Givrenoire, Malvorath, puis le
    cycle reprend plus fort), avec son attaque spéciale ; vaincu, il laisse un coffre de 3 améliorations.
  - Gemmes d'XP → montée de niveau (partie en pause) : choisir entre 3 (ou 4) améliorations. **8 armes** (Épée, Dagues,
    Baguette magique, Aura de feu, Hache, Foudre, Orbes gardiens, Fiole d'acide ; 8 niveaux chacune, 6 au plus) et
    **25 objets** cumulables (Cœur, Armure, Bottes, Gantelet, Grimoire, Cristal, Aimant, Trèfle, Couronne, Pomme dorée,
    Duplicateur, Cape d'ombre, Armure d'épines, Croc de vampire, Sablier, Plume du vent, Œil de faucon, Bouclier runique,
    Bourse de gemmes, Boussole, Cor de guerre, Gourde de soin, Talisman du vent, Rune de givre, Tome des possibles ;
    6 au plus).
  - **Eau** : la rivière, le lac gelé et la mare divisent la vitesse par deux (joueur et monstres) ; les ponts restent au sec.
  - Fin de partie : **émeraudes** selon la vague (⌊(v − 1)(v + 8) / 4⌋ + 10 par boss + 1 par 100 monstres), une fois par
    jour **10 coffres + 3 Clés de boss** si la **vague 30** est atteinte, score = 10 × secondes + monstres + 1 000 par boss
    (classement des meilleurs scores).
  - **Méta-progression** (émeraudes, prix très élevés) : 13 améliorations des stats de départ (Vitalité, Puissance,
    Carapace, Hâte, Célérité, Envergure, Attraction, Croissance, Récupération, Fortune, Avidité, Relance, Seconde vie),
    déblocage des armes et objets dans les tirages, armes de départ (l'Épée est la seule au début).
- **Maison** (onglet Maison) : sa propre maison, achetée et décorée en émeraudes. **47 meubles** (assises, tables, lits,
  rangements, lumières, plantes, tapis, décoration murale, loisirs, prestige ; de 250 à 75 000 émeraudes) à placer soi-même
  dans la pièce (glisser-déposer, clic droit pour retourner, double-clic pour ranger), façade (murs, toit, fenêtres, porte,
  jardin) et intérieur (papier peint, sol) à personnaliser, agrandissement (studio 9 × 6 → maison 13 × 8 à 12 000 →
  manoir 17 × 10 à 90 000). Son personnage s'y promène. Les meubles et options donnent des **points de déco** → niveau de
  décoration (20 au plus) → la **boîte aux lettres** reçoit un courrier toutes les 6 h (4 en attente au plus : 180 + 120 × niveau golds,
  6 émeraudes par niveau, 0,12 coffre par niveau, une Clé de boss dès le niveau 3, une potion une fois sur deux). On peut **visiter** les maisons des autres et leur laisser un ❤️.
  **Enclos sur la façade** : à droite de la maison, son enclos à familier en miniature (la déco achetée dans l'onglet
  Familier et le familier principal qui s'y promène), aussi chez les autres joueurs qu'on visite ; un clic sur le sien
  ouvre l'onglet Familier.
  **Façade animée** : avion publicitaire (« Casino Zer0Loot ! Le casino de la déchéance ! »…), Pyrax, montgolfière,
  chauves-souris dans le ciel, et d'autres joueurs qui passent devant la maison en lâchant des petites phrases.
  **Aperçu avant achat** : un clic sur une option de style pas encore achetée l'affiche sur sa maison (barre « Aperçu »
  avec Acheter / Annuler) ; « 👁️ Essayer » sur un meuble de la boutique le pose dans la pièce pour voir, à acheter et
  garder à cette place ou à annuler.
- **Familiers** (onglet Familier) : un boss vaincu (Combat de Boss, Boss Rush, Défi des boss) a **5 % de chance** de
  laisser sa version miniature à chaque héros (une espèce par boss ; un doublon donne 150 XP au familier et un festin).
  Dans un **enclos animé** (ciel selon l'heure, objets achetés, familier qui se promène et réagit), le familier
  **principal** a faim, soif et envie de jouer (besoins qui baissent avec le temps). Si sa satisfaction est d'au moins
  50 %, il ramène une **trouvaille** toutes les 4 h (plus souvent avec ses niveaux, 3 en attente au plus) : arme (Troll),
  golds (Dragon), XP (Magicien), coffre (Mimic), potion et parfois une Clé de boss (Liche), armure ou bijou (Maexxna).
  On le caresse, on joue avec lui, on le nourrit (épicerie ; chaque espèce a son plat préféré) : il gagne de l'XP et
  des niveaux (20 au plus). Objets d'enclos à acheter une fois (fleurs, lanternes, gamelle, fontaine, coffre à jouets,
  mare, niche, statue). **3 jours d'affilée au-dessus de 80 %** : il devient **compagnon de combat** et suit son héros
  dans l'arène (cosmétique). Les autres familiers se reposent (leurs besoins ne baissent pas).
  Sous l'enclos, le **journal des trouvailles** liste les 40 dernières (quel familier, quoi, quand) avec le total de
  tout ce que les familiers ont rapporté depuis le début (trouvailles, golds, XP, coffres, potions, clés, objets).
- **Succès** : 82 succès (batailles, kills, victoires, niveaux, coffres, légendaires, recyclage, forge, paris, casino, chaque boss,
  donjon, Roi de la Colline, Guerre des clans et MVP, Golden Shower, Expédition, reliques, Défi des boss, alchimie,
  techniques, panoplies…) avec barre de progression. Terminé → bouton « Récupérer » (golds selon la difficulté) et possibilité de
  porter son nom comme titre, affiché sous le pseudo dans l'arène et dans les classements.
- **Classements** (top 10, podium pour le top 3, page perso et page admin) : victoires (Battle Royale, Roi de la Colline,
  Guerre des clans), kills (Battle Royale uniquement), batailles jouées (tous les modes du stream), record de profondeur
  en Expédition et record de salle du Raid de Donjon. Chaque classement indique ce qu'il compte.
- **Abonnements Twitch** : chaque sub, resub ou sub offert rapporte 5 000 golds à celui qui s'abonne ou qui offre
  (lu dans le chat ; les viewers sans compte les récupèrent en liant leur Twitch).
- **Outils admin** : liste de tous les joueurs (recherche), don de golds / coffres / XP / énergie / clés de boss / familier, effacement d'un
  visage dessiné, bannissement (déconnexion
  immédiate, retrait de la file, paris remboursés), simulation de `!join` et de sub pour les tests. **Historique global**
  (les parties de tous les joueurs, filtres par joueur et par mode) et **échanges du marché** (vendeur, acheteur, objet,
  prix) avec des signaux de comportement suspect : même vendeur → même acheteur 3 fois ou plus, objet épique ou
  légendaire bradé au prix minimum, prix 10 fois au-dessus du prix habituel de sa rareté.
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
| Ruée vers l'or | « YV Remix » | `ruee.mp3` |

Le Roi de la Colline et la Guerre des clans reprennent la musique du Battle Royale.

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
| Ultime / potion | Montée d'énergie + accord (couleur selon l'ultime) / glouglou + éclat |
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
  battle.js   file d'attente et simulation du combat (côté serveur, 20 ticks/s) : tous les modes, boss et Boss Rush
  market.js   marché entre joueurs (ordres, courrier, historique)
  bets.js     paris sur le vainqueur (mises, répartition des gains, remboursements)
  game.js     personnages : XP, coffres, objets, équipement, liaison Twitch
  twitch.js   lecture du chat (tmi.js), bot, OAuth
  db.js       stockage JSON (data/db.json)
shared/rules.js  règles et formules (utilisées par le serveur et le navigateur)
public/          pages HTML, CSS et scripts du navigateur (pets.js : onglet Familier et enclos animé)
test/            tests (npm test)
```

## Limites du prototype

- Les tirages enregistrés dans « Tes tirages » ne comptent que les coffres ouverts depuis l'ajout de cette fonctionnalité.
- Stockage dans un fichier JSON : très bien pour tester, à remplacer par une vraie base (SQLite/PostgreSQL) en production.
- La liaison « par pseudo » n'est pas sécurisée : configure l'OAuth Twitch avant d'ouvrir le site au public.
