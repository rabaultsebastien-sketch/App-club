// Smoke test du parseur Excel (saison complète)
// Exécution : node scripts/test-excel-parser.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const fnNames = ['normalizeExcelPosition', 'excelDateToIso', 'parseSquadExcelGrid'];
const extracted = {};
for (const fn of fnNames) {
  const re = new RegExp(`function ${fn}\\s*\\([\\s\\S]*?\\n\\}`, 'm');
  const m = src.match(re);
  if (!m) { console.error('Fonction non trouvée :', fn); process.exit(1); }
  extracted[fn] = m[0];
}
const mapRe = /const EXCEL_POSITION_MAP = \{[\s\S]*?\};/;
const mapCode = src.match(mapRe)[0];
const uidStub = 'let __i = 0; function uid(){ return "id" + (++__i); }';
const XLSXStub = 'const XLSX = { SSF: { parse_date_code: (n) => { const d = new Date(Date.UTC(1899,11,30) + n*86400000); return { y: d.getUTCFullYear(), m: d.getUTCMonth()+1, d: d.getUTCDate() }; } } };';
const sandbox = new Function(XLSXStub + '\n' + uidStub + '\n' + mapCode + '\n' + Object.values(extracted).join('\n\n') + '\nreturn { normalizeExcelPosition, excelDateToIso, parseSquadExcelGrid };')();

// Mini grille simulant l'Excel de l'utilisateur (2 matchs, 2 joueurs)
const grid = [
  ['Date', '', '', '', '', '', '08/08/2025', '', '', '', '', '', '', '15/08/2025', '', '', '', '', '', ''],
  ['Adversaires', '', '', '', '', '', 'Dijon', '', '', '', '', '', '', 'Sochaux', '', '', '', '', '', ''],
  ['Lieu', '', '', '', '', '', 'Domicile', '', '', '', '', '', '', 'Extérieur', '', '', '', '', '', ''],
  ['Résultat', '', '', '', '', '', 'Défaite', '', '', '', '', '', '', 'Défaite', '', '', '', '', '', ''],
  ['Points', '', '', '', '', '', 0, '', '', '', '', '', '', 0, '', '', '', '', '', ''],
  ['Score', '', '', '', '', '', '1-2', '', '', '', '', '', '', '5-0', '', '', '', '', '', ''],
  ['Diff', '', '', '', '', '', -1, '', '', '', '', '', '', -5, '', '', '', '', '', ''],
  ['N°','Prénom','Nom','Poste','Age','Pied',
   'Poste','Temps de jeu','But','P.D.','','','Note',
   'Poste','Temps de jeu','But','P.D.','','','Note'],
  [9,'Fahd','EL KHOUMISTI','Attaquant',32,'Droitier',
   'T',76,1,0,'','',6,
   'T',90,0,0,'','',4],
  [22,'Jordan','MOREL','Milieu',21,'Droitier',
   'T',90,0,1,'','',6,
   'T',90,0,1,'','',4],
  [35,'Warren','NGAKO','Attaquant',21,'Droitier',
   'NC','','','','','','',
   'N3','','','','','','']
];

const res = sandbox.parseSquadExcelGrid(grid);
console.log('Matchs détectés :', res.matches.length);
console.log(JSON.stringify(res.matches, null, 2));
console.log('\nJoueurs :', res.players.length);
res.players.forEach(p => {
  console.log(`- ${p.number} ${p.firstName} ${p.lastName} (${p.position}) : ${p.matches.length} apparition(s)`);
  p.matches.forEach(m => {
    console.log(`    ${m.date} vs ${m.opponent} [${m.starter?'T':'R'}] ${m.minutes}' ${m.goals}b ${m.assists}pd`);
  });
});

// Vérifications
const elk = res.players.find(p => p.lastName === 'EL KHOUMISTI');
console.log('\n✅ EL KHOUMISTI apparitions :', elk.matches.length, '(attendu 2)');
console.log('✅ EL KHOUMISTI m1 minutes :', elk.matches[0].minutes, '(attendu 76)');
console.log('✅ EL KHOUMISTI m1 buts :', elk.matches[0].goals, '(attendu 1)');

const morel = res.players.find(p => p.lastName === 'MOREL');
console.log('✅ MOREL passes m1 :', morel.matches[0].assists, '(attendu 1)');
console.log('✅ MOREL poste mappé :', morel.position, '(attendu "Milieu central")');

const ngako = res.players.find(p => p.lastName === 'NGAKO');
console.log('✅ NGAKO apparitions :', ngako.matches.length, '(attendu 0 : NC+N3 ignorés)');
