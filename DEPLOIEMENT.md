# 🚀 Mettre le jeu en ligne 24 h/24 (Fly.io)

Avec `npm start`, le jeu tourne **sur ton PC** : dès que tu fermes la fenêtre, le site s'arrête.
Pour qu'il reste ouvert en permanence, on le confie à un **hébergeur**, c'est-à-dire un ordinateur dans
un datacenter qui le fait tourner à ta place, jour et nuit.

On utilise **[Fly.io](https://fly.io)** :
- une petite machine à **Paris** (proche de tes viewers), qui **ne s'endort jamais**, ce qui est indispensable
  pour que `!join` soit lu dans le chat à tout moment ;
- un **disque permanent** (« volume ») pour sauvegarder les comptes, les persos et le loot ;
- le HTTPS et les connexions en direct (WebSocket) de l'arène, sans rien configurer.

> 💶 **Coût** : environ **3 à 5 $/mois** pour une machine `shared-cpu-1x` de 512 Mo, plus **0,15 $/Go/mois** pour
> le disque (1 Go suffit largement). Fly.io facture à l'usage et demande une carte bancaire à l'inscription.
> Tu peux suivre la consommation dans le tableau de bord (*Billing*). Vérifie les tarifs à jour sur
> <https://fly.io/pricing>.

Les fichiers de configuration sont déjà dans le projet (`Dockerfile`, `fly.toml`). Tu n'as **rien à coder** :
il suffit de taper quelques commandes. Compte une demi-heure la première fois.

---

## Étape 1 : préparer le code sur ton PC

1. Le code est sur la branche `claude/web-twitch-game-prototype-76mb03`. Le plus simple est de la fusionner dans la
   branche principale (`main`) de ton dépôt `LordFrieza/Zer0Loot-BattleRoyale` (via une *Pull Request* sur GitHub,
   je peux la créer pour toi).
2. Récupère le code à jour sur ton PC (avec GitHub Desktop, ou `git pull` dans le dossier du projet).
   Toutes les commandes `fly` qui suivent se tapent **dans ce dossier** (celui qui contient `fly.toml`).

## Étape 2 : installer l'outil Fly et créer ton compte

1. Installe l'outil en ligne de commande `fly` :
   - **Windows** (dans PowerShell) :
     ```powershell
     powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
     ```
   - **Mac / Linux** :
     ```bash
     curl -L https://fly.io/install.sh | sh
     ```
   Ferme puis rouvre le terminal, et vérifie avec `fly version`. Si `fly` est introuvable, essaie `flyctl`
   (c'est le même outil).
2. Crée ton compte (ou connecte-toi) : `fly auth signup` (ou `fly auth login`). Une page s'ouvre dans le navigateur.
3. Ajoute une carte bancaire dans le tableau de bord Fly.io (*Billing*), sinon les étapes suivantes sont refusées.

## Étape 3 : créer l'application

1. Ouvre `fly.toml` et regarde la ligne `app = "zer0loot-battleroyale"`. Ce nom doit être **unique sur tout Fly.io**.
2. Crée l'application :
   ```bash
   fly apps create zer0loot-battleroyale
   ```
   Si Fly répond que le nom est déjà pris, choisis-en un autre (par exemple `zer0loot-br`), recommence la commande
   avec ce nom, puis **remplace-le aussi dans `fly.toml`**.

L'adresse de ton site sera `https://<nom-de-l-application>.fly.dev`, par exemple
`https://zer0loot-battleroyale.fly.dev`.

## Étape 4 : créer le disque permanent (très important)

Sans lui, **tous les comptes et le loot seraient effacés** à chaque mise à jour.

```bash
fly volumes create zer0loot_data --region cdg --size 1
```

Fly prévient qu'un volume unique n'est pas copié sur une autre machine et demande de confirmer : réponds **y** (oui).
C'est voulu : le combat est calculé en mémoire sur **une seule** machine. Le nom `zer0loot_data` et la région `cdg`
(Paris) doivent rester ceux de `fly.toml`.

## Étape 5 : les réglages secrets

Le nom de la chaîne (`zer0loot`) est déjà dans `fly.toml`. Il reste deux réglages, qu'on donne en « secrets »
(ils ne sont jamais visibles dans le code) :

```bash
fly secrets set ADMIN_PASSWORD="un-mot-de-passe-solide" PUBLIC_URL="https://zer0loot-battleroyale.fly.dev"
```

| Nom | Valeur |
|---|---|
| `ADMIN_PASSWORD` | un mot de passe solide de ton choix (c'est celui du compte `admin`) |
| `PUBLIC_URL` | l'adresse exacte de ton site, **sans `/` à la fin** (remplace le nom si tu en as choisi un autre) |

En ligne, le mot de passe par défaut `admin` est interdit : sans `ADMIN_PASSWORD`, le serveur en invente un au hasard
et l'écrit dans le journal (`fly logs`, ligne `[admin] mot de passe généré`). Mieux vaut choisir le tien.

## Étape 6 : premier déploiement

```bash
fly deploy --ha=false
```

Fly construit l'image à partir du `Dockerfile` (sur ses serveurs, rien à installer chez toi) puis démarre la machine.
Compte 2 à 3 minutes. `--ha=false` demande **une seule machine**, ce qui est indispensable ici.

Vérifie ensuite que tout va bien :

```bash
fly status        # une seule machine, état « started », vérification « passing »
fly logs          # le journal en direct (Ctrl + C pour quitter)
```

Dans le journal, tu dois voir `Zer0Loot Battle Royale → http://localhost:3000` et
`[twitch] connecté au chat de #zer0loot`. Si `fly status` montre **deux** machines, garde-en une seule avec `fly scale count 1`.

Le site est en ligne ! Ouvre l'adresse, connecte-toi avec `admin` et ton mot de passe : tu arrives sur l'écran de
combat. En haut à droite, le **point vert « Chat #zer0loot »** confirme que le chat Twitch est bien lu.

## Étape 7 : activer « Se connecter avec Twitch »

En ligne, la liaison « en tapant son pseudo » est **désactivée**, car n'importe qui pourrait se faire passer pour
un autre viewer et récupérer son loot. Les joueurs lient donc leur compte via la vraie connexion Twitch :

1. Active la **double authentification** sur ton compte Twitch (Twitch l'exige pour créer une application).
2. Va sur <https://dev.twitch.tv/console/apps> → **Register Your Application** (*Enregistrer votre application*).
   - **Nom** : `Zer0Loot Battle Royale` (doit être unique sur Twitch, ajoute un mot si le nom est pris)
   - **OAuth Redirect URLs** : `https://zer0loot-battleroyale.fly.dev/auth/twitch/callback`
     (avec ton adresse, si tu as choisi un autre nom)
   - **Catégorie** : *Website Integration*
   - **Client Type** : *Confidential*
3. Ouvre l'application créée : copie le **Client ID**, puis clique sur **New Secret** et copie le secret.
4. Donne-les au serveur :
   ```bash
   fly secrets set TWITCH_CLIENT_ID="ton-client-id" TWITCH_CLIENT_SECRET="ton-secret"
   ```

Fly redémarre le site tout seul ; le bouton **« Se connecter avec Twitch »** apparaît sur la page des joueurs.

> En attendant cette étape, les viewers peuvent quand même jouer avec `!join` : leur loot est gardé de côté et
> récupéré dès qu'ils lient leur compte.

## Étape 8 : OBS

Dans OBS : **Sources** → **+** → **Navigateur** :
- URL : `https://zer0loot-battleroyale.fly.dev/arena.html`
- Largeur `1280`, hauteur `720` (ou `1920` × `1080`)

Garde la page admin ouverte dans ton navigateur pour piloter la file et lancer les batailles.

---

## Mettre le site à jour

À chaque nouvelle version du code, récupère-la sur ton PC (`git pull`) puis :

```bash
fly deploy
```

Le site redémarre en 1 à 2 minutes ; les comptes et le loot sont conservés sur le disque. Évite de le faire
**pendant** une bataille : elle serait interrompue (les paris en cours sont remboursés au redémarrage).

### Option : mise à jour automatique depuis GitHub

Pour que chaque modification de `main` soit mise en ligne toute seule :

1. Crée une clé de déploiement : `fly tokens create deploy` et copie le texte obtenu.
2. Sur GitHub : dépôt → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**,
   nom `FLY_API_TOKEN`, valeur : la clé.
3. Ajoute au dépôt le fichier `.github/workflows/fly-deploy.yml` :
   ```yaml
   name: Déploiement Fly.io
   on:
     push:
       branches: [main]
   jobs:
     deploy:
       runs-on: ubuntu-latest
       concurrency: deploy-group
       steps:
         - uses: actions/checkout@v4
         - uses: superfly/flyctl-actions/setup-flyctl@master
         - run: flyctl deploy --remote-only
           env:
             FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
   ```

## Sauvegardes

- Fly prend **automatiquement un instantané** du disque chaque jour (gardé 5 jours par défaut) :
  `fly volumes list` pour l'identifiant du volume, puis `fly volumes snapshots list <identifiant>`.
- Pour garder une copie de la base sur ton PC :
  ```bash
  fly ssh sftp get /data/db.json db-sauvegarde.json
  ```

## Importer une base existante (optionnel)

Si tu as déjà des comptes ailleurs (sur ton PC : `data/db.json` dans le dossier du projet, ou une sauvegarde
d'un ancien hébergeur), tu peux les reprendre :

1. Envoie le fichier sur le serveur, sous un autre nom :
   ```bash
   fly ssh sftp shell
   ```
   puis, dans le shell qui s'ouvre : `put db.json /data/import.json`, et quitte avec `Ctrl + D`.
2. Ouvre une console sur le serveur avec `fly ssh console`, et tape **dans cette console** :
   ```sh
   cp /data/import.json /data/db.json && kill -9 $(pidof node)
   ```
   On arrête le jeu brutalement **exprès** : un arrêt normal réécrirait `db.json` avec les données en mémoire,
   ce qui écraserait l'import. La machine redémarre aussitôt toute seule et charge la base importée.
3. Vérifie avec `fly logs`, puis connecte-toi au site avec un compte importé.

Fais-le en dehors d'une bataille : elle serait interrompue.

---

## Bon à savoir

- **Une seule machine** : ne lance jamais `fly scale count 2` ; le combat et la file sont calculés en mémoire, et le
  disque ne peut être branché qu'à une machine.
- **La machine reste toujours allumée** : `fly.toml` désactive l'arrêt automatique (`auto_stop_machines = "off"`)
  et redémarre le serveur s'il s'arrête (`[[restart]] policy = "always"`, visible avec `fly machine status -d`).
- **Bot dans le chat (optionnel)** : `fly secrets set TWITCH_BOT_USERNAME="…" TWITCH_BOT_OAUTH="oauth:…"` pour que
  le bot annonce l'ouverture de la file, les inscriptions et le vainqueur.
- **Nom de domaine perso** (ex. `jeu.zer0loot.fr`) : `fly certs add jeu.zer0loot.fr`, puis crée chez ton registraire
  l'enregistrement DNS indiqué par Fly (un `CNAME` vers `zer0loot-battleroyale.fly.dev`). Pense ensuite à mettre à
  jour `PUBLIC_URL` (`fly secrets set PUBLIC_URL="https://jeu.zer0loot.fr"`) et l'URL de redirection dans la
  console Twitch.
- **Mot de passe admin oublié** : `fly secrets set ADMIN_PASSWORD="nouveau-mot-de-passe"`.
- **Plus de mémoire** (beaucoup de joueurs simultanés) : `fly scale memory 1024` (le prix augmente un peu).
- **Le site ne répond plus** : `fly status` puis `fly logs` pour voir l'erreur ; `fly machine restart` pour relancer.
