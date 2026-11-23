'use strict';
// Envoi d'e-mails par SMTP sur TLS (port 465), sans dépendance.
// Compatible Gmail avec un « mot de passe d'application ».
const tls = require('node:tls');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const enteteUtf8 = (s) => `=?UTF-8?B?${b64(s)}?=`;
const decoupe = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const propre = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();

function configure(cfg) {
  return Boolean(cfg && cfg.host && cfg.user && cfg.pass);
}

function envoyer(cfg, { to, subject, text, replyTo }) {
  if (!configure(cfg)) return Promise.resolve({ envoye: false, raison: 'smtp_non_configure' });
  const port = Number(cfg.port || 465);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: cfg.host, port, servername: cfg.host });
    socket.setEncoding('utf8');
    socket.setTimeout(20000, () => socket.destroy(new Error('Délai SMTP dépassé')));
    let tampon = '';
    let attente = null;

    socket.on('data', (d) => {
      tampon += d;
      const lignes = tampon.split('\r\n');
      tampon = lignes.pop();
      for (const l of lignes) {
        if (/^\d{3} /.test(l) && attente) { const a = attente; attente = null; a(l); }
      }
    });
    socket.on('error', reject);

    const lire = () => new Promise((r) => { attente = r; });
    const cmd = async (ligne, attendu) => {
      if (ligne !== null) socket.write(ligne + '\r\n');
      const rep = await lire();
      if (!rep.startsWith(String(attendu))) throw new Error(`SMTP : réponse inattendue « ${rep} »`);
      return rep;
    };

    const de = cfg.from || cfg.user;
    const message = [
      `From: MS Techniker <${propre(de)}>`,
      `To: ${propre(to)}`,
      replyTo ? `Reply-To: ${propre(replyTo)}` : null,
      `Subject: ${enteteUtf8(propre(subject))}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      decoupe(b64(text)),
    ].filter((l) => l !== null).join('\r\n');

    (async () => {
      try {
        await cmd(null, 220);
        await cmd(`EHLO mstechniker`, 250);
        await cmd('AUTH LOGIN', 334);
        await cmd(b64(cfg.user), 334);
        await cmd(b64(cfg.pass), 235);
        await cmd(`MAIL FROM:<${propre(de)}>`, 250);
        await cmd(`RCPT TO:<${propre(to)}>`, 250);
        await cmd('DATA', 354);
        await cmd(message + '\r\n.', 250);
        socket.write('QUIT\r\n');
        socket.end();
        resolve({ envoye: true });
      } catch (e) {
        socket.destroy();
        reject(e);
      }
    })();
  });
}

module.exports = { envoyer, configure };
