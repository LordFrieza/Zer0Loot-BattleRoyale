# 🚀 Mettre le jeu en ligne 24 h/24 (Railway)

Avec `npm start`, le jeu tourne **sur ton PC** : dès que tu fermes la fenêtre, le site s'arrête.
Pour qu'il reste ouvert en permanence, on le confie à un **hébergeur**, c'est-à-dire un ordinateur dans
un datacenter qui le fait tourner à ta place, jour et nuit.

On utilise **[Railway](https://railway.com)** :
- il se branche directement sur ton dépôt GitHub et **remet le site à jour tout seul** à chaque modification ;
- le serveur **ne s'endort jamais**, ce qui est indispensable pour que `!join` soit lu dans le chat à tout moment ;
- il fournit un **disque permanent** pour sauvegarder les comptes, les persos et le loot.

> 💶 **Coût** : l'offre *Hobby* coûte environ **5 $/mois** (crédit d'utilisation inclus). Un petit jeu comme
> celui-ci devrait rester dans ce montant, mais tu peux le surveiller dans l'onglet **Usage** de Railway.
> Les offres 100 % gratuites (ex. Render gratuit) mettent le serveur en veille après 15 minutes sans visite,
> ce qui couperait la lecture du chat. Elles ne conviennent donc pas.

Les fichiers de configuration sont déjà dans le projet (`Dockerfile`, `railway.json`). Tu n'as **rien à coder**,
seulement à cliquer. Compte une vingtaine de minutes.

---

## Étape 1 : préparer le code sur GitHub

Le code est sur la branche `claude/web-twitch-game-prototype-76mb03`. Le plus simple est de le fusionner dans la
branche principale (`main`) de ton dépôt `LordFrieza/Zer0Loot-BattleRoyale` (via une *Pull Request* sur GitHub,
je peux la créer pour toi). Sinon, tu peux aussi choisir directement cette branche à l'étape 2.

## Étape 2 : créer le projet Railway

1. Va sur <https://railway.com> et clique sur **Login** → **Login with GitHub**.
2. Abonne-toi à l'offre **Hobby** (menu de ton compte → *Plans*).
3. Clique sur **New Project** → **Deploy from GitHub repo** → choisis **Zer0Loot-BattleRoyale**.
   (Si le dépôt n'apparaît pas, clique sur *Configure GitHub App* et autorise Railway à y accéder.)
4. Railway détecte le `Dockerfile` et lance une première construction. Elle peut échouer ou redémarrer
   tant que les étapes suivantes ne sont pas faites, c'est normal.
5. Si tu n'as pas fusionné dans `main` : ouvre le service → **Settings** → **Source** → **Branch** et choisis
   `claude/web-twitch-game-prototype-76mb03`.

## Étape 3 : ajouter le disque permanent (très important)

Sans lui, **tous les comptes et le loot seraient effacés** à chaque mise à jour.

1. Dans ton projet Railway, fais un clic droit sur le service (ou `Ctrl + K`) → **Add Volume** (*Ajouter un volume*).
2. **Mount path** (chemin de montage) : `/data`
3. Valide.

## Étape 4 : les réglages (variables)

Ouvre le service → onglet **Variables** → **New Variable**, et ajoute :

| Nom | Valeur |
|---|---|
| `ADMIN_PASSWORD` | un mot de passe solide de ton choix (c'est celui du compte `admin`) |
| `TWITCH_CHANNEL` | `zer0loot` |

## Étape 5 : obtenir l'adresse du site

1. Service → **Settings** → **Networking** → **Generate Domain**.
2. Railway te donne une adresse du type `https://zer0loot-production.up.railway.app`.
3. Ajoute une variable `PUBLIC_URL` avec **cette adresse exacte** (sans `/` à la fin).

Le site est en ligne ! Ouvre l'adresse, connecte-toi avec `admin` et ton mot de passe : tu arrives sur l'écran de combat.
En haut à droite, le **point vert « Chat #zer0loot »** confirme que le chat Twitch est bien lu.

## Étape 6 : activer « Se connecter avec Twitch »

En ligne, la liaison « en tapant son pseudo » est **désactivée**, car n'importe qui pourrait se faire passer pour
un autre viewer et récupérer son loot. Les joueurs lient donc leur compte via la vraie connexion Twitch :

1. Active la **double authentification** sur ton compte Twitch (Twitch l'exige pour créer une application).
2. Va sur <https://dev.twitch.tv/console/apps> → **Register Your Application** (*Enregistrer votre application*).
   - **Nom** : `Zer0Loot Battle Royale` (doit être unique sur Twitch, ajoute un mot si le nom est pris)
   - **OAuth Redirect URLs** : `https://TON-ADRESSE.up.railway.app/auth/twitch/callback`
   - **Catégorie** : *Website Integration*
   - **Client Type** : *Confidential*
3. Ouvre l'application créée : copie le **Client ID**, puis clique sur **New Secret** et copie le secret.
4. Dans Railway, ajoute les variables `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET`.

Railway redémarre le site tout seul ; le bouton **« Se connecter avec Twitch »** apparaît sur la page des joueurs.

> En attendant cette étape, les viewers peuvent quand même jouer avec `!join` : leur loot est gardé de côté et
> récupéré dès qu'ils lient leur compte.

## Étape 7 : OBS

Dans OBS : **Sources** → **+** → **Navigateur** :
- URL : `https://TON-ADRESSE.up.railway.app/arena.html`
- Largeur `1280`, hauteur `720` (ou `1920` × `1080`)

Garde la page admin ouverte dans ton navigateur pour piloter la file et lancer les batailles.

---

## Bon à savoir

- **Mises à jour** : à chaque nouvelle version poussée sur GitHub, Railway reconstruit et redémarre le site
  automatiquement (environ 1 à 2 minutes). Évite de le faire **pendant** une bataille : elle serait interrompue.
- **Bot dans le chat (optionnel)** : ajoute `TWITCH_BOT_USERNAME` et `TWITCH_BOT_OAUTH` pour que le bot annonce
  l'ouverture de la file, les inscriptions et le vainqueur.
- **Les données de ton PC** (comptes créés en local) ne sont pas transférées : le site en ligne démarre à zéro.
- **Un seul serveur** : laisse le nombre d'instances (*replicas*) à 1 ; le combat est calculé en mémoire.
- **Nom de domaine perso** (ex. `jeu.zer0loot.fr`) : *Settings* → *Networking* → *Custom Domain*. Pense alors à
  mettre à jour `PUBLIC_URL` et l'URL de redirection dans la console Twitch.
- **Mot de passe admin oublié** : change simplement la variable `ADMIN_PASSWORD` dans Railway.
