/*
 * Envoi d'e-mails (vérification d'adresse, mot de passe oublié), sans dépendance : par l'API web d'un service.
 *  - MAIL_PROVIDER = brevo (gratuit, 300 e-mails / jour, expéditeur = une simple adresse vérifiée chez Brevo)
 *                  ou resend (domaine à vérifier) ;
 *  - MAIL_API_KEY  = la clé d'API du service ;
 *  - MAIL_FROM     = l'adresse d'expéditeur (ex. minilooteur@gmail.com), MAIL_FROM_NAME = le nom affiché.
 * Sans configuration, hors production, les e-mails sont simplement écrits dans la console (mode « log ») ; en
 * production, l'envoi est désactivé (configured() = false) et l'interface le dit.
 * Les derniers e-mails « envoyés » restent dans `outbox` (tests, mode log).
 */
const PROVIDERS = ['brevo', 'resend'];
const outbox = [];

function provider() {
  const p = String(process.env.MAIL_PROVIDER || '').toLowerCase();
  if (PROVIDERS.includes(p) && process.env.MAIL_API_KEY && process.env.MAIL_FROM) return p;
  if (process.env.NODE_ENV !== 'production') return 'log';
  return null;
}
const configured = () => !!provider();

async function send({ to, subject, text, html }) {
  const p = provider();
  if (!p) throw new Error('L\'envoi d\'e-mails n\'est pas configuré sur le serveur');
  const mail = { at: Date.now(), to, subject, text, html, provider: p };
  outbox.push(mail);
  if (outbox.length > 20) outbox.shift();
  const fromName = process.env.MAIL_FROM_NAME || 'Minilooteur';
  if (p === 'log') {
    console.log(`[mail] (mode log, aucun e-mail réel) à ${to} : ${subject}\n${text}`);
    return { ok: true };
  }
  const req = p === 'brevo'
    ? { url: 'https://api.brevo.com/v3/smtp/email', headers: { 'api-key': process.env.MAIL_API_KEY },
      body: { sender: { email: process.env.MAIL_FROM, name: fromName }, to: [{ email: to }], subject, textContent: text, htmlContent: html } }
    : { url: 'https://api.resend.com/emails', headers: { Authorization: `Bearer ${process.env.MAIL_API_KEY}` },
      body: { from: `${fromName} <${process.env.MAIL_FROM}>`, to: [to], subject, text, html } };
  const res = await fetch(req.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...req.headers }, body: JSON.stringify(req.body) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[mail] échec de l'envoi (${p}, ${res.status}) : ${detail.slice(0, 300)}`);
    throw new Error('L\'e-mail n\'a pas pu être envoyé, réessaie plus tard');
  }
  return { ok: true };
}

// Mise en page commune des e-mails (texte brut + HTML simple aux couleurs du jeu)
function layout(title, lines, button) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = [title, '', ...lines, '', button ? `${button.label} : ${button.url}` : '', '', '— Minilooteur (Zer0Loot Battle Royale)'].join('\n');
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;background:#0e0a26;color:#f1edff;padding:24px">
    <div style="max-width:520px;margin:auto;background:#1c1142;border:1px solid #3b2c80;border-radius:12px;padding:22px">
      <h2 style="margin:0 0 14px;color:#ffc21a">${esc(title)}</h2>
      ${lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${esc(l)}</p>`).join('')}
      ${button ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="background:#b83cff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(button.label)}</a></p>
      <p style="font-size:12px;color:#a59cd6">Si le bouton ne marche pas, copie ce lien : ${esc(button.url)}</p>` : ''}
      <p style="font-size:12px;color:#a59cd6;margin-top:18px">— Minilooteur (Zer0Loot Battle Royale)</p>
    </div></div>`;
  return { text, html };
}

module.exports = { send, configured, provider, layout, outbox };
