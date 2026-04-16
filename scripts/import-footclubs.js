#!/usr/bin/env node
/* =============================================================
   Import FDMI depuis Footclubs (footclubs.fff.fr)

   Mode d'emploi :
     npm install            # la première fois
     npm run import-match   # à chaque journée

   Ce script :
   1. Ouvre une vraie fenêtre Chrome (pas headless)
   2. Vous laisse vous connecter à Footclubs à la main (2FA OK)
   3. Enregistre votre session (cookies) pour la prochaine fois
   4. Capture tout le trafic JSON de l'API Footclubs pendant que
      vous naviguez vers la feuille de match à importer
   5. Extrait automatiquement les données joueurs si possible,
      sinon écrit un fichier de capture brute à analyser

   IMPORTANT : Footclubs change parfois. Si l'extraction échoue,
   un fichier de debug est créé dans .cache/debug/ — envoyez-le
   pour qu'on adapte les sélecteurs.
   ============================================================= */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(ROOT, '.cache', 'footclubs-profile');
const DEBUG_DIR = path.join(ROOT, '.cache', 'debug');
const OUTPUT_DIR = path.join(ROOT, 'imports');

[PROFILE_DIR, DEBUG_DIR, OUTPUT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

/* ========== Capture helpers ========== */
function shouldCapture(url) {
  return /footclubs\.fff\.fr|api\.fff\.fr|fff\.fr\/api/.test(url);
}

/* ========== Extraction heuristics ==========
   On cherche dans les réponses JSON capturées les formes connues
   d'une feuille de match. Chaque site FFF peut utiliser des clés
   différentes — on teste plusieurs variantes.
   ============================================ */
function extractMatch(captured) {
  // Candidats potentiels : on trie par taille de payload (plus c'est
  // gros, plus c'est probablement la FDMI complète)
  const candidates = captured
    .filter(c => c.data && typeof c.data === 'object')
    .sort((a, b) => JSON.stringify(b.data).length - JSON.stringify(a.data).length);

  for (const c of candidates) {
    const result = tryParseMatch(c.data, c.url);
    if (result) return result;
  }
  return null;
}

function tryParseMatch(data, url) {
  // Stratégie : chercher un objet qui contient une liste de joueurs
  // avec au moins un nom + un numéro ou une licence
  const players = findPlayerArray(data);
  if (!players || players.length === 0) return null;

  const matchInfo = findMatchInfo(data);

  const normalized = players.map(p => normalizePlayer(p)).filter(Boolean);
  if (normalized.length === 0) return null;

  return {
    meta: { extractedAt: new Date().toISOString(), source: 'footclubs', sourceUrl: url },
    match: matchInfo,
    players: normalized
  };
}

function findPlayerArray(obj, depth = 0) {
  if (depth > 8 || !obj) return null;
  if (Array.isArray(obj)) {
    if (obj.length > 0 && looksLikePlayer(obj[0])) return obj;
    for (const item of obj) {
      const r = findPlayerArray(item, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof obj === 'object') {
    // Clés courantes côté FFF
    const preferred = ['joueurs', 'joueursDomicile', 'joueursExterieur', 'composition', 'licencies', 'players'];
    for (const k of preferred) {
      if (Array.isArray(obj[k]) && obj[k].length > 0 && looksLikePlayer(obj[k][0])) return obj[k];
    }
    for (const k of Object.keys(obj)) {
      const r = findPlayerArray(obj[k], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function looksLikePlayer(o) {
  if (!o || typeof o !== 'object') return false;
  const keys = Object.keys(o).map(k => k.toLowerCase());
  const hasName = keys.some(k => /nom|lastname|prenom|firstname|licencie|libelle/.test(k));
  const hasNumberOrLicence = keys.some(k => /numero|maillot|dossard|licence|number/.test(k));
  return hasName && (hasNumberOrLicence || keys.some(k => /titul|rempl|entree|sortie|minute/.test(k)));
}

function findMatchInfo(obj, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return {};
  const date = obj.dateRencontre || obj.date || obj.dateMatch;
  const opponent = obj.adversaire || obj.equipeAdverse || obj.visiteur || obj.domicile;
  const competition = obj.competition || obj.libelleCompetition;
  if (date || opponent) {
    return {
      date: date ? String(date).slice(0, 10) : '',
      opponent: typeof opponent === 'string' ? opponent : (opponent?.nom || opponent?.libelle || ''),
      competition: typeof competition === 'string' ? competition : (competition?.libelle || '')
    };
  }
  for (const k of Object.keys(obj)) {
    const r = findMatchInfo(obj[k], depth + 1);
    if (r && r.date) return r;
  }
  return {};
}

function normalizePlayer(p) {
  if (!p || typeof p !== 'object') return null;
  const pick = (...keys) => {
    for (const k of keys) {
      if (p[k] != null && p[k] !== '') return p[k];
    }
    return '';
  };

  // Prénom / nom
  let firstName = pick('prenom', 'prenomLicencie', 'firstName', 'firstname');
  let lastName = pick('nom', 'nomLicencie', 'lastName', 'lastname');
  if (!firstName && !lastName) {
    const full = pick('libelle', 'nomComplet', 'name');
    if (full) {
      const parts = String(full).trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ');
    }
  }
  if (!firstName && !lastName) return null;

  const number = pick('numero', 'numeroMaillot', 'dossard', 'number');

  // Titulaire / remplaçant
  const roleRaw = String(pick('role', 'statut', 'position', 'titulaire', 'remplacant')).toLowerCase();
  let starter = null;
  if (p.titulaire === true || p.estTitulaire === true || /titul/.test(roleRaw)) starter = true;
  else if (p.remplacant === true || p.estRemplacant === true || /rempl|banc/.test(roleRaw)) starter = false;

  // Minutes : calculées depuis entrée/sortie si dispo
  let minutes = Number(pick('minutes', 'tempsJeu', 'minutesJouees')) || 0;
  const entree = Number(pick('minuteEntree', 'entree'));
  const sortie = Number(pick('minuteSortie', 'sortie'));
  if (!minutes) {
    if (starter === true) {
      minutes = isFinite(sortie) ? sortie : 90;
    } else if (starter === false && isFinite(entree)) {
      minutes = (isFinite(sortie) ? sortie : 90) - entree;
    }
  }

  const goals = Number(pick('buts', 'nbButs', 'goals')) || 0;

  return {
    number: number ? String(number) : '',
    firstName: String(firstName).trim(),
    lastName: String(lastName).trim(),
    starter: starter === true,
    minutes: Math.max(0, Math.min(120, minutes || 0)),
    goals,
    assists: 0 // pas dans la FDMI FFF
  };
}

/* ========== Main ========== */
async function main() {
  console.log('\n🚀 Lancement de Chromium...');
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: PROFILE_DIR,
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox']
  });

  const [page] = await browser.pages();
  const captured = [];

  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!shouldCapture(url)) return;
      const ct = response.headers()['content-type'] || '';
      if (!ct.includes('application/json')) return;
      const text = await response.text();
      if (!text) return;
      const data = JSON.parse(text);
      captured.push({ url, status: response.status(), data });
    } catch (e) {
      // Payload non-JSON ou lecture impossible : on ignore
    }
  });

  console.log('🌐 Ouverture de Footclubs...');
  await page.goto('https://footclubs.fff.fr/', { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\n' + '═'.repeat(64));
  console.log('👋  ACTIONS À EFFECTUER DANS LA FENÊTRE CHROME OUVERTE :');
  console.log('');
  console.log('   1. Connectez-vous à Footclubs (vos identifiants club)');
  console.log('   2. Allez dans "Compétitions" → "Feuilles de match"');
  console.log('   3. Ouvrez la FDMI du match à importer');
  console.log('   4. Attendez que la page soit entièrement chargée');
  console.log('   5. Revenez ici et appuyez sur ENTRÉE');
  console.log('');
  console.log('   (session sauvegardée pour la prochaine fois)');
  console.log('═'.repeat(64) + '\n');

  await waitForEnter();

  console.log(`\n📡 ${captured.length} réponses JSON capturées depuis Footclubs.`);

  // Debug dump : toujours, pour iterer
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const debugFile = path.join(DEBUG_DIR, `capture-${stamp}.json`);
  fs.writeFileSync(debugFile, JSON.stringify(captured, null, 2));
  console.log(`🔍 Capture brute : ${debugFile}`);

  const extracted = extractMatch(captured);
  if (extracted) {
    const dateTag = extracted.match?.date || stamp.slice(0, 10);
    const outFile = path.join(OUTPUT_DIR, `fdmi-${dateTag}.json`);
    fs.writeFileSync(outFile, JSON.stringify(extracted, null, 2));
    console.log(`\n✅ Feuille de match extraite :`);
    console.log(`   ${outFile}`);
    console.log(`   ${extracted.players.length} joueurs trouvés`);
    if (extracted.match?.opponent) console.log(`   vs ${extracted.match.opponent}`);
    console.log(`\n👉 Ouvrez l'app et importez ce fichier via "📥 Importer une FDMI".`);
  } else {
    console.log('\n⚠️  Extraction automatique échouée.');
    console.log(`   Les réponses Footclubs n'ont pas la structure attendue.`);
    console.log(`   Fichier de capture à envoyer pour adaptation :`);
    console.log(`   ${debugFile}`);
  }

  console.log('\n(Fermez la fenêtre Chrome pour terminer)');
  // On laisse la fenêtre ouverte pour inspection manuelle si besoin
}

function waitForEnter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question('', () => { rl.close(); resolve(); }));
}

main().catch(err => {
  console.error('❌ Erreur :', err.message);
  process.exit(1);
});
