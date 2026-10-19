---
name: smoke-arena
description: Test de fumée visuel de Zer0Loot Battle Royale avec Playwright : lance le serveur sans Twitch, ouvre la file, ajoute des bots, démarre une bataille et prend des captures de l'arène, de la page admin et de la fiche joueur. À utiliser après une modification de l'interface, du rendu canvas (arena.js, fighter.js) ou du combat, pour voir que ça marche dans un vrai navigateur.
---

# Test de fumée : arène, admin et fiche joueur

Les tests `npm test` ne couvrent pas `public/` : ce skill vérifie le rendu réel. Il utilise les outils Playwright (`mcp__plugin_playwright_playwright__browser_*`, à charger avec ToolSearch si besoin).

## 1. Lancer le serveur (port dédié, base jetable)

Dans Bash, en arrière-plan (`run_in_background`) :

```bash
TWITCH_CHAT_DISABLED=1 PORT=3100 ADMIN_PASSWORD=smoke-admin DATA_DIR="$TEMP/zl-smoke" node server/index.js
```

Attends que `curl -s localhost:3100/healthz` réponde `{"ok":true}`. La base est dans un dossier temporaire : rien dans `data/` n'est touché.

## 2. Scénario

Les routes d'admin demandent une session : dans le navigateur, connecte-toi par `fetch` depuis la page d'accueil, puis pilote la bataille avec des appels `fetch` (`browser_evaluate`), le cookie de session est conservé.

1. `browser_navigate` → `http://localhost:3100/` ; `browser_evaluate` :
   `fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'smoke-admin'})}).then(r=>r.status)` → attendu `200`.
2. `browser_navigate` → `/admin.html` ; capture. Vérifie que le point Twitch affiche le chat désactivé sans erreur.
3. Via `browser_evaluate` (`fetch` POST JSON) :
   - `/api/admin/event` `{event:'fast'}` (optionnel : la zone rapide termine la bataille plus vite ; ou `random`) ;
   - `/api/admin/queue/open` `{seconds:600}` ;
   - `/api/admin/queue/bots` `{count:8}` ;
   - `/api/admin/battle/start`.
4. Ouvre un second onglet (`browser_tabs`) sur `/arena.html` (1280×720 via `browser_resize`). Attends 5 s (`browser_wait_for`) et capture : on doit voir des personnages, des barres de vie, des déplacements. Capture à nouveau après 15 s.
5. Attends la fin (`/api/queue` → `phase: "ended"`, ou la zone après 45 s) : capture l'écran du vainqueur.
6. Fiche joueur : `/api/register` avec un pseudo de test, puis `/character.html` : parcours les onglets Personnage, Inventaire, Boutique, Succès, Classements, Règles (un clic + une capture chacun, ou `browser_snapshot`).

## 3. Contrôles

- `browser_console_messages` sur chaque page : **aucune erreur** (les avertissements de ressources sont tolérés).
- `browser_network_requests` : aucune réponse 4xx/5xx inattendue.
- Arène : les combattants bougent entre deux captures, les barres de vie baissent, il y a un vainqueur à la fin.
- Compare avec le comportement attendu dans `SPECIFICATION.md` (sections 7 et 20).

## 4. Nettoyer (obligatoire)

Arrête **uniquement** le serveur lancé au point 1, par son port (n'utilise jamais `pkill node` ni `taskkill /IM node.exe`, qui tueraient d'autres processus) :

```powershell
$p = (Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue).OwningProcess; if ($p) { Stop-Process -Id $p -Force }
```

Ferme le navigateur (`browser_close`).

## 5. Rapport

Dis ce que tu as vu (captures à l'appui), les erreurs de console, et tout écart avec le comportement attendu. Si tu n'as pas pu lancer une étape, dis-le : ne déclare pas le test réussi sans captures.
