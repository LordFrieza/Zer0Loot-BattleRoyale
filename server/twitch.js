/*
 * Intégration Twitch :
 *  - lecture du chat de la chaîne (tmi.js, connexion anonyme possible) pour !join
 *  - réponses du bot dans le chat (optionnel, nécessite un token de bot)
 *  - liaison de compte via OAuth Twitch (optionnel, nécessite une application Twitch)
 */
const tmi = require('tmi.js');

const CHANNEL = (process.env.TWITCH_CHANNEL || 'zer0loot').toLowerCase();
const CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
const BOT_USERNAME = process.env.TWITCH_BOT_USERNAME || '';
const BOT_OAUTH = process.env.TWITCH_BOT_OAUTH || '';

let client = null;
let connected = false;

function startChat(onCommand) {
  if (process.env.TWITCH_CHAT_DISABLED === '1') {
    console.log('[twitch] lecture du chat désactivée (TWITCH_CHAT_DISABLED=1)');
    return;
  }
  const quiet = { info() {}, warn() {}, error() {} };
  const opts = { channels: [CHANNEL], connection: { reconnect: true, secure: true }, logger: quiet };
  if (BOT_USERNAME && BOT_OAUTH) {
    opts.identity = { username: BOT_USERNAME, password: BOT_OAUTH.startsWith('oauth:') ? BOT_OAUTH : 'oauth:' + BOT_OAUTH };
  }
  client = new tmi.Client(opts);
  client.on('connected', () => {
    connected = true;
    console.log(`[twitch] connecté au chat de #${CHANNEL}${opts.identity ? ' (bot ' + BOT_USERNAME + ')' : ' (lecture seule)'}`);
  });
  client.on('disconnected', (reason) => {
    connected = false;
    console.log('[twitch] déconnecté du chat :', reason);
  });
  client.on('message', (channel, tags, message, self) => {
    if (self) return;
    const text = message.trim().toLowerCase();
    if (!text.startsWith('!')) return;
    const command = text.split(/\s+/)[0];
    onCommand(command, { login: tags.username, displayName: tags['display-name'] || tags.username, id: tags['user-id'] });
  });
  client.connect().catch((err) => console.log('[twitch] connexion au chat impossible :', err.message || err));
}

function say(message) {
  if (!client || !connected || !BOT_OAUTH) return;
  client.say(CHANNEL, message).catch(() => {});
}

function oauthEnabled() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

function authorizeUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: '',
    state,
  });
  return 'https://id.twitch.tv/oauth2/authorize?' + params;
}

async function exchangeCode(code, redirectUri) {
  const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error('Échange du code Twitch refusé');
  const token = await tokenRes.json();
  const userRes = await fetch('https://api.twitch.tv/helix/users', {
    headers: { Authorization: 'Bearer ' + token.access_token, 'Client-Id': CLIENT_ID },
  });
  if (!userRes.ok) throw new Error('Impossible de lire le profil Twitch');
  const data = await userRes.json();
  const u = data.data && data.data[0];
  if (!u) throw new Error('Profil Twitch vide');
  return { id: u.id, login: u.login, displayName: u.display_name };
}

function status() {
  return { channel: CHANNEL, chatConnected: connected, botCanSpeak: !!BOT_OAUTH && connected, oauth: oauthEnabled() };
}

module.exports = { startChat, say, oauthEnabled, authorizeUrl, exchangeCode, status, CHANNEL };
