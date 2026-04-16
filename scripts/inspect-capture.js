#!/usr/bin/env node
/* Analyse rapide d'une capture Footclubs :
   affiche URL, taille et clés top-level de chaque réponse. */

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '.cache', 'debug');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.log('Aucun fichier de capture trouvé dans .cache/debug/');
  process.exit(0);
}

const latest = files[files.length - 1];
console.log('📂 Analyse de :', latest, '\n');

const data = JSON.parse(fs.readFileSync(path.join(dir, latest)));

data.forEach((c, i) => {
  const raw = JSON.stringify(c.data);
  const size = raw.length;
  let keys = '';
  let extra = '';
  if (Array.isArray(c.data)) {
    extra = `[Array de ${c.data.length}]`;
    if (c.data.length > 0 && typeof c.data[0] === 'object') {
      keys = Object.keys(c.data[0]).slice(0, 12).join(', ');
    }
  } else if (c.data && typeof c.data === 'object') {
    keys = Object.keys(c.data).slice(0, 12).join(', ');
  } else {
    keys = typeof c.data;
  }
  console.log(`── [${i}] ${size} octets ──`);
  console.log(`URL : ${c.url}`);
  if (extra) console.log(`Type: ${extra}`);
  console.log(`Clés: ${keys}`);
  console.log('');
});

console.log(`\nPour voir le contenu complet d'une réponse :`);
console.log(`  node scripts/inspect-capture.js <numéro>`);

if (process.argv[2] != null) {
  const idx = Number(process.argv[2]);
  if (data[idx]) {
    console.log('\n' + '='.repeat(60));
    console.log(`CONTENU COMPLET de la réponse [${idx}]`);
    console.log('='.repeat(60) + '\n');
    console.log(JSON.stringify(data[idx].data, null, 2));
  }
}
