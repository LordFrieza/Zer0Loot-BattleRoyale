---
name: ajouter-regle
description: Procédure pour ajouter ou modifier une règle de jeu de Zer0Loot Battle Royale (stat, classe, rareté, objet, panoplie, succès, cosmétique, événement de bataille, récompense, action joueur, route admin, commande de chat). À utiliser dès qu'on touche au gameplay ou à l'équilibrage, pour ne rien oublier entre rules.js, serveur, interface, spec et tests.
---

# Ajouter ou modifier une règle de jeu

Toute règle touche jusqu'à cinq endroits. Suis l'ordre ci-dessous ; l'étape 1 dépend de ce que tu ajoutes.

## 0. Cadrer

- Cherche d'abord dans [SPECIFICATION.md](../../../SPECIFICATION.md) l'exigence existante (`grep` sur le mot-clé) : on **modifie** une exigence ou on en **ajoute** une (identifiant suivant dans la section, ex. `BET-12`).
- Les valeurs d'équilibrage vivent **uniquement** dans `shared/rules.js` (jamais en dur dans `server/` ni `public/`).

## 1. Données et formules : `shared/rules.js`

| Je veux ajouter… | Où dans `rules.js` |
|---|---|
| une stat | `STATS`, `STAT_INFO`, `derive()`, `describeDerived()`, `STAT_SUFFIX` ; les poids de tirage des objets (`SLOT_INFO` / `KINDS`) |
| une classe | `CLASSES`, `CLASS_INFO` (bonus, plats, `combat`, arme + secondaire) ; un `KINDS` par arme/secondaire |
| une rareté / un palier de loot | `RARITIES`, `RARITY_INFO`, `LOOT_BASE`, `LOOT_PER_LUCK`, `FUSE_UPGRADE`, `REROLL_PRICE`, `SET_DROP_CHANCE` |
| une panoplie | `SETS` (+ `SET_TIERS` si nouveaux paliers) |
| un succès | `ACHIEVEMENTS` (+ `COUNTERS` et `achievementValue` si nouvelle métrique) |
| un cosmétique / une option d'apparence | `COSMETICS` / `APPEARANCE` |
| un événement de bataille | `BATTLE_EVENTS` |
| une récompense | `REWARDS` |

`rules.js` est partagé avec le navigateur : aucune dépendance à Node ni au DOM.

## 2. Logique serveur

- **Combat** (comportement en bataille, événements) → `server/battle.js`. Les récompenses ne se calculent pas ici : `battle.js` émet des événements (`kill`, `streak`, `end`), `server/index.js` donne les récompenses via `scaled()` (pour que « Loot double » s'applique).
- **Personnage** (progression, objets, forge, boutique) → `server/game.js` : lever `new Error('message en français')` en cas de refus (`index.js` le renvoie en 400).
- **Nouvelle action joueur** : route `app.post('/api/...', requirePlayer, action((req) => game.xxx(req.user.character, ...)))` dans `server/index.js`. `action()` sauvegarde et pousse l'événement `me`.
- **Nouveau champ de personnage** : `newCharacter()` **et** `upgrade()` (anciennes sauvegardes) dans `game.js`, et `absorbGhost()` s'il est cumulable (fusion d'un compte fantôme).
- **Nouvelle commande de chat** : callback de `startTwitch()` dans `server/index.js`.
- Paris : `server/bets.js` (mise retirée immédiatement, `computePayouts` pure).

## 3. Interface

- Fiche joueur et règles affichées : `public/character.html` + `public/js/character.js` (onglet « Règles » à mettre à jour si les chiffres changent).
- Rendu des combattants : `public/js/fighter.js` ; arène et annonces : `public/js/arena.js` ; sons : `sound.js` ; admin : `public/admin.html` + `admin.js`.
- Le README décrit les règles chiffrées : mets-le à jour s'il les mentionne.

## 4. Spécification

- Mets à jour `SPECIFICATION.md` dans le **même changement** : une exigence EARS (« Quand … le serveur doit … ») avec les valeurs exactes. Un identifiant ne change jamais de sens ; une exigence supprimée est retirée, pas réutilisée.

## 5. Tests

- Un test par exigence nouvelle ou modifiée, dans le fichier de domaine de `test/` (voir `CLAUDE.md`), nom préfixé par les identifiants : `test('[BET-12] …', …)`. Routes HTTP → `test/http.test.js`.
- `test/helpers.js` fournit `testBattle()` et `base()` ; force les valeurs aléatoires plutôt que de compter sur le hasard.

## 6. Vérifier

1. `npm test` : tout doit être vert (les hooks du projet le lancent aussi à chaque modification).
2. `npm run -s spec:coverage` : l'exigence est couverte, aucun tag inconnu.
3. Si le rendu a changé (arène, fiche joueur) : skill `smoke-arena`.
