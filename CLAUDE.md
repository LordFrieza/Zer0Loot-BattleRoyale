# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Zer0Loot Battle Royale : un mini-jeu relié au chat Twitch (`!join` → combats automatiques → coffres de loot). Backend Node/Express + Socket.IO + tmi.js, frontend en JS pur et fichiers statiques (pas de build, pas de framework). L'interface, les commentaires et les textes du jeu sont en **français** : garde cette convention. `README.md` décrit toutes les règles du jeu, les variables d'environnement et les pages ; `DEPLOIEMENT.md` explique la mise en ligne sur Railway.

## Commandes

```bash
npm install
npm start                       # node server/index.js → http://localhost:3000
npm run dev                     # node --watch
npm test                        # node --test test/*.test.js
npm run test:coverage           # tests + couverture de code
npm run spec:coverage           # exigences de SPECIFICATION.md sans test
node --test test/bets.test.js                       # un seul fichier de tests (un par domaine)
node --test --test-name-pattern="BET-7" test/*.test.js   # un test précis, par identifiant de la spec
```

Développement local sans Twitch : `TWITCH_CHAT_DISABLED=1 npm start`. L'admin par défaut est `admin`/`admin` (interdit avec `NODE_ENV=production`). La page admin permet d'ajouter des bots et de simuler un `!join` pour tester. Il n'y a ni linter ni étape de build.

## Architecture

- **`shared/rules.js`** est un module UMD chargé à la fois par Node (`require('../shared/rules')`) et par le navigateur (`/shared/rules.js` → global `Rules`). Il contient *toutes* les formules d'équilibrage : stats, classes, raretés, table de loot, forge, récompenses, courbe d'XP. Modifie l'équilibrage ici, et garde-le sans dépendance à Node ni au DOM. Les tests de `test/` le couvrent : mets-les à jour quand les règles changent.
- **`server/index.js`** — routes Express (sessions par cookie `zl_session`, mots de passe scrypt, OAuth Twitch, endpoints admin) et hub Socket.IO. Il relie les autres modules : événements de bataille → récompenses (`game`) → rooms socket par utilisateur (`user:<id>`) qui émettent `me`, `reward`, `bet` ; diffusions globales `queue`, `frame`, `leaderboard`, `twitch`.
- **`server/battle.js`** — `Battle` (EventEmitter), machine à états `idle → queue → ready → battle → ended`. Le combat est simulé **côté serveur** à pas fixe (`TICK_MS`) et diffusé en `frame` ; les clients ne font que l'affichage. La zone qui se referme et les événements (brouillard, météores, mode rapide) sont ici, ainsi que les trois **modes de jeu** (`this.mode`, choisi à l'ouverture de la file) : `br` (chacun est sa propre équipe), `boss` (équipe `heroes` contre le Troll : phases, attaques spéciales) et `dungeon` (salles successives, étapes `dark → enter → fight → clear → exit`). Le ciblage et les dégâts de zone se basent sur `team` ; la taille au sol sur `r`.
- **`server/game.js`** — logique des personnages : progression, coffres, équipement, forge, changement de classe, et `upgrade()` qui migre les anciennes sauvegardes (ajoute-y les nouveaux champs et migrations d'objets quand la forme des données change).
- **`server/bets.js`** — cagnotte des paris ; les mises sont retirées immédiatement et sauvegardées, les gains passent par la fonction pure `computePayouts`.
- **`server/db.js`** — toute la base est un seul objet en mémoire (`db.state`), écrit dans `DATA_DIR/db.json` avec une écriture atomique différée. Appelle `db.save()` après chaque modification. Les clés de premier niveau inconnues (ex. `bets`) sont créées à la demande par le module propriétaire.
- **`server/twitch.js`** — lecteur de chat tmi.js (anonyme par défaut) qui émet les `!join` ; compte bot optionnel pour répondre.
- **`public/`** — pages statiques (`index`, `character`, `admin`, `arena`). `arena.html` est la source navigateur pour OBS. Les scripts sont chargés par de simples balises `<script>` dans l'ordre des dépendances (`common.js` d'abord pour `api()`, `toast()`, `esc()`) ; `fighter.js` dessine les personnages, `monsters.js` le Troll et les monstres, `sound.js` synthétise les effets et joue les musiques MP3 de `public/audio/` (une par mode), avec deux volumes « Sons » et « Musique » mémorisés en `localStorage`. Pas de modules ni de bundler.

Un viewer sans compte obtient, via `!join`, un personnage rattaché à son pseudo Twitch ; il le récupère en créant un compte et en liant son Twitch (OAuth, ou liaison par pseudo en développement uniquement).

## Spécification détaillée

[SPECIFICATION.md](SPECIFICATION.md) décrit le comportement implémenté au format **EARS** (exigences numérotées : `ACC-`, `Q-`, `B-`, `BET-`, `FRG-`…). Lis-la avant de modifier une règle de jeu, et mets-la à jour dans le même changement.

## Cycle d'une partie (vue d'ensemble)

1. L'admin choisit le mode et ouvre la file (`/api/admin/queue/open`, 10 à 3600 s, `mode`) → phase `queue` ; les viewers tapent `!join` (ou cliquent « Rejoindre »). Les paris sont ouverts en `queue` et `ready`, en Battle Royale seulement.
2. Fin du minuteur ou fermeture manuelle → `ready`. L'admin lance la partie (≥ 2 combattants en Battle Royale, ≥ 1 en coopération) : les stats des humains sont **recalculées au lancement** (`refreshParticipant`) → `battle`, paris fermés.
3. Tick de 50 ms : ciblage, déplacement, attaques, zone (dès 45 s, Battle Royale), événement éventuel, attaques du Troll ou étapes du donjon ; chaque tick diffuse un `frame`. Battle Royale : fin quand il reste ≤ 1 combattant ou à 300 s ; Boss : Troll mort, tout le monde mort ou 300 s ; Donjon : tout le monde mort.
4. `kill` / `streak` / `end` (Battle Royale) et `coopEnd` (Boss, Donjon) déclenchent les récompenses dans `index.js` (jamais dans `battle.js`, qui ne connaît pas la base), puis règlement des paris et mise à jour des classements → `ended`.

## Invariants et pièges

- **Récompenses et événement `double`** : passe toujours par `scaled()` dans `index.js` ; ne crédite jamais directement `Rules.REWARDS`. Exception : les modes coopératifs (sans événement) créditent la récompense commune du résultat `coopEnd` à **tous** les participants humains, morts compris ; les kills de monstres ne rapportent rien et ne comptent pas dans le record.
- **Bots** (`bot: true`, clé `bot<n>`) et joueurs sans `userId` ne reçoivent rien et ne sont jamais sauvegardés ; on peut pourtant parier sur eux.
- **Clés de combattants** : `u<id>` pour un humain, `bot<n>` pour un bot ; les paris, le ciblage et les classements s'appuient dessus.
- **Zone et météores ne peuvent pas tuer le dernier survivant** ; si tous meurent le même tick, le dernier mort ressuscite à 1 PV et gagne. Les morts de zone/météore n'ont pas de tueur (pas de XP de kill).
- **Chance** : les % d'équipement s'*ajoutent* en points (pas de multiplication) ; plafond 85 pour la table de loot.
- **Tirages de loot/forge** : `crypto` (dans `game.js`). **Combat** : `Math.random`.
- **Mises** : retirées immédiatement du joueur et sauvegardées ; remboursées si la file est rouverte, l'arène réinitialisée, le combattant banni ou le serveur redémarré (`bets.refundAll()` au démarrage). L'état est dans `db.state.bets`.
- **Changement d'état d'un personnage** : passe par `action()` dans `index.js` (sauvegarde + événement `me`) ; les erreurs lancées par `game.js` deviennent des réponses 400 avec leur message en français.
- **Fantômes** (`ghost: true`) : comptes créés par `!join` sans compte, sans mot de passe, invisibles au login ; absorbés par `game.linkTwitch` → `absorbGhost`. Un nouveau champ de personnage doit aussi être fusionné dans `absorbGhost`.
- **Un seul processus** : l'état est en mémoire et la file/bataille aussi ; ne pas mettre plusieurs répliques derrière un même volume (`railway.json` : `numReplicas: 1`). `DATA_DIR` doit pointer vers un volume persistant en ligne.
- **Ouverture de coffre** : décidée côté serveur dès l'appel `/api/chest/open` ; l'animation par clics (`public/js/chest.js`) est purement visuelle.

## Où modifier quoi

| Je veux… | Fichier |
|---|---|
| Ajouter une stat, une classe, une rareté, un succès, un cosmétique, un événement, une panoplie | `shared/rules.js` (+ affichage dans `public/js/character.js`, rendu dans `fighter.js`/`arena.js`) |
| Changer le comportement du combat | `server/battle.js` |
| Ajouter une action joueur | route dans `server/index.js` + fonction dans `server/game.js` (lever `Error` en français) |
| Ajouter un champ au personnage | `newCharacter()` **et** `upgrade()` dans `server/game.js`, plus `absorbGhost` si cumulable |
| Ajouter une commande de chat | callback de `twitch.startChat` dans `server/index.js` |
| Ajouter un événement de bataille | `Rules.BATTLE_EVENTS`, `updateEvent()` dans `battle.js`, rendu dans `arena.js` |
| Équilibrer le Boss ou le Donjon, ajouter un monstre | `Rules.BOSS`, `Rules.DUNGEON`, `Rules.MONSTERS`, `Rules.ELITE` ; dessin dans `public/js/monsters.js` ; rendu et transitions dans `arena.js` |

## Tests et garde-fous automatiques

- Un fichier de test par domaine dans `test/` (`loot`, `chests`, `progression`, `stats`, `classes`, `battle`, `events`, `modes`, `bets`, `forge`, `sets`, `achievements`, `appearance`) et `http.test.js` : tests d'intégration sur le vrai serveur Express (port aléatoire : comptes, rôles, file, paris, bans, liaison Twitch, bataille complète pilotée à la main). Runner natif de Node, aucune dépendance.
- **Chaque fichier de test commence par `require('./helpers')`** : il isole la base dans un dossier temporaire (`DATA_DIR`) avant que `server/db.js` soit chargé, et fournit `Rules`, `game`, `db`, `Battle`, `testBattle(fighters)` (bataille dont la boucle est arrêtée, on appelle `attack()`/`tick()` à la main) et `base()` (stats neutres).
- **Le nom de chaque test est préfixé par les identifiants de [SPECIFICATION.md](SPECIFICATION.md)** qu'il vérifie : `test('[BET-7] paris : …', …)`. Un nouveau comportement = une exigence dans la spec + un test tagué.
- `server/index.js` n'a plus d'effet de bord à l'import : il exporte `{ app, server, io, battle, bets, start }`, et `start()` (appelé seulement par `node server/index.js`) branche le chat Twitch, les minuteurs, les signaux et `listen`. Les tests importent le module et appellent `server.listen(0)`. Toute nouvelle chose à effet permanent (minuteur, connexion externe) va dans `start()`.
- Couverture (`npm run test:coverage`) : ~91 % des lignes ; `server/twitch.js` (chat, OAuth) et `public/` ne sont pas testés. **Couverture de la spec** : `npm run spec:coverage` liste les exigences de `SPECIFICATION.md` sans test ; `--json` pour un traitement automatique, `--strict` échoue s'il manque une exigence, un tag, ou s'il reste un test `skip`/`todo` (qui ne compte pas comme couverture). Une exigence marquée « (vérification manuelle) » dans la spec (interface, volume Railway…) n'est jamais comptée comme manquante.
- Hooks commités dans [.claude/settings.json](.claude/settings.json) (scripts dans `.claude/hooks/`) :
  - **PostToolUse (Edit|Write)** → `run-tests.js` : relance `npm test` quand un fichier de `server/`, `shared/` ou `test/` est modifié ; en cas d'échec le détail est renvoyé à Claude.
  - **Stop** → `check-done.js` : empêche de terminer (une fois par tour) si du code de `server/`/`shared/` a changé sans test ni mise à jour de `SPECIFICATION.md`, ou si `npm test` est rouge. La vérification se base sur `git status` : elle ne voit que les changements non commités.

## Agent et skills du projet

- **Agent `qa`** ([.claude/agents/qa.md](.claude/agents/qa.md)) : audite la couverture de la spec (`npm run spec:coverage`), lit le code, écrit les tests manquants dans `test/` (jamais le code de jeu) et signale les écarts spec ↔ code. À lancer avant un commit ou après un changement de règle.
- **Skill `ajouter-regle`** ([.claude/skills/ajouter-regle/SKILL.md](.claude/skills/ajouter-regle/SKILL.md)) : la procédure complète pour ajouter ou modifier une règle (rules.js → serveur → interface → spec → tests).
- **Skill `smoke-arena`** ([.claude/skills/smoke-arena/SKILL.md](.claude/skills/smoke-arena/SKILL.md)) : test de fumée Playwright (serveur sans Twitch, bataille de bots, captures arène/admin/fiche joueur, erreurs console).
