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

    return { lines: lines.slice(0, 200), tableRows: tableRows.slice(0, 80), teamNames, title: document.title };
  });

  // ─── Parse team names from title ───
  // Title format: "Match Orléans vs Concarneau | FFF" or similar
  let homeTeam = '', awayTeam = '';
  // Try from URL: 53441338-u-s-orleans-loiret-football-u-s-concarnoise-beuzecquoise
  const urlSlug = matchUrl.split('/').pop();
  const slugParts = urlSlug.replace(/^\d+-/, '').split(/-(?=[a-z])/);

  // Find team names from the page lines
  for (const line of raw.lines) {
    if (matchesTeam(line) && line.length <= 30) {
      if (!homeTeam) homeTeam = line;
      else if (line !== homeTeam) { awayTeam = line; break; }
    }
  }

  // Try from raw.teamNames if not found
  if (!homeTeam || !awayTeam) {
    for (const tn of raw.teamNames) {
      if (!homeTeam && tn.length <= 50) homeTeam = tn;
      else if (homeTeam && tn !== homeTeam && tn.length <= 50) { awayTeam = tn; break; }
    }
  }

  // ─── Find score ───
  let scoreHome = '', scoreAway = '';
  for (const line of raw.lines) {
    // Look for standalone score like "1 - 1" or "2 - 0"
    const m = line.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
    if (m) { scoreHome = m[1]; scoreAway = m[2]; break; }
  }

  // ─── Find date ───
  let matchDate = '';
  const monthMap = { janvier: '01', 'février': '02', mars: '03', avril: '04', mai: '05', juin: '06',
    juillet: '07', 'août': '08', septembre: '09', octobre: '10', novembre: '11', 'décembre': '12' };
  for (const line of raw.lines) {
    const dm = line.match(/(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i);
    if (dm) {
      matchDate = `${dm[3]}-${monthMap[dm[2].toLowerCase()]}-${dm[1].padStart(2, '0')}`;
      break;
    }
  }

  // ─── Find round ───
  let round = '';
  for (const line of raw.lines) {
    const rm = line.match(/journée\s+(\d+)/i);
    if (rm) { round = `Journée ${rm[1]}`; break; }
  }

  // ─── Determine our side ───
  const isHome = matchesTeam(homeTeam);
  const ourSide = isHome ? 'home' : 'away';
  const opponent = isHome ? awayTeam : homeTeam;

  console.log(`   📋 ${homeTeam} ${scoreHome}-${scoreAway} ${awayTeam} (${round})`);

  // ─── Extract players from tables ───
  // FFF feuille de match: tables with rows [number, name, ...]
  // Two blocks: home team first (11 starters + ~5 subs), then away team (11 + ~5)
  const allPlayers = [];
  const KNOWN_TEAMS = ['dijon', 'sochaux', 'rouen', 'fleury', 'puy', 'versailles', 'valenciennes',
    'caen', 'villefranche', 'aubagne', 'concarneau', 'paris 13', 'quevilly', 'bourg', 'chateauroux',
    'briochin', 'fcvb', 'fbbp', 'qrm', 'berri', 'nimes'];

  for (const row of raw.tableRows) {
    // Check for number + name pattern
    for (let ci = 0; ci < row.length - 1; ci++) {
      const num = row[ci].replace(/[^\d]/g, '');
      const name = row[ci + 1];
      if (!/^\d{1,2}$/.test(num)) continue;
      if (!name || name.length < 3 || name.length > 50) continue;

      // Skip if this looks like a standings row (team name)
      const lower = name.toLowerCase();
      if (KNOWN_TEAMS.some(t => lower.includes(t))) continue;
      if (/^[A-Z\s.]+$/.test(name) && (name.includes(' FC') || name.includes(' US') || name.includes(' SC'))) continue;

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

  // ─── Extract events from page text ───
  // Look for the "Le match" tab content — events like goals, cards
  await clickTab(page, ['le match']);
  await sleep(2000);

  // Click "Voir plus" to expand all events
  try {
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button, a, [class*="more"], [class*="More"], [class*="voir"], [class*="Voir"]');
      for (const btn of btns) {
        const t = btn.textContent.trim().toLowerCase();
        if (t.includes('voir plus') || t.includes('voir tout') || t.includes('afficher')) {
          btn.click();
        }
      }
    });
    await sleep(2000);
  } catch (_) {}

  if (isFirst) {
    try {
      await page.screenshot({ path: path.join(DEBUG_DIR, 'match-events.png') });
      fs.writeFileSync(path.join(DEBUG_DIR, 'match-events.html'),
        await page.evaluate(() => document.body.innerHTML));
      console.log('   📸 Debug events: .cache/debug-fff/match-events.png');
    } catch (_) {}
  }

  // Extract ALL text events from the page
  const events = await page.evaluate(() => {
    const evts = [];
    const seen = new Set();
    const text = document.body.innerText || '';
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);

    // FFF concatenates without spaces: "Avertissement pour CONCARNEAU USFLAVIO DA SILVA est averti"
    // Parse by keying on ACTION words: "est averti", "inscrit par", "remplace"
    for (const line of lines) {
      if (seen.has(line)) continue;
      const minMatch = line.match(/(\d+)[''′e]\s*/);
      const minute = minMatch ? parseInt(minMatch[1]) : 0;

      // "...inscrit par PLAYER_NAME" → goal
      if (/inscrit\s+par/i.test(line)) {
        seen.add(line);
        const m = line.match(/inscrit\s+par\s+(.+)/i);
        const tm = line.match(/but\s+pour\s+(.+?)(?:inscrit|marqu)/i);
        evts.push({ type: 'goal', player: m ? m[1].trim() : '', team: tm ? tm[1].trim() : '', minute, text: line });
      }
      // "...PLAYER_NAME est averti" → yellow card
      else if (/est averti/i.test(line)) {
        seen.add(line);
        const m = line.match(/([A-ZÀ-Ý][A-ZÀ-Ý\s\-']{2,40}?)\s*est averti/i);
        const tm = line.match(/avertissement\s+pour\s+(.+?)(?=[A-Z]{2,}[a-z]|[A-Z]{2,}\s+est)/i);
        evts.push({ type: 'yellowCard', player: m ? m[1].trim() : '', team: tm ? tm[1].trim() : '', minute, text: line });
      }
      // "...est exclu" or "carton rouge" → red card
      else if (/est exclu|carton\s+rouge/i.test(line)) {
        seen.add(line);
        const m = line.match(/([A-ZÀ-Ý][A-ZÀ-Ý\s\-']{2,40}?)\s*est exclu/i);
        evts.push({ type: 'redCard', player: m ? m[1].trim() : '', team: '', minute, text: line });
      }
      // "...PLAYER_IN remplace PLAYER_OUT" → substitution
      else if (/remplace/i.test(line)) {
        seen.add(line);
        const m = line.match(/([A-ZÀ-Ý][A-ZÀ-Ý\s\-']{2,40}?)\s*remplace\s+(.+)/i);
        evts.push({ type: 'substitution', playerIn: m ? m[1].trim() : '', playerOut: m ? m[2].trim() : '', minute, text: line });
      }
    }

    return evts;
  });

  if (isFirst) {
    console.log(`   📊 ${events.length} événements trouvés:`);
    for (const e of events) {
      const icon = e.type === 'goal' ? '⚽' : e.type === 'yellowCard' ? '🟡' : e.type === 'redCard' ? '🔴' : e.type === 'substitution' ? '🔄' : '❓';
      console.log(`      ${icon} ${e.player || e.playerIn || ''} ${e.text.slice(0, 70)}`);
    }
  }

  // Build surname lookup for our players
  const playersByName = {};
  for (const p of players) {
    const parts = normName(p.name).split(/\s+/);
    for (const part of parts) {
      if (part.length >= 3) {
        if (!playersByName[part]) playersByName[part] = p;
      }
    }
  }

  function findPlayerByText(text) {
    if (!text) return null;
    const n = normName(text);
    for (const [surname, player] of Object.entries(playersByName)) {
      if (n.includes(surname)) return player;
    }
    return null;
  }

  // Apply events to players
  for (const evt of events) {
    if (evt.type === 'goal') {
      const p = findPlayerByText(evt.player);
      if (p) p.goals++;
    } else if (evt.type === 'yellowCard') {
      const p = findPlayerByText(evt.player);
      if (p) p.yellowCards++;
    } else if (evt.type === 'redCard') {
      const p = findPlayerByText(evt.player);
      if (p) p.redCards++;
    } else if (evt.type === 'substitution') {
      const pOut = findPlayerByText(evt.playerOut);
      const pIn = findPlayerByText(evt.playerIn);
      const min = evt.minute || 0;
      if (pOut && pOut.starter && min > 0) {
        pOut.minutes = min;
      }
      if (pIn) {
        pIn.starter = false;
        pIn.minutes = min > 0 ? (90 - min) : 0;
      }
    } else if (evt.type === 'raw') {
      const p = findPlayerByText(evt.text);
      if (p) {
        if (/but/i.test(evt.text)) p.goals++;
        else if (/jaune|avertiss/i.test(evt.text)) p.yellowCards++;
        else if (/rouge/i.test(evt.text)) p.redCards++;
      }
    }
  }

  if (players.length === 0) return null;

  return {
    matchId: urlSlug,
    date: matchDate,
    round,
    home: homeTeam,
    away: awayTeam,
    scoreHome,
    scoreAway,
    venue: isHome ? 'Domicile' : 'Extérieur',
    opponent,
    players,
    rawEvents: events
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
