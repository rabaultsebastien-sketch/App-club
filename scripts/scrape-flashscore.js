#!/usr/bin/env node
/* =============================================================
   Scraper FlashScore — US Orléans (National)

   Filtre : matchs de championnat National, journée 30+

   Usage :
     npm install
     npm run scrape-flashscore
   ============================================================= */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'imports');
const DEBUG_DIR = path.join(ROOT, '.cache', 'debug');
[OUTPUT_DIR, DEBUG_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const RESULTS_URL = 'https://www.flashscore.fr/equipe/orleans/AqswAEFD/resultats/';
const TEAM_KEYWORDS = ['orléans', 'orleans'];
const MIN_MATCHDAY = 30;
const TEST_MODE = process.argv.includes('--test');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function matchesTeam(text) {
  if (!text) return false;
  const low = text.toLowerCase();
  return TEAM_KEYWORDS.some(k => low.includes(k));
}

async function main() {
  console.log('\n🚀 Lancement de Chrome (stealth)...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox']
  });
  const page = (await browser.pages())[0];
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Accept cookies
  console.log('🌐 Ouverture FlashScore...');
  await page.goto('https://www.flashscore.fr/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);
  for (const sel of ['#onetrust-accept-btn-handler', '[id*="accept"]', 'button[class*="accept"]']) {
    try {
      const btn = await page.$(sel);
      if (btn) { await btn.click(); console.log('🍪 Cookies acceptés'); await sleep(1500); break; }
    } catch (_) {}
  }

  // Navigate to results
  console.log('🌐 Résultats US Orléans...');
  await page.goto(RESULTS_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(5000);

  // Click "Show more" to load earlier matches
  for (let i = 0; i < 10; i++) {
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('a[class*="event__more"], [class*="showMore"], [class*="more"]');
      for (const b of btns) {
        const t = b.textContent.toLowerCase();
        if (t.includes('plus') || t.includes('more') || t.includes('afficher')) {
          b.click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) break;
    await sleep(2000);
  }

  try { await page.screenshot({ path: path.join(DEBUG_DIR, 'results-page.png') }); } catch (_) {}

  // Extract matches with competition headers
  const matches = await page.evaluate(() => {
    const results = [];
    const rows = document.querySelectorAll('[id^="g_"]');

    rows.forEach(row => {
      const id = row.id || '';
      const matchId = id.replace(/^g_\d+_/, '');
      if (!matchId) return;

      const homeEl = row.querySelector('[class*="participant--home"], [class*="homeParticipant"], [class*="participant__home"]');
      const awayEl = row.querySelector('[class*="participant--away"], [class*="awayParticipant"], [class*="participant__away"]');
      const home = homeEl ? homeEl.textContent.trim() : '';
      const away = awayEl ? awayEl.textContent.trim() : '';

      const scoreEls = row.querySelectorAll('[class*="score"], [class*="Score"]');
      const scores = Array.from(scoreEls).map(e => e.textContent.trim()).filter(s => /^\d+$/.test(s));

      const timeEl = row.querySelector('[class*="time"], [class*="Time"], [class*="date"]');
      const linkEl = row.querySelector('a[href*="/match/"]');
      const href = linkEl ? linkEl.getAttribute('href') : '';

      // Find competition header above this match
      let competition = '';
      let el = row.previousElementSibling;
      while (el) {
        const cls = el.className || '';
        const txt = el.textContent || '';
        if (/header/i.test(cls)) {
          competition = txt.trim();
          break;
        }
        if (el.id && el.id.startsWith('g_')) break;
        el = el.previousElementSibling;
      }

      results.push({
        matchId, home, away, href,
        scoreHome: scores[0] || '', scoreAway: scores[1] || '',
        time: timeEl ? timeEl.textContent.trim() : '',
        competition
      });
    });

    return results;
  });

  console.log(`📋 ${matches.length} match(s) trouvés au total.`);

  // Filter: only National championship (exclude Coupe, amicaux, etc.)
  let pool = matches.filter(m => {
    const comp = m.competition.toLowerCase();
    return comp.includes('national') && !comp.includes('coupe');
  });

  if (pool.length === 0) {
    console.log('⚠️  Pas de filtre compétition trouvé (headers vides), utilisation de tous les matchs.');
    pool = matches;
  } else {
    console.log(`🏟️  ${pool.length} match(s) de National (hors coupes).`);
  }

  // National season has 34 matchdays. We want matchday 30+, so the 5 most recent.
  // Results page is ordered most-recent-first.
  // Take matchdays 30-34 = last 5 of the season.
  // We take a reasonable slice from the most recent matches.
  const totalMatchdays = 34;
  const wantedCount = TEST_MODE ? 1 : totalMatchdays - MIN_MATCHDAY + 1;
  const toProcess = pool.slice(0, wantedCount);

  if (TEST_MODE) console.log('\n🧪 MODE TEST — 1 seul match');
  console.log(`\n🎯 ${toProcess.length} match(s) à traiter :`);
  toProcess.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.time} ${m.home} ${m.scoreHome}-${m.scoreAway} ${m.away}`);
  });

  // Process each match
  const allResults = [];
  for (let i = 0; i < toProcess.length; i++) {
    const m = toProcess[i];
    const label = `${m.home || '?'} vs ${m.away || '?'}`;
    console.log(`\n🔍 [${i + 1}/${toProcess.length}] ${label}...`);

    try {
      const detail = await scrapeMatchDetail(page, m, i === 0);
      if (detail) {
        detail.home = m.home;
        detail.away = m.away;
        detail.scoreHome = m.scoreHome;
        detail.scoreAway = m.scoreAway;
        allResults.push(detail);
        const g = detail.players.reduce((s, p) => s + p.goals, 0);
        const c = detail.players.reduce((s, p) => s + p.yellowCards + p.redCards, 0);
        const a = detail.players.reduce((s, p) => s + p.assists, 0);
        console.log(`   ✅ ${detail.players.length} joueurs | ${g} but(s), ${a} passe(s) D, ${c} carton(s)`);
        if (TEST_MODE) {
          console.log('\n   ┌─────────────────────────────────────────────────────────────┐');
          console.log('   │  DÉTAIL JOUEURS ORLÉANS                                    │');
          console.log('   ├────┬──────────────────────┬──────┬──────┬────┬────┬─────────┤');
          console.log('   │ #  │ Nom                  │ Titu │ Min  │ B  │ PD │ Cartons │');
          console.log('   ├────┼──────────────────────┼──────┼──────┼────┼────┼─────────┤');
          for (const p of detail.players) {
            const num = (p.number || '-').toString().padStart(2);
            const name = (p.name || '').padEnd(20).slice(0, 20);
            const titu = p.starter ? 'OUI' : 'NON';
            const min = String(p.minutes).padStart(4);
            const buts = String(p.goals).padStart(2);
            const pd = String(p.assists).padStart(2);
            const cj = p.yellowCards ? `${p.yellowCards}J` : '  ';
            const cr = p.redCards ? `${p.redCards}R` : '  ';
            const cartons = `${cj} ${cr}`.trim() || '-';
            console.log(`   │ ${num} │ ${name} │ ${titu}  │ ${min} │ ${buts} │ ${pd} │ ${cartons.padEnd(7)} │`);
          }
          console.log('   └────┴──────────────────────┴──────┴──────┴────┴────┴─────────┘');
          if (detail.rawEvents && detail.rawEvents.length > 0) {
            console.log('\n   ÉVÉNEMENTS DU MATCH :');
            for (const e of detail.rawEvents) {
              const icon = e.type === 'goal' ? '⚽' : e.type === 'yellowCard' ? '🟡' : e.type === 'redCard' ? '🔴' : e.type === 'substitution' ? '🔄' : '❓';
              console.log(`   ${icon} ${e.minute}' ${e.name} ${e.assistName ? `(${e.assistName})` : ''} [${e.team}]`);
            }
          }
        }
      } else {
        console.log('   ⚠️ Pas de données trouvées');
      }
    } catch (err) {
      console.log(`   ❌ Erreur: ${err.message}`);
    }
  }

  // Save results
  if (allResults.length > 0) {
    const stamp = new Date().toISOString().slice(0, 10);
    const outFile = path.join(OUTPUT_DIR, `flashscore-orleans-${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify(allResults, null, 2));
    console.log(`\n✅ ${allResults.length} match(s) extraits : ${outFile}`);
    console.log('👉 Importez ce fichier dans l\'app via "⚡ Importer FlashScore".');
  } else {
    console.log('\n⚠️ Aucune donnée extraite.');
  }

  console.log('\n(Fermez Chrome pour terminer)');
  await new Promise(r => browser.on('disconnected', r));
}

async function scrapeMatchDetail(page, match, isFirst) {
  let url = match.href;
  if (!url) url = `/match/${match.matchId}/`;
  if (url.startsWith('/')) url = 'https://www.flashscore.fr' + url;

  const isHome = matchesTeam(match.home);
  const ourSide = isHome ? 'home' : 'away';

  // Capture API/XHR responses for this match detail
  const captured = [];
  const responseHandler = async (response) => {
    try {
      const resUrl = response.url();
      // Capture anything that looks like match data
      if (resUrl.includes(match.matchId) || /lineup|summary|incident|statistic|match/i.test(resUrl)) {
        const text = await response.text();
        if (text && text.length > 10) {
          captured.push({ url: resUrl, body: text.slice(0, 50000) });
        }
      }
    } catch (_) {}
  };
  page.on('response', responseHandler);

  // --- Compositions tab ---
  await page.goto(url + '#/compositions', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(4000);
  await clickTab(page, ['compo', 'lineup', 'compositions']);
  await sleep(2000);

  if (isFirst) {
    try {
      await page.screenshot({ path: path.join(DEBUG_DIR, 'match-compo.png') });
      const html = await page.evaluate(() => document.body.innerHTML);
      fs.writeFileSync(path.join(DEBUG_DIR, 'match-compo.html'), html);
      console.log('   📸 Debug compo: .cache/debug/match-compo.png');
    } catch (e) { console.log(`   ⚠️ Debug screenshot compo: ${e.message.slice(0, 80)}`); }
  }

  // Extract lineup from DOM (both teams)
  const domLineups = await extractLineup(page);

  // --- Résumé tab ---
  await page.goto(url + '#/resume-du-match/resume-du-match', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);
  await clickTab(page, ['résum', 'summary', 'résumé']);
  await sleep(2000);

  if (isFirst) {
    try {
      await page.screenshot({ path: path.join(DEBUG_DIR, 'match-resume.png') });
      const html = await page.evaluate(() => document.body.innerHTML);
      fs.writeFileSync(path.join(DEBUG_DIR, 'match-resume.html'), html);
    } catch (e) {}
  }

  const domEvents = await extractEvents(page);

  // Stop capturing
  page.off('response', responseHandler);

  // Always parse API responses (primary data source — has explicit team IDs)
  const apiParsed = parseApiResponses(captured, match.matchId);

  // Save debug data
  if (isFirst && captured.length > 0) {
    try {
      fs.writeFileSync(path.join(DEBUG_DIR, 'api-captured.json'), JSON.stringify(captured, null, 2));
    } catch (_) {}
  }

  // Prefer API data (has reliable team IDs via IH field)
  const apiHasTeams = apiParsed.lineups.some(p => p.team === 'home' || p.team === 'away');
  const finalLineups = apiHasTeams && apiParsed.lineups.length >= 10 ? apiParsed.lineups : domLineups;
  const finalEvents = apiParsed.events.length > 0 ? apiParsed.events : domEvents;
  const source = finalLineups === apiParsed.lineups ? 'API' : 'DOM';

  // Filter: only our team's players
  const ourLineup = finalLineups.filter(p => p.team === ourSide);
  // If team detection failed (all unknown), use all but log warning
  const fallbackLineup = ourLineup.length >= 8 ? ourLineup : finalLineups.filter(p => p.team === ourSide || p.team === 'unknown');

  const ourEvents = finalEvents.filter(e => e.team === ourSide || e.team === 'unknown');

  const goals = ourEvents.filter(e => e.type === 'goal').length;
  const cards = ourEvents.filter(e => e.type === 'yellowCard' || e.type === 'redCard').length;
  const subs = ourEvents.filter(e => e.type === 'substitution').length;
  console.log(`   📊 ${source}: ${fallbackLineup.length} joueurs Orléans, ${ourEvents.length} événements (${goals} buts, ${cards} cartons, ${subs} rempl.)`);

  if (TEST_MODE) {
    const allHome = finalLineups.filter(p => p.team === 'home');
    const allAway = finalLineups.filter(p => p.team === 'away');
    const allUnknown = finalLineups.filter(p => p.team === 'unknown');
    console.log(`   🔎 Total: ${finalLineups.length} joueurs (${allHome.length} home, ${allAway.length} away, ${allUnknown.length} unknown) — source: ${source}`);
  }

  // Extract match date
  const matchDate = await page.evaluate(() => {
    const el = document.querySelector('[class*="startTime"], [class*="duelParticipant__startTime"]');
    if (el) return el.textContent.trim();
    const header = document.querySelector('[class*="duelParticipant"], [class*="tournamentHeader"]');
    return header ? header.textContent.trim().slice(0, 50) : '';
  });

  // Extract round info
  const roundInfo = await page.evaluate(() => {
    const el = document.querySelector('[class*="tournamentHeader__country"], [class*="tournamentHeader"]');
    return el ? el.textContent.trim() : '';
  });

  if (fallbackLineup.length === 0 && ourEvents.length === 0) return null;

  const players = buildPlayerList(fallbackLineup, ourEvents, ourSide);

  return {
    matchId: match.matchId,
    date: parseFlashscoreDate(matchDate),
    round: roundInfo,
    players,
    rawEvents: finalEvents
  };
}

async function clickTab(page, keywords) {
  try {
    const clicked = await page.evaluate((kws) => {
      const candidates = document.querySelectorAll('a, button, [role="tab"], [class*="tab"], [class*="Tab"], li');
      for (const el of candidates) {
        const text = el.textContent.trim().toLowerCase();
        for (const kw of kws) {
          if (text.includes(kw) && text.length < 30) {
            el.click();
            return text;
          }
        }
      }
      return null;
    }, keywords);
    if (clicked) console.log(`   📌 Onglet: "${clicked}"`);
  } catch (_) {}
}

async function extractLineup(page) {
  return await page.evaluate(() => {
    const players = [];
    const seen = new Set();

    // Strategy 1: FlashScore lineup elements (many possible class name patterns)
    const selectors = [
      '[class*="lf__cell"]', '[class*="lineup__player"]', '[class*="lineupTable"]',
      '[class*="formation__player"]', '[class*="smv__participantRow"]',
      '[class*="participant__row"]', '[class*="Player"]',
      '[class*="jersey"]', '[class*="shirt"]'
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const nameEl = el.querySelector('a, [class*="name"], [class*="Name"], [class*="participant"]');
        const numberEl = el.querySelector('[class*="jersey"], [class*="number"], [class*="Number"], [class*="shirt"]');
        const name = nameEl ? nameEl.textContent.trim() : '';
        const number = numberEl ? numberEl.textContent.trim().replace(/[^\d]/g, '') : '';

        if (!name || name.length > 40 || name.length < 2 || seen.has(name)) continue;
        seen.add(name);

        let team = detectSide(el);
        players.push({ name, number, team, starter: true });
      }
    }

    // Strategy 2: Look for table rows with player data
    if (players.length === 0) {
      const trs = document.querySelectorAll('table tr, [class*="table"] [class*="row"]');
      for (const tr of trs) {
        const cells = tr.querySelectorAll('td, [class*="cell"]');
        if (cells.length < 2) continue;
        const text0 = cells[0]?.textContent.trim() || '';
        const text1 = cells[1]?.textContent.trim() || '';
        const maybeNumber = /^\d{1,2}$/.test(text0);
        const maybeName = text1.length >= 2 && text1.length <= 40 && !/^\d+$/.test(text1);
        if (maybeNumber && maybeName && !seen.has(text1)) {
          seen.add(text1);
          players.push({ name: text1, number: text0, team: detectSide(tr), starter: true });
        }
      }
    }

    // Strategy 3: Look for any list-like structures with numbered items (shirt numbers)
    if (players.length === 0) {
      const allElements = document.querySelectorAll('div, span, li');
      const numberPattern = /^(\d{1,2})$/;
      for (const el of allElements) {
        const text = el.textContent.trim();
        if (text.length < 2 || text.length > 50) continue;
        // Match "Number Name" pattern like "7 Sylla"
        const m = text.match(/^(\d{1,2})\s+([A-ZÀ-Ý][a-zà-ÿ\-']+(?:\s+[A-ZÀ-Ý][a-zà-ÿ\-']+)*)$/);
        if (m && !seen.has(m[2])) {
          seen.add(m[2]);
          players.push({ name: m[2], number: m[1], team: detectSide(el), starter: true });
        }
      }
    }

    function detectSide(el) {
      let parent = el;
      for (let d = 0; d < 20; d++) {
        parent = parent.parentElement;
        if (!parent) break;
        const cls = (parent.className || '').toString() + ' ' + (parent.id || '');
        if (/home|--1|left|__1/i.test(cls)) return 'home';
        if (/away|--2|right|__2/i.test(cls)) return 'away';
      }
      return 'unknown';
    }

    return players;
  });
}

async function extractEvents(page) {
  return await page.evaluate(() => {
    const evts = [];
    const processed = new Set();

    const selectors = [
      '[class*="smv__incident"]', '[class*="incident"]',
      '[class*="event__incident"]', '[class*="verticalSections"]'
    ];

    for (const sel of selectors) {
      const rows = document.querySelectorAll(sel);
      for (const row of rows) {
        const text = row.textContent.trim();
        if (!text || text.length > 300 || processed.has(text)) continue;
        processed.add(text);

        const innerHTML = (row.innerHTML || '').toLowerCase();
        let type = 'unknown';

        if (/goal|soccer-ball|footballGoal|iconGoal|icon-goal/i.test(innerHTML)) type = 'goal';
        else if (/yellowCard|yellow-card|y-card|iconYellowCard/i.test(innerHTML)) type = 'yellowCard';
        else if (/redCard|red-card|r-card|iconRedCard/i.test(innerHTML)) type = 'redCard';
        else if (/substitut|iconSubstitution|sub-in|sub-out/i.test(innerHTML)) type = 'substitution';
        else if (/assist|iconAssist/i.test(innerHTML)) type = 'assist';

        // Also detect by looking at SVG/img src or class
        if (type === 'unknown') {
          const icons = row.querySelectorAll('svg, img, [class*="icon"], [class*="Icon"]');
          for (const icon of icons) {
            const src = (icon.getAttribute('src') || '') + ' ' + (icon.getAttribute('xlink:href') || '') + ' ' + (icon.className || '');
            if (/goal|soccer|football/i.test(src)) type = 'goal';
            else if (/yellow/i.test(src)) type = 'yellowCard';
            else if (/red/i.test(src)) type = 'redCard';
            else if (/subst|change/i.test(src)) type = 'substitution';
          }
        }

        if (type === 'unknown') continue;

        const timeMatch = text.match(/(\d+)['′+]/);
        const minute = timeMatch ? parseInt(timeMatch[1]) : 0;

        const nameEl = row.querySelector('[class*="name"], [class*="Name"], a');
        const name = nameEl ? nameEl.textContent.trim() : '';

        // For assists, look for secondary name
        let assistName = '';
        if (type === 'goal') {
          const assistEl = row.querySelector('[class*="assist"], [class*="subIncident"]');
          if (assistEl) assistName = assistEl.textContent.trim().replace(/^\(|\)$/g, '');
        }

        let team = 'unknown';
        let parent = row;
        for (let d = 0; d < 10; d++) {
          parent = parent.parentElement;
          if (!parent) break;
          const cls = (parent.className || '').toString();
          if (/home|--1|left/i.test(cls)) { team = 'home'; break; }
          if (/away|--2|right/i.test(cls)) { team = 'away'; break; }
        }

        evts.push({ type, name, assistName, minute, team, text: text.slice(0, 120) });
      }
    }

    return evts;
  });
}

function parseApiResponses(captured, matchId) {
  const lineups = [];
  const events = [];

  for (const resp of captured) {
    const body = resp.body;

    // Try to parse as JSON
    try {
      const data = JSON.parse(body);
      // Look for lineup data
      if (data.lineups || data.lineup || data.formations) {
        const raw = data.lineups || data.lineup || data.formations;
        if (Array.isArray(raw)) {
          for (const p of raw) {
            const name = p.name || p.playerName || p.shortName || '';
            if (name) {
              lineups.push({
                name, number: String(p.jerseyNumber || p.number || ''),
                team: p.side || p.team || 'unknown', starter: p.substitute !== true
              });
            }
          }
        }
      }

      // Look for incident/event data
      if (data.incidents || data.events || data.summary) {
        const raw = data.incidents || data.events || data.summary;
        if (Array.isArray(raw)) {
          for (const e of raw) {
            const name = e.playerName || e.player?.name || e.name || '';
            let type = 'unknown';
            const t = (e.type || e.incidentType || '').toLowerCase();
            if (t.includes('goal')) type = 'goal';
            else if (t.includes('yellow')) type = 'yellowCard';
            else if (t.includes('red')) type = 'redCard';
            else if (t.includes('subst')) type = 'substitution';
            if (type !== 'unknown') {
              events.push({
                type, name, minute: e.time || e.minute || 0,
                team: e.side || e.team || 'unknown',
                assistName: e.assist?.name || ''
              });
            }
          }
        }
      }
    } catch (_) {}

    // Try FlashScore custom text format (pipe-delimited)
    // FlashScore uses formats like: SA÷1¬~ZA÷EUROPE: ...
    if (body.includes('÷') || body.includes('¬')) {
      const parsed = parseFlashscoreTextFormat(body);
      if (parsed.lineups.length > 0) lineups.push(...parsed.lineups);
      if (parsed.events.length > 0) events.push(...parsed.events);
    }
  }

  return { lineups, events };
}

function parseFlashscoreTextFormat(text) {
  const lineups = [];
  const events = [];

  // FlashScore uses a custom delimiter format:
  // Fields separated by ¬ (not-sign), key÷value pairs
  // Player entries often have: ~IA÷matchId¬~IB÷playerName¬~IC÷jerseyNumber...
  const entries = text.split('~');
  let current = {};

  for (const entry of entries) {
    const parts = entry.split('¬');
    for (const part of parts) {
      const [key, val] = part.split('÷');
      if (key && val) current[key] = val;
    }

    // When we have enough data for a player
    if (current.IB || current.IN) {
      const name = current.IB || current.IN || '';
      if (name && name.length > 1) {
        lineups.push({
          name,
          number: current.IC || current.IJ || '',
          team: current.IH === '1' ? 'home' : current.IH === '2' ? 'away' : 'unknown',
          starter: current.IL !== '1'
        });
      }
      current = {};
    }

    // Incident entries
    if (current.IA && current.IT) {
      let type = 'unknown';
      const t = current.IT;
      if (t === '1' || t === '7' || t === '9') type = 'goal';
      else if (t === '3') type = 'yellowCard';
      else if (t === '4' || t === '5') type = 'redCard';
      else if (t === '6') type = 'substitution';
      if (type !== 'unknown') {
        events.push({
          type, name: current.IN || current.IB || '',
          minute: parseInt(current.IM || '0') || 0,
          team: current.IH === '1' ? 'home' : current.IH === '2' ? 'away' : 'unknown',
          assistName: current.IA2 || ''
        });
      }
      current = {};
    }
  }

  return { lineups, events };
}

function buildPlayerList(lineups, events, ourSide) {
  const players = lineups.map(p => ({
    name: p.name,
    number: p.number,
    team: ourSide,
    starter: p.starter !== false,
    minutes: p.starter !== false ? 90 : 0,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0
  }));

  const byName = {};
  players.forEach(p => { byName[normName(p.name)] = p; });

  for (const evt of events) {
    const key = normName(evt.name);
    const p = byName[key];

    if (evt.type === 'goal') {
      if (p) p.goals++;
      // Handle assist
      if (evt.assistName) {
        const aKey = normName(evt.assistName);
        if (byName[aKey]) byName[aKey].assists++;
      }
    } else if (evt.type === 'yellowCard') {
      if (p) p.yellowCards++;
    } else if (evt.type === 'redCard') {
      if (p) p.redCards++;
    } else if (evt.type === 'substitution' && evt.minute > 0) {
      if (p) {
        if (p.starter) {
          p.minutes = evt.minute;
        } else {
          p.minutes = 90 - evt.minute;
        }
      }
    }
  }

  return players;
}

function normName(name) {
  return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function parseFlashscoreDate(raw) {
  if (!raw) return '';
  const m = raw.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (!m) return raw;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

main().catch(err => {
  console.error('❌ Erreur:', err.message);
  process.exit(1);
});
