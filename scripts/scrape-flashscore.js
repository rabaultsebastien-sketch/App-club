#!/usr/bin/env node
/* =============================================================
   Scraper FlashScore — US Orléans (National)

   Usage :
     npm install                          # la première fois
     node scripts/scrape-flashscore.js    # après chaque journée

   Ce script :
   1. Ouvre FlashScore National dans Chrome (non-headless)
   2. Trouve les matchs d'US Orléans
   3. Pour chaque match non encore importé, ouvre la page détail
   4. Extrait composition, minutes, buts, passes D, cartons
   5. Génère un fichier JSON importable dans l'app

   ============================================================= */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'imports');
const PROFILE_DIR = path.join(ROOT, '.cache', 'flashscore-profile');
[OUTPUT_DIR, PROFILE_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const TEAM_KEYWORDS = ['orl\u00e9ans', 'orleans'];
const TEAM_URL = 'https://www.flashscore.fr/equipe/us-orleans/llgrMnKF/';
const CALENDAR_URL = 'https://www.flashscore.fr/equipe/us-orleans/llgrMnKF/resultats/';

function matchesTeam(text) {
  if (!text) return false;
  const low = text.toLowerCase();
  return TEAM_KEYWORDS.some(k => low.includes(k));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(r => {
      let total = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 300);
        total += 300;
        if (total >= document.body.scrollHeight) { clearInterval(timer); r(); }
      }, 200);
      setTimeout(() => { clearInterval(timer); r(); }, 5000);
    });
  });
}

async function main() {
  console.log('\n\u{1F680} Lancement de Chrome...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--start-maximized', '--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = (await browser.pages())[0];
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // --- Page résultats de l'équipe ---
  console.log('\u{1F310} Chargement des résultats US Orléans...');
  await page.goto(CALENDAR_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  // Accepte les cookies si le bandeau apparaît
  try {
    const acceptBtn = await page.$('#onetrust-accept-btn-handler');
    if (acceptBtn) { await acceptBtn.click(); await sleep(1000); }
  } catch (_) {}

  // Scroll pour charger plus de matchs
  await autoScroll(page);
  await sleep(1000);

  // Sauvegarde debug : screenshot + structure HTML
  const debugDir = path.join(ROOT, '.cache', 'debug');
  fs.mkdirSync(debugDir, { recursive: true });
  await page.screenshot({ path: path.join(debugDir, 'flashscore-page.png'), fullPage: true });
  console.log(`📸 Screenshot: .cache/debug/flashscore-page.png`);

  // Dump la structure des éléments pour debug
  const pageStructure = await page.evaluate(() => {
    const result = [];
    // Cherche tous les éléments avec un id commençant par "g_"
    const byId = document.querySelectorAll('[id^="g_"]');
    result.push({ method: 'id^=g_', count: byId.length });
    // Cherche par classes connues (variantes FlashScore)
    const selectors = [
      '[class*="event__match"]', '[class*="sportName"]',
      '[class*="participant"]', '[class*="event__"]',
      'a[href*="/match/"]', '[class*="rows"]'
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      result.push({ selector: sel, count: els.length });
    }
    // Récupère les liens vers des matchs
    const matchLinks = document.querySelectorAll('a[href*="/match/"]');
    const linkSample = Array.from(matchLinks).slice(0, 5).map(a => ({
      href: a.getAttribute('href'),
      text: a.textContent.trim().slice(0, 80)
    }));
    result.push({ matchLinkSamples: linkSample });
    return result;
  });
  console.log('🔍 Structure page:', JSON.stringify(pageStructure, null, 2));

  // --- Extraction des matchs : stratégie multi-sélecteurs ---
  const matchLinks = await page.evaluate(() => {
    const links = [];
    const seen = new Set();

    // Stratégie 1 : éléments avec id "g_X_MATCHID"
    document.querySelectorAll('[id^="g_"]').forEach(row => {
      const id = row.id || '';
      const matchId = id.replace(/^g_\d+_/, '');
      if (!matchId || seen.has(matchId)) return;
      seen.add(matchId);
      const text = row.textContent || '';
      const homeEl = row.querySelector('[class*="participant--home"], [class*="homeParticipant"]');
      const awayEl = row.querySelector('[class*="participant--away"], [class*="awayParticipant"]');
      const home = homeEl ? homeEl.textContent.trim() : '';
      const away = awayEl ? awayEl.textContent.trim() : '';
      const scoreEls = row.querySelectorAll('[class*="score"], [class*="Score"]');
      const scores = Array.from(scoreEls).map(e => e.textContent.trim()).filter(s => /^\d+$/.test(s));
      const timeEl = row.querySelector('[class*="time"], [class*="Time"]');
      links.push({
        matchId, home, away,
        scoreHome: scores[0] || '', scoreAway: scores[1] || '',
        time: timeEl ? timeEl.textContent.trim() : ''
      });
    });

    // Stratégie 2 : liens <a> vers /match/XXXX/
    if (links.length === 0) {
      document.querySelectorAll('a[href*="/match/"]').forEach(a => {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/match\/([A-Za-z0-9]+)\//);
        if (!m || seen.has(m[1])) return;
        seen.add(m[1]);
        const row = a.closest('[class*="event"]') || a.closest('div') || a;
        const text = row.textContent.trim();
        links.push({
          matchId: m[1], home: '', away: '',
          scoreHome: '', scoreAway: '',
          time: '', rawText: text.slice(0, 120)
        });
      });
    }

    // Stratégie 3 : sélecteurs génériques FlashScore
    if (links.length === 0) {
      const rows = document.querySelectorAll('[class*="event__match"], [class*="sportName__match"]');
      rows.forEach(row => {
        const id = row.id || '';
        const matchId = id.replace(/^g_\d+_/, '') || ('row_' + Math.random().toString(36).slice(2, 8));
        if (seen.has(matchId)) return;
        seen.add(matchId);
        links.push({
          matchId, home: '', away: '',
          scoreHome: '', scoreAway: '',
          time: '', rawText: (row.textContent || '').trim().slice(0, 120)
        });
      });
    }

    return links;
  });

  console.log(`\u{1F4CB} ${matchLinks.length} match(s) trouvés sur la page.`);

  if (matchLinks.length === 0) {
    console.log('\n\u26A0\uFE0F Aucun match trouvé. FlashScore a peut-être changé sa structure.');
    console.log('Essayez de naviguer manuellement dans la fenêtre Chrome ouverte.');
    await waitForClose(browser);
    return;
  }

  // Affiche les matchs trouvés
  matchLinks.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.time} | ${m.home} ${m.scoreHome} - ${m.scoreAway} ${m.away}`);
  });

  // --- Pour chaque match, extraire les détails ---
  const allResults = [];
  for (let i = 0; i < matchLinks.length; i++) {
    const m = matchLinks[i];
    console.log(`\n\u{1F50D} [${i + 1}/${matchLinks.length}] ${m.home} vs ${m.away}...`);

    try {
      const detail = await scrapeMatchDetail(page, m.matchId);
      if (detail) {
        detail.home = m.home;
        detail.away = m.away;
        detail.scoreHome = m.scoreHome;
        detail.scoreAway = m.scoreAway;
        allResults.push(detail);
        console.log(`   \u2705 ${detail.players.length} joueurs extraits`);
      } else {
        console.log('   \u26A0\uFE0F Pas de composition trouvée');
      }
    } catch (err) {
      console.log(`   \u274C Erreur: ${err.message}`);
    }
  }

  // --- Sauvegarde ---
  if (allResults.length > 0) {
    const stamp = new Date().toISOString().slice(0, 10);
    const outFile = path.join(OUTPUT_DIR, `flashscore-orleans-${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify(allResults, null, 2));
    console.log(`\n\u2705 ${allResults.length} match(s) extraits : ${outFile}`);
    console.log('\u{1F449} Importez ce fichier dans l\'app via "Importer FlashScore".');
  } else {
    console.log('\n\u26A0\uFE0F Aucune donnée extraite.');
  }

  console.log('\n(Fermez Chrome pour terminer)');
  await waitForClose(browser);
}

async function scrapeMatchDetail(page, matchId) {
  const url = `https://www.flashscore.fr/match/${matchId}/`;

  // --- Onglet Compositions ---
  await page.goto(url + '#/compositions', { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(2000);

  // Essaye de cliquer sur l'onglet "Compositions" si pas chargé
  try {
    const tabs = await page.$$('[class*="tabs__tab"]');
    for (const tab of tabs) {
      const text = await tab.evaluate(el => el.textContent.trim().toLowerCase());
      if (text.includes('compo') || text.includes('lineup')) {
        await tab.click();
        await sleep(1500);
        break;
      }
    }
  } catch (_) {}

  // Extraction des joueurs depuis la page compositions
  const lineups = await page.evaluate(() => {
    const players = [];

    // FlashScore lineup sections
    const sections = document.querySelectorAll('[class*="lf__side"], [class*="lineup--home"], [class*="lineup--away"], [class*="section"]');

    // Méthode générique : cherche tous les éléments qui ressemblent à des joueurs
    const allPlayerEls = document.querySelectorAll(
      '[class*="lf__cell"], [class*="lineup-player"], [class*="smv__participantRow"]'
    );

    for (const el of allPlayerEls) {
      const name = el.querySelector('[class*="participantName"], [class*="lf__name"], [class*="name"]');
      const number = el.querySelector('[class*="jersey"], [class*="number"], [class*="lf__no"]');
      if (!name) continue;

      // Détermine l'équipe (home/away) en remontant dans le DOM
      let team = 'unknown';
      let parent = el;
      for (let depth = 0; depth < 10; depth++) {
        parent = parent.parentElement;
        if (!parent) break;
        const cls = parent.className || '';
        if (/home|--1|left/i.test(cls)) { team = 'home'; break; }
        if (/away|--2|right/i.test(cls)) { team = 'away'; break; }
      }

      players.push({
        name: name.textContent.trim(),
        number: number ? number.textContent.trim().replace(/[^\d]/g, '') : '',
        team
      });
    }

    return players;
  });

  // --- Onglet Résumé (buts, cartons, remplacements) ---
  await page.goto(url + '#/resume-du-match', { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1500);

  // Essaye aussi "#/resume"
  try {
    const tabs = await page.$$('[class*="tabs__tab"]');
    for (const tab of tabs) {
      const text = await tab.evaluate(el => el.textContent.trim().toLowerCase());
      if (text.includes('résum') || text.includes('summary') || text.includes('resume')) {
        await tab.click();
        await sleep(1500);
        break;
      }
    }
  } catch (_) {}

  const events = await page.evaluate(() => {
    const evts = [];
    const rows = document.querySelectorAll(
      '[class*="smv__incident"], [class*="event__incident"], [class*="incident"]'
    );

    for (const row of rows) {
      const text = row.textContent.trim();
      const timeEl = row.querySelector('[class*="time"], [class*="minute"]');
      const time = timeEl ? timeEl.textContent.trim() : '';

      // Type d'événement par icône/classe
      const cls = (row.innerHTML || '').toLowerCase();
      let type = 'unknown';
      if (/goal|but|soccer-ball|footballGoal/.test(cls)) type = 'goal';
      else if (/yellowcard|yellow-card|carton.*jaune|y-card/.test(cls)) type = 'yellowCard';
      else if (/redcard|red-card|carton.*rouge|r-card/.test(cls)) type = 'redCard';
      else if (/substitution|remplacement|sub-in|sub-out/.test(cls)) type = 'substitution';
      else if (/assist|passe/.test(cls)) type = 'assist';

      // Nom du joueur
      const nameEl = row.querySelector('[class*="participantName"], [class*="name"], a');
      const name = nameEl ? nameEl.textContent.trim() : '';

      // Côté (home/away)
      let team = 'unknown';
      let parent = row;
      for (let d = 0; d < 10; d++) {
        parent = parent.parentElement;
        if (!parent) break;
        const c = parent.className || '';
        if (/home|--1|left/i.test(c)) { team = 'home'; break; }
        if (/away|--2|right/i.test(c)) { team = 'away'; break; }
      }

      evts.push({ type, name, time, team, text: text.slice(0, 100) });
    }
    return evts;
  });

  // --- Extraction date depuis la page ---
  const matchDate = await page.evaluate(() => {
    const el = document.querySelector('[class*="startTime"], [class*="duelParticipant__startTime"]');
    return el ? el.textContent.trim() : '';
  });

  if (lineups.length === 0) return null;

  // --- Consolidation ---
  const players = buildPlayerList(lineups, events);

  return {
    matchId,
    date: parseFlashscoreDate(matchDate),
    players,
    rawEvents: events
  };
}

function buildPlayerList(lineups, events) {
  const players = lineups.map(p => ({
    name: p.name,
    number: p.number,
    team: p.team,
    starter: true, // sera corrigé ci-dessous pour les remplaçants
    minutes: 90,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    subIn: null,
    subOut: null
  }));

  const byName = {};
  players.forEach(p => { byName[normName(p.name)] = p; });

  for (const evt of events) {
    const key = normName(evt.name);
    const p = byName[key];

    if (evt.type === 'goal') {
      if (p) p.goals++;
    } else if (evt.type === 'yellowCard') {
      if (p) p.yellowCards++;
    } else if (evt.type === 'redCard') {
      if (p) p.redCards++;
    } else if (evt.type === 'substitution') {
      const minute = parseInt(evt.time) || 0;
      // Le texte peut contenir "Joueur A → Joueur B"
      // Le joueur sortant a subOut = minute, l'entrant a subIn = minute
      if (p) {
        p.subOut = minute;
        p.minutes = minute;
      }
    }
  }

  // Marque les joueurs qui sont des remplaçants entrés
  for (const p of players) {
    if (p.subIn) {
      p.starter = false;
      p.minutes = 90 - p.subIn;
    }
  }

  return players;
}

function normName(name) {
  return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function parseFlashscoreDate(raw) {
  if (!raw) return '';
  // Format FlashScore : "08.08.2025 19:30" ou "08/08/2025"
  const m = raw.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (!m) return raw;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function waitForClose(browser) {
  return new Promise(resolve => {
    browser.on('disconnected', resolve);
  });
}

main().catch(err => {
  console.error('\u274C Erreur:', err.message);
  process.exit(1);
});
