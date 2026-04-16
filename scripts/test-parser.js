// Test unitaire du parseur FDMI avec les lignes réelles fournies
// À exécuter : node scripts/test-parser.js

const fs = require('fs');
const path = require('path');

// Extrait les fonctions du parseur depuis app.js
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const parserFns = [
  'tryParseFdmiPdf',
  'findFdmiSections',
  'findNextSection',
  'parseDoubleColumnLine',
  'parsePlayerTokens',
  'parseGoalLine',
  'parseRemplacementRows',
  'parseDisciplineRows',
  'normalizeName'
];
// Extrait chaque fonction via regex (brut mais suffisant pour le test)
const extracted = {};
for (const fn of parserFns) {
  const re = new RegExp(`function ${fn}\\s*\\([\\s\\S]*?\\n\\}`, 'm');
  const m = appSrc.match(re);
  if (!m) { console.error('Fonction non trouvée:', fn); process.exit(1); }
  extracted[fn] = m[0];
}
const sandbox = new Function(Object.values(extracted).join('\n\n') + '\nreturn { ' + parserFns.join(', ') + ' };')();

// Lignes extraites de la FDMI (fournies par l'utilisateur)
const lines = [
  'FEUILLE DE MATCH',
  'Information du Match N° 53441338 (25740546)',
  'FEDERATION FRANCAISE DE FOOTBALL',
  'Date : 10/04/2026 19h30 Equipe recevante Equipe visiteuse',
  'Compétition : National / Fff / Poule Arrêté :',
  'Orleans Us 45 1 Concarneau Us 1',
  'Unique',
  'Terrain : STADE DE LA SOURCE 1 Résultat 1',
  'Non Joué :',
  'Tirs au but',
  'Prolongation',
  'OFFICIELS',
  'Arbitre centre DASQUE Jean Guillaume 2544246389 Arbitre assistant 1 BOURDON Adrien 2544914110',
  'Arbitre assistant 2 HEBRARD Frederic 1820496339 Délégué principal BAHI Nouredine 329206418',
  'Délégué adjoint 1 GRANGER Martial 1620158023 Médecin MARTIN GISLAIN',
  'Technicien lumière Astreinte municipale',
  'COMPOSITION',
  'Equipe Recevante Equipe Visiteuse',
  'Orleans Us 45 1 - 504891 Concarneau Us 1 - 500308',
  '1 FAHAM Fei Hong 2546060623 1 VIOT Vincent 1616013725',
  '5 DIABY Mamadou 9604383030 4 JANNEZ Guillaume (Capitaine) 2257727288',
  '6 KEBE Kouroufia 2546248197 5 ETCHEVERRIA Baptiste 2543500507',
  '8 GIRAUDON Jimmy 1182420487 6 SEBA Djessine 2543729697',
  '9 EL KHOUMISTI Fahd 1606020252 8 PICOULEAU Mathis 2543918459',
  '10 KHOUS Guillaume (Capitaine) 2308078460 9 TELL Jordan 2739116145',
  '19 LEGENDRE Robin 2544841316 10 GBELLE Garland 480624420',
  '21 DIAKO Mamadou 2546189710 18 DA SILVA Flavio 2544284142',
  '22 MOREL Jordan 2546016624 21 BALDONI Sohan 2546035979',
  '23 MOUTON Esteban 2545577420 23 GOUJON Loic 821831079',
  '29 OBIANG Johann 1012148464 27 HALBY TOURE Jimmy 9603511937',
  'REMPLAÇANTS',
  "3 BAUDRY Marvin 2067113547 N'a pas participé 7 VARVAT Jules 2544466662",
  "16 COUREL Arsene 2545610681 N'a pas participé 11 SOUKOUNA Youssouf 2545609555",
  '25 BA Papa Ibnou 2548593537 20 NTUMI Matheo 2547582871',
  '28 LUYAMBULA BIWA Steven 2546123296 25 SEYDI Amadou 2543563011',
  "31 AOULADZIAN Youness 2543771544 40 PATRON Pierre 2543311483 N'a pas participé",
  'BANC',
  'DELLA MAGGIORE Herve 2520250353 E ROSSI Stephane 170001794 E',
  'LOUIS Cedric 2200968672 D CARIOU Matthieu 2287726254 M',
  'REMPLACEMENT',
  "25 - BA Papa 2544284142 18 - DA SILVA Flavio 2547582871 20 - NTUMI Matheo 64' + 0'",
  'BUTEURS',
  "Equipe N° licence NOM Prénom Type but Action précédente Passeur Min (+)",
  "Concarneau Us 2544284142 18 - DA SILVA Flavio Du pied Aucune 40' + 0'",
  "Orleans Us 45 1606020252 9 - EL KHOUMISTI Fahd Du pied Passe 22 - MOREL Jordan 62' + 0'",
];

const result = sandbox.tryParseFdmiPdf(lines);
if (!result) {
  console.log('❌ Parseur a retourné null');
  process.exit(1);
}

console.log('📋 Match :', JSON.stringify(result.match, null, 2));
console.log(`\n👥 ${result.players.length} joueurs extraits :\n`);
result.players.forEach(p => {
  const tag = p.starter ? 'T' : (p.didNotPlay ? 'X' : 'R');
  const goals = p.goals > 0 ? ` ⚽${p.goals}` : '';
  const assists = p.assists > 0 ? ` 🅰️${p.assists}` : '';
  console.log(`  [${tag}] #${p.number.padStart(2)} ${p.lastName.padEnd(20)} ${p.firstName.padEnd(15)} (${p.team}) ${p.minutes}'${goals}${assists}`);
});

// Vérifications attendues
console.log('\n✅ Vérifications :');
const usoPlayers = result.players.filter(p => p.team === 'home');
const concarneau = result.players.filter(p => p.team === 'away');
console.log(`   Orleans (home) : ${usoPlayers.length} joueurs (attendu 16)`);
console.log(`   Concarneau (away) : ${concarneau.length} joueurs (attendu 16)`);

const elKhoumisti = result.players.find(p => p.lastName.includes('KHOUMISTI'));
console.log(`   EL KHOUMISTI buts : ${elKhoumisti?.goals} (attendu 1)`);

const morel = result.players.find(p => p.lastName === 'MOREL' && p.team === 'home');
console.log(`   MOREL passes D : ${morel?.assists} (attendu 1)`);

const baudry = result.players.find(p => p.lastName === 'BAUDRY');
console.log(`   BAUDRY didNotPlay : ${baudry?.didNotPlay} (attendu true)`);

const luyambula = result.players.find(p => p.lastName.includes('LUYAMBULA'));
console.log(`   LUYAMBULA BIWA : ${luyambula?.lastName} (attendu "LUYAMBULA BIWA")`);

/* ------------------------------------------------------------------ */
/* Test 2 : parseur REMPLACEMENT avec colonnes (simule l'extraction PDF) */
/* ------------------------------------------------------------------ */
console.log('\n🔁 Test REMPLACEMENT (colonnes gauche/droite) :');
const rowsWithCols = lines.map(l => ({ text: l, leftText: '', rightText: '' }));
// Injecte le leftText/rightText pour la ligne REMPLACEMENT (idx 41)
const remIdx = lines.findIndex(l => /25 - BA Papa/.test(l));
if (remIdx !== -1) {
  rowsWithCols[remIdx] = {
    text: lines[remIdx],
    leftText: "10 - KHOUS Guillaume 2308078460 25 - BA Papa Ibnou 2548593537 75' + 0'",
    rightText: "18 - DA SILVA Flavio 2544284142 20 - NTUMI Matheo 2547582871 64' + 0'"
  };
}
const result2 = sandbox.tryParseFdmiPdf(rowsWithCols);
const khous = result2.players.find(p => p.lastName === 'KHOUS' && p.team === 'home');
const ba = result2.players.find(p => p.lastName === 'BA' && p.team === 'home');
const daSilva = result2.players.find(p => p.lastName === 'DA SILVA' && p.team === 'away');
const ntumi = result2.players.find(p => p.lastName === 'NTUMI' && p.team === 'away');
console.log(`   KHOUS (titulaire sorti à 75') : ${khous?.minutes}' (attendu 75)`);
console.log(`   BA (entré à 75') : ${ba?.minutes}' (attendu 15)`);
console.log(`   DA SILVA (titulaire sorti à 64') : ${daSilva?.minutes}' (attendu 64)`);
console.log(`   NTUMI (entré à 64') : ${ntumi?.minutes}' (attendu 26)`);
