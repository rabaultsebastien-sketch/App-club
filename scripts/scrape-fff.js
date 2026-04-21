#!/usr/bin/env node
/* =============================================================
   Scraper FFF — US Orléans (National)

   Source : epreuves.fff.fr (site officiel)

   Usage :
     node scripts/scrape-fff.js          # matchs récents
     node scripts/scrape-fff.js --test   # 1 seul match (debug)
   ============================================================= */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'imports');
const DEBUG_DIR = path.join(ROOT, '.cache', 'debug-fff');
[OUTPUT_DIR, DEBUG_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const FFF_URL = 'https://epreuves.fff.fr/competition/engagement/1-national/phase/1/1/resultats-et-calendrier';
const TEAM_KEYWORDS = ['orléans', 'orleans'];
const BASE_URL = 'https://epreuves.fff.fr';
const TEST_MODE = process.argv.includes('--test');
const URL_IDX = process.argv.indexOf('--url');
const SINGLE_URL = URL_IDX !== -1 ? process.argv[URL_IDX + 1] : null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normName(name) {
  return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function matchesTeam(text) {
  if (!text) return false;
  return TEAM_KEYWORDS.some(kw => normName(text).includes(normName(kw)));
}

(async () => {
  console.log('🚀 Lancement de Chrome...');
  const browser = await puppeteer.launch({
    headless: false,
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--window-size=1400,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  try {
    // ─── Single-match mode (via --url flag) ───
    if (SINGLE_URL) {
      console.log(`🎯 Match ciblé: ${SINGLE_URL}`);
      // Accept cookies on first navigation
      await page.goto(SINGLE_URL, { waitUntil: 'networkidle2', timeout: 45000 });
      await sleep(2000);
      try {
        const btn = await page.$('#didomi-notice-agree-button');
        if (btn) { await btn.click(); await sleep(1000); console.log('🍪 Cookies acceptés'); }
      } catch (_) {}

      const detail = await scrapeMatchDetail(page, SINGLE_URL, true);
      if (detail && detail.players.length > 0) {
        const g = detail.players.reduce((s, p) => s + p.goals, 0);
        const c = detail.players.reduce((s, p) => s + p.yellowCards + p.redCards, 0);
        const starters = detail.players.filter(p => p.starter).length;
        const subs = detail.players.filter(p => !p.starter).length;
        console.log(`   ✅ ${detail.players.length} joueurs (${starters} titu + ${subs} rempl.) | ${g} but(s), ${c} carton(s)`);
        printPlayerTable(detail);

        const stamp = new Date().toISOString().slice(0, 10);
        const slug = SINGLE_URL.split('/').slice(-2, -1)[0].slice(0, 40);
        const outFile = path.join(OUTPUT_DIR, `fff-orleans-${slug}-${stamp}.json`);
        fs.writeFileSync(outFile, JSON.stringify([detail], null, 2));
        console.log(`\n✅ Match → ${outFile}`);
      } else {
        console.log('   ⚠️ Pas de données');
      }
      console.log('\n(Fermez Chrome pour terminer)');
      await new Promise(r => browser.on('disconnected', r));
      return;
    }

    console.log('🌐 Ouverture FFF résultats...');
    await page.goto(FFF_URL, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(3000);

    // Accept cookies
    try {
      const btn = await page.$('#didomi-notice-agree-button');
      if (btn) { await btn.click(); await sleep(1000); console.log('🍪 Cookies acceptés'); }
    } catch (_) {}

    // Find Orléans match links (check href and container text)
    const matchLinks = await page.evaluate((base, kws) => {
      const allMatchLinks = document.querySelectorAll('a[href*="/competition/match/"]');
      const debug = { total: allMatchLinks.length, sampleHrefs: [] };
      const links = [];
      const seen = new Set();

      allMatchLinks.forEach(a => {
        const href = a.getAttribute('href') || '';
        if (seen.has(href)) return;
        if (debug.sampleHrefs.length < 5) debug.sampleHrefs.push(href);

        // Check if "orleans" is in the href itself
        const hrefLower = href.toLowerCase();
        const inHref = kws.some(kw => hrefLower.includes(kw));

        // Check if "orleans" is in the surrounding container text
        const container = a.closest('div, tr, li, section');
        const containerText = container ? container.textContent.toLowerCase() : '';
        const inContainer = kws.some(kw => containerText.includes(kw));

        if (inHref || inContainer) {
          seen.add(href);
          links.push(href.startsWith('http') ? href : base + href);
        }
      });

      return { links, debug };
    }, BASE_URL, TEAM_KEYWORDS.map(k => k.toLowerCase()));

    console.log(`📋 ${matchLinks.debug.total} liens match total, ${matchLinks.links.length} Orléans`);
    if (matchLinks.debug.total > 0 && matchLinks.links.length === 0) {
      console.log('   Exemples de liens:');
      for (const h of matchLinks.debug.sampleHrefs) console.log(`   → ${h}`);
    }

    if (matchLinks.links.length === 0) {
      // Maybe the page shows a week without Orléans matches — try navigating back
      console.log('🔄 Navigation vers les semaines précédentes...');
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await page.evaluate(() => {
            const prevBtns = document.querySelectorAll('button, a, [class*="prev"], [class*="Prev"], [class*="navigation"]');
            for (const btn of prevBtns) {
              const t = btn.textContent.trim().toLowerCase();
              const cls = (btn.className || '').toLowerCase();
              if (t.includes('précédent') || t.includes('previous') || cls.includes('prev') || t === '<' || t === '‹') {
                btn.click();
                return true;
              }
            }
            // Also try aria-label
            const ariaBtn = document.querySelector('[aria-label*="précédent"], [aria-label*="previous"]');
            if (ariaBtn) { ariaBtn.click(); return true; }
            return false;
          });
          await sleep(3000);

          const found = await page.evaluate((base, kws) => {
            const links = [];
            const seen = new Set();
            document.querySelectorAll('a[href*="/competition/match/"]').forEach(a => {
              const href = a.getAttribute('href') || '';
              if (seen.has(href)) return;
              const hrefLower = href.toLowerCase();
              if (kws.some(kw => hrefLower.includes(kw))) {
                seen.add(href);
                links.push(href.startsWith('http') ? href : base + href);
              }
            });
            return links;
          }, BASE_URL, TEAM_KEYWORDS.map(k => k.toLowerCase()));

          if (found.length > 0) {
            console.log(`   ✅ ${found.length} match(s) trouvés`);
            matchLinks.links.push(...found);
            break;
          }
        } catch (_) {}
      }
    }

    if (matchLinks.links.length === 0) {
      console.log('⚠️ Aucun match Orléans trouvé après navigation');
      try { await page.screenshot({ path: path.join(DEBUG_DIR, 'fff-no-matches.png') }); } catch (_) {}
      console.log('\n(Fermez Chrome pour terminer)');
      await new Promise(r => browser.on('disconnected', r));
      return;
    }

    const toProcess = TEST_MODE ? matchLinks.links.slice(0, 1) : matchLinks.links.slice(0, 5);
    if (TEST_MODE) console.log('\n🧪 MODE TEST — 1 seul match\n');

    const allResults = [];
    for (let i = 0; i < toProcess.length; i++) {
      const url = toProcess[i];
      const slug = url.split('/').pop().slice(0, 70);
      console.log(`🔍 [${i + 1}/${toProcess.length}] ${slug}...`);

      try {
        const detail = await scrapeMatchDetail(page, url, i === 0);
        if (detail && detail.players.length > 0) {
          allResults.push(detail);
          const g = detail.players.reduce((s, p) => s + p.goals, 0);
          const c = detail.players.reduce((s, p) => s + p.yellowCards + p.redCards, 0);
          const starters = detail.players.filter(p => p.starter).length;
          const subs = detail.players.filter(p => !p.starter).length;
          console.log(`   ✅ ${detail.players.length} joueurs (${starters} titu + ${subs} rempl.) | ${g} but(s), ${c} carton(s)`);

          if (TEST_MODE) printPlayerTable(detail);
        } else {
          console.log('   ⚠️ Pas de données');
        }
      } catch (err) {
        console.log(`   ❌ ${err.message}`);
      }
    }

    if (allResults.length > 0) {
      const stamp = new Date().toISOString().slice(0, 10);
      const outFile = path.join(OUTPUT_DIR, `fff-orleans-${stamp}.json`);
      fs.writeFileSync(outFile, JSON.stringify(allResults, null, 2));
      console.log(`\n✅ ${allResults.length} match(s) → ${outFile}`);
    } else {
      console.log('\n⚠️ Aucune donnée extraite.');
    }

  } catch (err) {
    console.log(`❌ ${err.message}`);
  }

  console.log('\n(Fermez Chrome pour terminer)');
  await new Promise(r => browser.on('disconnected', r));
})();

// ─── Match detail extraction ────────────────────────────────────────

async function scrapeMatchDetail(page, matchUrl, isFirst) {
  await page.goto(matchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  if (isFirst) {
    try {
      await page.screenshot({ path: path.join(DEBUG_DIR, 'match-page.png') });
      fs.writeFileSync(path.join(DEBUG_DIR, 'match-page.html'),
        await page.evaluate(() => document.body.innerHTML));
    } catch (_) {}
  }

  // ─── Extract all structured data from the page ───
  const raw = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    // Find ALL table rows with number + name pattern
    const tableRows = [];
    document.querySelectorAll('table tr').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (cells.length >= 2) {
        const texts = cells.map(c => c.textContent.trim());
        tableRows.push(texts);
      }
    });

    // Find team names (typically in specific elements near the score)
    const teamNames = [];
    const teamEls = document.querySelectorAll('h1, h2, h3, [class*="team"], [class*="Team"], [class*="club"], [class*="Club"]');
    for (const el of teamEls) {
      const t = el.textContent.trim();
      if (t.length >= 4 && t.length <= 50) teamNames.push(t);
    }

    // Also find team names from page title or main heading
    const titleMatch = document.title.match(/(.+?)\s*[-–vs]\s*(.+?)(?:\s*\||\s*$)/);

    // Try to find score from DOM elements
    let domScore = '';
    for (const sel of ['[class*="score"]', '[class*="Score"]', '[class*="result"]', '[data-testid*="score"]']) {
      for (const el of document.querySelectorAll(sel)) {
        const t = el.textContent.trim();
        if (/^\d{1,2}\s*[-–]\s*\d{1,2}$/.test(t)) { domScore = t; break; }
      }
      if (domScore) break;
    }

    return { lines: lines.slice(0, 200), tableRows: tableRows.slice(0, 80), teamNames, title: document.title, domScore };
  });

  // ─── Parse team names ───
  const isEventText = (s) => /changement|avertissement|but\s+pour|inscrit|averti|exclu|remplace|passeur|carton|voir plus|journée|\d+'|résumé|vidéo|statistique|composition|feuille/i.test(s);

  let homeTeam = '', awayTeam = '';
  const urlSlug = matchUrl.split('/').slice(-2, -1)[0] || matchUrl.split('/').pop() || '';

  // Strategy 1: team name elements — skip event text, navigation, and section headers
  for (const tn of raw.teamNames) {
    if (isEventText(tn) || tn.length < 4 || tn.length > 50) continue;
    if (!homeTeam) homeTeam = tn;
    else if (tn !== homeTeam) { awayTeam = tn; break; }
  }

  // Strategy 2: fallback to page lines, skipping event text
  if (!homeTeam || !awayTeam) {
    for (const line of raw.lines) {
      if (isEventText(line) || line.length < 4 || line.length > 40) continue;
      if (!matchesTeam(line) && !/\b(FC|SC|US|AS|AC|SO|FBBP|QRM|SM|EA)\b/.test(line)) continue;
      if (!homeTeam) homeTeam = line;
      else if (line !== homeTeam && !homeTeam.includes(line) && !line.includes(homeTeam)) {
        awayTeam = line; break;
      }
    }
  }

  // Clean team names: strip trailing digits (minute concatenation artifact like "ORLEANS US 45")
  const cleanTeam = (t) => (t || '').replace(/\s+\d+\s*$/, '').replace(/\s+/g, ' ').trim();
  homeTeam = cleanTeam(homeTeam);
  awayTeam = cleanTeam(awayTeam);

  // Strategy 3: Extract team names from URL slug as reliable fallback
  // URL format: "53441348-sporting-club-aubagne-air-bel-u-s-orleans-loiret-football"
  if (!homeTeam || !awayTeam || isEventText(homeTeam) || isEventText(awayTeam)) {
    const slug = urlSlug.replace(/^\d+-/, '');
    const orleansMatch = slug.match(/(u-s-orleans[\w-]*)/);
    if (orleansMatch) {
      const parts = slug.split(orleansMatch[1]);
      const homePart = parts[0].replace(/-+$/, '').replace(/-/g, ' ').trim().toUpperCase();
      const awayPart = orleansMatch[1].replace(/-/g, ' ').trim().toUpperCase()
        .replace(/LOIRET FOOTBALL$/, '').trim();
      if (homePart.length >= 3) homeTeam = homeTeam || homePart;
      if (awayPart.length >= 3) awayTeam = awayTeam || awayPart;
    }
  }

  // ─── Find score ───
  let scoreHome = '', scoreAway = '';
  // Strategy 1: DOM element with score class
  if (raw.domScore) {
    const m = raw.domScore.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
    if (m) { scoreHome = m[1]; scoreAway = m[2]; }
  }
  // Strategy 2: standalone "X - Y" line
  if (!scoreHome) {
    for (const line of raw.lines) {
      const m = line.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
      if (m) { scoreHome = m[1]; scoreAway = m[2]; break; }
    }
  }
  // Strategy 3: short line containing "X - Y" (not dates or journée)
  if (!scoreHome) {
    for (const line of raw.lines) {
      if (line.length > 15 || /\d{4}/.test(line) || /journée/i.test(line)) continue;
      const m = line.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
      if (m) { scoreHome = m[1]; scoreAway = m[2]; break; }
    }
  }
  // Strategy 4: scores on separate lines between team names (FFF layout: TEAM \n 0 \n 2 \n TEAM)
  if (!scoreHome) {
    for (let i = 1; i < raw.lines.length - 2; i++) {
      if (/^\d{1,2}$/.test(raw.lines[i]) && /^\d{1,2}$/.test(raw.lines[i + 1])) {
        const before = raw.lines[i - 1] || '';
        const after = raw.lines[i + 2] || '';
        if (before.length >= 3 && after.length >= 3 && !/^\d+$/.test(before) && !/^\d+$/.test(after)) {
          scoreHome = raw.lines[i];
          scoreAway = raw.lines[i + 1];
          break;
        }
      }
    }
  }

  // ─── Find date ───
  let matchDate = '';
  const monthMap = {
    janvier: '01', 'février': '02', mars: '03', avril: '04', mai: '05', juin: '06',
    juillet: '07', 'août': '08', septembre: '09', octobre: '10', novembre: '11', 'décembre': '12',
    jan: '01', fev: '02', 'fév': '02', mar: '03', avr: '04', mai: '05', jun: '06',
    jui: '07', jul: '07', 'aoû': '08', aou: '08', sep: '09', oct: '10', nov: '11', 'déc': '12', dec: '12'
  };
  const monthNames = Object.keys(monthMap).sort((a, b) => b.length - a.length).join('|');
  const dateRe = new RegExp(`(\\d{1,2})\\s+(${monthNames})\\w*\\s+(\\d{4})`, 'i');
  for (const line of raw.lines) {
    const dm = line.match(dateRe);
    if (dm) {
      const key = dm[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const monthNum = monthMap[dm[2].toLowerCase()] || monthMap[key];
      if (monthNum) {
        matchDate = `${dm[3]}-${monthNum}-${dm[1].padStart(2, '0')}`;
        break;
      }
    }
  }

  // ─── Find round ───
  let round = '';
  for (const line of raw.lines) {
    const rm = line.match(/journée\s+(\d+)/i);
    if (rm) { round = `Journée ${rm[1]}`; break; }
  }

  // ─── Determine our side ───
  // PRIMARY: use URL slug — home team appears first, away team after
  // e.g. "sporting-club-aubagne-air-bel-u-s-orleans-loiret-football"
  // → "u-s-orleans" is in the second half → Orléans is AWAY
  const slugLower = urlSlug.replace(/^\d+-/, '').toLowerCase();
  const orleansIdx = slugLower.search(/(orleans|u-s-orleans)/);
  let isHome;
  if (orleansIdx >= 0) {
    isHome = orleansIdx < slugLower.length / 2;
  } else {
    // Fallback: check team names (only if homeTeam looks like a real name, not event text)
    isHome = matchesTeam(homeTeam) && !isEventText(homeTeam);
  }
  const ourSide = isHome ? 'home' : 'away';
  const opponent = isHome ? awayTeam : homeTeam;

  console.log(`   📋 ${homeTeam} ${scoreHome}-${scoreAway} ${awayTeam} (${round}) — Orléans ${isHome ? 'Domicile' : 'Extérieur'}`);

  // ─── Extract players from tables ───
  // FFF feuille de match: tables with rows [number, name, ...]
  // Two blocks: home team first (11 starters + ~5 subs), then away team (11 + ~5)
  const allPlayers = [];
  const KNOWN_TEAMS = ['dijon', 'sochaux', 'rouen', 'fleury', 'puy', 'versailles', 'valenciennes',
    'caen', 'villefranche', 'aubagne', 'concarneau', 'paris 13', 'quevilly', 'bourg', 'chateauroux',
    'briochin', 'fcvb', 'fbbp', 'qrm', 'berri', 'nimes', 'orleans', 'orléans', 'brieuc', 'stade',
    'boulogne', 'boulogne-sur-mer', 'martigues', 'thonon', 'goal', 'sporting', 'racing'];
  // Regex for generic team suffixes / standings cells
  const TEAM_SUFFIX = /\b(FC|SC|US|AS|AC|CS|SO|EA|SCO|FCO|OGC|SM|CA|CSG|RCS|OL|UFC|STADE|FOOTBALL|CLUB|ATHLETIC|SPORTIF)\b/;

  for (const row of raw.tableRows) {
    // Check for number + name pattern
    for (let ci = 0; ci < row.length - 1; ci++) {
      const num = row[ci].replace(/[^\d]/g, '');
      const name = row[ci + 1];
      if (!/^\d{1,2}$/.test(num)) continue;
      if (!name || name.length < 3 || name.length > 50) continue;

      // Reject names with digits (player names never contain digits — "ORLEANS US 45", "-14")
      if (/\d/.test(name)) continue;
      // Reject names with leading dash (goal differentials like "-14")
      if (/^-/.test(name)) continue;

      // Skip if this looks like a standings row (team name or team suffix)
      const lower = name.toLowerCase();
      if (KNOWN_TEAMS.some(t => lower.includes(t))) continue;
      if (TEAM_SUFFIX.test(name)) continue;

      // Skip duplicates
      if (allPlayers.some(p => p.name === name)) continue;

      allPlayers.push({ number: num, name });
    }
  }

  if (isFirst) console.log(`   🔎 ${allPlayers.length} joueurs trouvés dans les tables`);

  // ─── Split into two teams ───
  // The FFF page lists home team first, then away team.
  // Heuristic: detect team boundary when jersey #1 appears again (second GK)
  let splitIdx = -1;
  for (let i = 1; i < allPlayers.length; i++) {
    if (allPlayers[i].number === '1' && i >= 10) {
      splitIdx = i;
      break;
    }
  }

  let homePlayers, awayPlayers;
  if (splitIdx > 0) {
    homePlayers = allPlayers.slice(0, splitIdx);
    awayPlayers = allPlayers.slice(splitIdx);
  } else {
    // Fallback: split in half
    const half = Math.ceil(allPlayers.length / 2);
    homePlayers = allPlayers.slice(0, half);
    awayPlayers = allPlayers.slice(half);
  }

  if (isFirst) console.log(`   🔎 Split: ${homePlayers.length} home, ${awayPlayers.length} away`);

  // Pick Orléans side
  const ourPlayers = isHome ? homePlayers : awayPlayers;

  // Mark starters (first 11) vs subs
  const players = ourPlayers.map((p, i) => ({
    name: p.name,
    number: p.number,
    team: ourSide,
    starter: i < 11,
    minutes: i < 11 ? 90 : 0,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0
  }));

  // ─── Extract events from Angular <app-moment-fort> components ───
  // The FFF page is an Angular app. Events are inside <app-moment-fort> elements:
  //   <app-moment-fort class="match ng-star-inserted">
  //     <span class="timer text-bold-sm">48'</span>
  //     <div class="content">
  //       <div class="action visiteur ng-star-inserted">
  //         <span class="text-base">Avertissement pour ORLEANS US 45</span>
  //         <span class="text-sm">KOUROUFIA KEBE est averti</span>
  //       </div>
  //     </div>
  //   </app-moment-fort>

  // Wait for events to render (no tab click needed — they're on the default view)
  await sleep(2000);

  if (isFirst) {
    try {
      await page.screenshot({ path: path.join(DEBUG_DIR, 'match-events.png') });
      fs.writeFileSync(path.join(DEBUG_DIR, 'match-events.html'),
        await page.evaluate(() => document.body.innerHTML));
    } catch (_) {}
  }

  const eventBlocks = await page.evaluate(() => {
    const blocks = [];

    // Primary: query Angular <app-moment-fort> components
    const moments = document.querySelectorAll('app-moment-fort');
    for (const el of moments) {
      // Get minute from .timer span
      const timerEl = el.querySelector('[class*="timer"], .timer');
      let minute = 0;
      if (timerEl) {
        const m = timerEl.textContent.trim().match(/(\d+)/);
        if (m) minute = parseInt(m[1]);
      }

      // Get event text from .content div
      const contentEl = el.querySelector('.content');
      const text = contentEl ? contentEl.textContent.trim() : el.textContent.trim();

      // Get team side from .action element class
      const actionEl = el.querySelector('.action');
      const side = actionEl
        ? (actionEl.classList.contains('visiteur') ? 'away' : actionEl.classList.contains('recevant') ? 'home' : '')
        : '';

      if (text.length > 5) {
        blocks.push({ minute, text, side });
      }
    }

    // Fallback: if no <app-moment-fort> found, search DOM broadly
    if (blocks.length === 0) {
      const KW = /inscrit|averti|exclu|remplace|changement|avertissement|carton|passeur|buteur/i;
      const seen = new Set();
      for (const el of document.querySelectorAll('div, span, p, li, td')) {
        if (el.children.length > 8) continue;
        const t = el.textContent.trim();
        if (t.length >= 8 && t.length <= 400 && KW.test(t) && !seen.has(t)) {
          seen.add(t);
          blocks.push({ minute: 0, text: t, side: '' });
        }
      }
    }

    return blocks;
  });

  if (isFirst) {
    console.log(`   📊 ${eventBlocks.length} événements <app-moment-fort>:`);
    for (const b of eventBlocks) console.log(`      ${b.minute}' [${b.side}] ${b.text.slice(0, 80)}`);
  }

  // Player name lookup — map surname parts (≥3 chars) to player objects
  const playersByName = {};
  for (const p of players) {
    for (const part of normName(p.name).split(/\s+/)) {
      if (part.length >= 3) {
        if (!playersByName[part] || part.length > playersByName[part]._keyLen) {
          playersByName[part] = p;
          p._keyLen = part.length;
        }
      }
    }
  }

  function findPlayerInText(text) {
    if (!text) return null;
    const n = normName(text);
    let best = null, bestLen = 0;
    for (const [key, player] of Object.entries(playersByName)) {
      if (key.length < 3) continue;
      const idx = n.indexOf(key);
      if (idx < 0) continue;
      // Word boundary: char before and after must be non-letter (or start/end)
      const before = idx > 0 ? n[idx - 1] : ' ';
      const after = idx + key.length < n.length ? n[idx + key.length] : ' ';
      if (/[a-z]/.test(before) || /[a-z]/.test(after)) continue;
      if (key.length > bestLen) {
        best = player;
        bestLen = key.length;
      }
    }
    return best;
  }

  // Filter to our team's events only (skip opponent events)
  const opposingSide = ourSide === 'home' ? 'away' : 'home';
  const ourEvents = eventBlocks.filter(b => b.side !== opposingSide);

  if (isFirst) {
    console.log(`   🎯 ${ourEvents.length} événements Orléans (sur ${eventBlocks.length} total)`);
  }

  // Process each event block
  const appliedEvents = [];

  for (const block of ourEvents) {
    const { minute, text } = block;

    if (/inscrit\s*par|buteur/i.test(text) || (/\bbut\b/i.test(text) && !/remplace|changement/i.test(text))) {
      const parts = text.split(/inscrit\s*par/i);
      const scorer = parts.length > 1 ? findPlayerInText(parts[parts.length - 1]) : findPlayerInText(text);
      if (scorer) {
        scorer.goals++;
        appliedEvents.push(`⚽ ${minute}' ${scorer.name}`);
      }
      const am = text.match(/pass(?:eur|e)\s+d[ée]cisiv[eo]?\s*(?:de|:)?\s*(.*)/i);
      if (am) {
        const assister = findPlayerInText(am[1]);
        if (assister) {
          assister.assists++;
          appliedEvents.push(`🅰️ ${minute}' PD: ${assister.name}`);
        }
      }

    } else if ((/est\s+averti|avertissement|carton\s+jaune/i.test(text)) && !/exclu|rouge/i.test(text)) {
      const player = findPlayerInText(text);
      if (player) {
        player.yellowCards++;
        appliedEvents.push(`🟡 ${minute}' ${player.name}`);
      }

    } else if (/est\s+exclu|carton\s+rouge/i.test(text)) {
      const player = findPlayerInText(text);
      if (player) {
        player.redCards++;
        appliedEvents.push(`🔴 ${minute}' ${player.name}`);
      }

    } else if (/remplace/i.test(text)) {
      const parts = text.split(/remplace/i);
      const playerIn = findPlayerInText(parts[0]);
      const playerOut = parts.length > 1 ? findPlayerInText(parts[1]) : null;
      if (playerIn || playerOut) {
        if (playerOut && minute > 0) playerOut.minutes = minute;
        if (playerIn && minute > 0) playerIn.minutes = 90 - minute;
        appliedEvents.push(`🔄 ${minute}' ${playerIn ? playerIn.name : '?'} ← ${playerOut ? playerOut.name : '?'}`);
      }

    } else if (/pass(?:eur|e)\s+d[ée]cisiv/i.test(text)) {
      const player = findPlayerInText(text);
      if (player) {
        player.assists++;
        appliedEvents.push(`🅰️ ${minute}' PD: ${player.name}`);
      }
    }
  }

  if (isFirst) {
    console.log(`   ✅ ${appliedEvents.length} événements appliqués:`);
    for (const e of appliedEvents) console.log(`      ${e}`);
  }
  // Cleanup temp property
  for (const p of players) delete p._keyLen;

  if (players.length === 0) return null;

  const title = (homeTeam && awayTeam) ? `${homeTeam} - ${awayTeam}` : '';

  return {
    matchId: urlSlug,
    date: matchDate,
    round,
    title,
    home: homeTeam,
    away: awayTeam,
    scoreHome,
    scoreAway,
    venue: isHome ? 'Domicile' : 'Extérieur',
    opponent,
    players,
    rawEvents: eventBlocks.map(b => `${b.minute}' ${b.text}`)
  };
}

async function clickTab(page, keywords) {
  try {
    await page.evaluate((kws) => {
      const els = document.querySelectorAll('a, button, [role="tab"], li, nav a');
      for (const el of els) {
        const t = el.textContent.trim().toLowerCase();
        for (const kw of kws) {
          if (t.includes(kw) && t.length < 30) { el.click(); return; }
        }
      }
    }, keywords);
  } catch (_) {}
}

function printPlayerTable(detail) {
  console.log(`\n   ${detail.home} ${detail.scoreHome}-${detail.scoreAway} ${detail.away} — ${detail.round}`);
  console.log('   ┌────┬──────────────────────────┬──────┬──────┬────┬────┬─────────┐');
  console.log('   │ #  │ Nom                      │ Titu │ Min  │ B  │ PD │ Cartons │');
  console.log('   ├────┼──────────────────────────┼──────┼──────┼────┼────┼─────────┤');
  for (const p of detail.players) {
    const num = (p.number || '-').toString().padStart(2);
    const name = (p.name || '').padEnd(24).slice(0, 24);
    const titu = p.starter ? 'OUI' : 'non';
    const min = String(p.minutes).padStart(4);
    const buts = String(p.goals).padStart(2);
    const pd = String(p.assists).padStart(2);
    const cj = p.yellowCards ? `${p.yellowCards}J` : '  ';
    const cr = p.redCards ? `${p.redCards}R` : '  ';
    const cartons = `${cj} ${cr}`.trim() || '-';
    console.log(`   │ ${num} │ ${name} │ ${titu}  │ ${min} │ ${buts} │ ${pd} │ ${cartons.padEnd(7)} │`);
  }
  console.log('   └────┴──────────────────────────┴──────┴──────┴────┴────┴─────────┘');
}
