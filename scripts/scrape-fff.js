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
const TEAM_KEYWORDS = ['orléans', 'orleans', 'u-s-orleans', 'u.s. orleans'];
const BASE_URL = 'https://epreuves.fff.fr';
const TEST_MODE = process.argv.includes('--test');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normName(name) {
  return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s-]/g, '').trim();
}

function matchesTeam(text) {
  if (!text) return false;
  const lower = normName(text);
  return TEAM_KEYWORDS.some(kw => lower.includes(normName(kw)));
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
    // --- Page résultats ---
    console.log('🌐 Ouverture FFF résultats...');
    await page.goto(FFF_URL, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(3000);

    // Accept cookies
    try {
      const cookieBtn = await page.$('#didomi-notice-agree-button, [class*="cookie"] button, button[class*="accept"]');
      if (cookieBtn) { await cookieBtn.click(); await sleep(1000); console.log('🍪 Cookies acceptés'); }
    } catch (_) {}

    // Find all match links containing "orleans"
    const matchLinks = await page.evaluate((base, keywords) => {
      const links = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="/competition/match/"]').forEach(a => {
        const href = a.getAttribute('href');
        if (!href || seen.has(href)) return;
        const fullUrl = href.startsWith('http') ? href : base + href;
        const text = a.textContent.trim();
        const parentText = a.closest('[class*="match"], [class*="Match"], div, tr')?.textContent?.trim() || text;
        // Check if this match involves Orléans
        const combined = (href + ' ' + parentText).toLowerCase();
        const isOrleans = keywords.some(kw => combined.includes(kw.toLowerCase()));
        if (isOrleans) {
          seen.add(href);
          links.push({ href: fullUrl, text: parentText.slice(0, 200) });
        }
      });
      return links;
    }, BASE_URL, TEAM_KEYWORDS);

    // Also find match links near "orleans" text (scores as links)
    const scoreLinks = await page.evaluate((base, keywords) => {
      const links = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="/competition/match/"]').forEach(a => {
        const href = a.getAttribute('href');
        if (!href || seen.has(href)) return;
        // Check parent row/card for Orléans reference
        const container = a.closest('div, tr, li, [class*="match"]');
        if (!container) return;
        const containerText = container.textContent.toLowerCase();
        const isOrleans = keywords.some(kw => containerText.includes(kw.toLowerCase()));
        if (isOrleans) {
          seen.add(href);
          const fullUrl = href.startsWith('http') ? href : base + href;
          links.push({ href: fullUrl, text: container.textContent.trim().slice(0, 200) });
        }
      });
      return links;
    }, BASE_URL, TEAM_KEYWORDS);

    // Merge and deduplicate
    const allLinks = [...matchLinks];
    for (const sl of scoreLinks) {
      if (!allLinks.some(l => l.href === sl.href)) allLinks.push(sl);
    }

    console.log(`📋 ${allLinks.length} match(s) Orléans trouvés`);

    if (allLinks.length === 0) {
      console.log('⚠️ Aucun lien de match trouvé. Vérifiez la page.');
      try { await page.screenshot({ path: path.join(DEBUG_DIR, 'fff-no-matches.png') }); } catch (_) {}
      console.log('\n(Fermez Chrome pour terminer)');
      await new Promise(r => browser.on('disconnected', r));
      return;
    }

    const toProcess = TEST_MODE ? allLinks.slice(0, 1) : allLinks.slice(0, 5);
    if (TEST_MODE) console.log('\n🧪 MODE TEST — 1 seul match');
    console.log(`\n🎯 ${toProcess.length} match(s) à traiter :`);
    toProcess.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.href.split('/').pop().replace(/-/g, ' ').slice(0, 80)}`);
    });

    // Process each match
    const allResults = [];
    for (let i = 0; i < toProcess.length; i++) {
      const match = toProcess[i];
      console.log(`\n🔍 [${i + 1}/${toProcess.length}] ${match.href.split('/').pop().slice(0, 60)}...`);

      try {
        const detail = await scrapeMatchDetail(page, match.href, i === 0);
        if (detail) {
          allResults.push(detail);
          const g = detail.players.reduce((s, p) => s + p.goals, 0);
          const c = detail.players.reduce((s, p) => s + p.yellowCards + p.redCards, 0);
          const a = detail.players.reduce((s, p) => s + p.assists, 0);
          console.log(`   ✅ ${detail.players.length} joueurs | ${g} but(s), ${a} passe(s) D, ${c} carton(s)`);

          if (TEST_MODE && detail.players.length > 0) {
            console.log('\n   ┌────┬──────────────────────────┬──────┬──────┬────┬────┬─────────┐');
            console.log('   │ #  │ Nom                      │ Titu │ Min  │ B  │ PD │ Cartons │');
            console.log('   ├────┼──────────────────────────┼──────┼──────┼────┼────┼─────────┤');
            for (const p of detail.players) {
              const num = (p.number || '-').toString().padStart(2);
              const name = (p.name || '').padEnd(24).slice(0, 24);
              const titu = p.starter ? 'OUI' : 'NON';
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
      const outFile = path.join(OUTPUT_DIR, `fff-orleans-${stamp}.json`);
      fs.writeFileSync(outFile, JSON.stringify(allResults, null, 2));
      console.log(`\n✅ ${allResults.length} match(s) extraits : ${outFile}`);
      console.log('👉 Importez ce fichier dans l\'app via "⚡ Importer FlashScore".');
    } else {
      console.log('\n⚠️ Aucune donnée extraite.');
    }

  } catch (err) {
    console.log(`\n❌ Erreur générale: ${err.message}`);
    try { await page.screenshot({ path: path.join(DEBUG_DIR, 'fff-error.png') }); } catch (_) {}
  }

  console.log('\n(Fermez Chrome pour terminer)');
  await new Promise(r => browser.on('disconnected', r));
})();

async function scrapeMatchDetail(page, matchUrl, isFirst) {
  await page.goto(matchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  if (isFirst) {
    try {
      await page.screenshot({ path: path.join(DEBUG_DIR, 'match-page.png') });
      const html = await page.evaluate(() => document.body.innerHTML);
      fs.writeFileSync(path.join(DEBUG_DIR, 'match-page.html'), html);
      console.log('   📸 Debug: .cache/debug-fff/match-page.png');
    } catch (_) {}
  }

  // Extract match header info (teams, score, date, round)
  const matchInfo = await page.evaluate(() => {
    const getText = (sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) return el.textContent.trim();
      }
      return '';
    };

    const bodyText = document.body.innerText || '';
    const info = {
      homeTeam: '',
      awayTeam: '',
      scoreHome: '',
      scoreAway: '',
      date: '',
      round: '',
      pageText: bodyText.slice(0, 3000)
    };

    // Try to find team names - FFF typically has them in headers
    const teamEls = document.querySelectorAll('[class*="team"], [class*="Team"], [class*="club"], [class*="Club"], h2, h3');
    const teamNames = [];
    for (const el of teamEls) {
      const t = el.textContent.trim();
      if (t.length >= 3 && t.length <= 60 && !teamNames.includes(t)) {
        teamNames.push(t);
      }
    }
    if (teamNames.length >= 2) {
      info.homeTeam = teamNames[0];
      info.awayTeam = teamNames[1];
    }

    // Try to find score
    const scoreEls = document.querySelectorAll('[class*="score"], [class*="Score"], [class*="result"], [class*="Result"]');
    for (const el of scoreEls) {
      const m = el.textContent.trim().match(/(\d+)\s*[-–:]\s*(\d+)/);
      if (m) {
        info.scoreHome = m[1];
        info.scoreAway = m[2];
        break;
      }
    }
    if (!info.scoreHome) {
      const m = bodyText.match(/(\d+)\s*[-–:]\s*(\d+)/);
      if (m) { info.scoreHome = m[1]; info.scoreAway = m[2]; }
    }

    // Date
    const dateMatch = bodyText.match(/(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i);
    if (dateMatch) {
      const months = { janvier: '01', 'février': '02', mars: '03', avril: '04', mai: '05', juin: '06',
        juillet: '07', 'août': '08', septembre: '09', octobre: '10', novembre: '11', 'décembre': '12' };
      info.date = `${dateMatch[3]}-${months[dateMatch[2].toLowerCase()] || '01'}-${dateMatch[1].padStart(2, '0')}`;
    }

    // Round
    const roundMatch = bodyText.match(/(?:journée|j)\s*(\d+)/i);
    if (roundMatch) info.round = `Journée ${roundMatch[1]}`;

    return info;
  });

  console.log(`   📋 ${matchInfo.homeTeam || '?'} ${matchInfo.scoreHome}-${matchInfo.scoreAway} ${matchInfo.awayTeam || '?'} (${matchInfo.round || '?'})`);

  const isHome = matchesTeam(matchInfo.homeTeam);
  const isAway = matchesTeam(matchInfo.awayTeam);
  if (!isHome && !isAway) {
    console.log('   ⚠️ Orléans non identifié dans les équipes');
    if (isFirst) {
      console.log(`   Home: "${matchInfo.homeTeam}", Away: "${matchInfo.awayTeam}"`);
      console.log(`   Page (500 car.): ${matchInfo.pageText.slice(0, 500)}`);
    }
  }
  const ourSide = isHome ? 'home' : 'away';
  const opponent = isHome ? matchInfo.awayTeam : matchInfo.homeTeam;

  // Look for tabs: feuille de match, compositions, résumé
  const tabs = await page.evaluate(() => {
    const results = [];
    const candidates = document.querySelectorAll('a, button, [role="tab"], [class*="tab"], [class*="Tab"], li, nav a, [class*="nav"] a');
    for (const el of candidates) {
      const t = el.textContent.trim();
      if (t.length >= 2 && t.length <= 40) {
        results.push({ text: t, tag: el.tagName, href: el.href || '' });
      }
    }
    return results;
  });

  if (isFirst) {
    const tabNames = tabs.map(t => t.text).filter(t => /feuille|compo|resum|lineup|match|stat/i.test(t));
    console.log(`   📌 Onglets: ${tabNames.join(', ') || '(aucun pertinent)'}`);
  }

  // Try to click on "Feuille de match" tab
  await clickTab(page, ['feuille de match', 'feuille', 'compositions', 'compo']);
  await sleep(3000);

  if (isFirst) {
    try {
      await page.screenshot({ path: path.join(DEBUG_DIR, 'match-feuille.png') });
      const html = await page.evaluate(() => document.body.innerHTML);
      fs.writeFileSync(path.join(DEBUG_DIR, 'match-feuille.html'), html);
      console.log('   📸 Debug feuille: .cache/debug-fff/match-feuille.png');
    } catch (_) {}
  }

  // Extract lineup data from the page
  const lineupData = await page.evaluate((isHome) => {
    const text = document.body.innerText || '';
    const html = document.body.innerHTML || '';
    const data = { starters: [], subs: [], events: [], debug: '' };

    // Strategy 1: Look for structured player lists
    // FFF feuille de match typically has player rows with number + name
    const playerPattern = /(\d{1,2})\s+([A-ZÀ-Ý][A-ZÀ-Ý\s\-']+(?:\s+[A-Za-zà-ÿ\-']+)*)/g;
    let m;

    // Find all sections that might be team-specific
    const sections = document.querySelectorAll('[class*="team"], [class*="Team"], [class*="club"], [class*="composition"], [class*="lineup"], [class*="feuille"], [class*="Feuille"], table, [class*="section"], [class*="Section"]');

    // Also look for table rows with player data
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td, th'));
        if (cells.length >= 2) {
          const cellTexts = cells.map(c => c.textContent.trim());
          const text = cellTexts.join(' | ');
          // Look for jersey number + name pattern
          for (let ci = 0; ci < cells.length - 1; ci++) {
            const maybeNum = cellTexts[ci].replace(/[^\d]/g, '');
            const maybeName = cellTexts[ci + 1];
            if (/^\d{1,2}$/.test(maybeNum) && maybeName && maybeName.length >= 3 && maybeName.length <= 50) {
              data.starters.push({
                number: maybeNum,
                name: maybeName,
                rawRow: text.slice(0, 150)
              });
            }
          }
        }
      }
    }

    // Strategy 2: Look for divs/spans with player info
    if (data.starters.length === 0) {
      const playerEls = document.querySelectorAll('[class*="player"], [class*="Player"], [class*="joueur"], [class*="Joueur"], [class*="lf__"], [class*="lineup"]');
      for (const el of playerEls) {
        const t = el.textContent.trim();
        const m = t.match(/^(\d{1,2})\s+(.+)$/);
        if (m) {
          data.starters.push({ number: m[1], name: m[2].trim() });
        }
      }
    }

    // Strategy 3: Extract from raw text using regex
    if (data.starters.length === 0) {
      const lines = text.split('\n');
      for (const line of lines) {
        const clean = line.trim();
        const m = clean.match(/^(\d{1,2})\s+([A-ZÀ-Ý][a-zà-ÿA-ZÀ-Ý\s\-']{2,40})$/);
        if (m) {
          data.starters.push({ number: m[1], name: m[2].trim() });
        }
      }
    }

    // Extract events: goals, cards, substitutions from page text
    const goalPattern = /(\d+)[''′]\s*(?:⚽|but)?\s*([A-ZÀ-Ý][a-zà-ÿA-ZÀ-Ý\s\-']+)/gi;
    const cardPattern = /(carton\s+(?:jaune|rouge))\s*[-:]\s*(\d+)[''′]\s*([A-ZÀ-Ý][a-zà-ÿA-ZÀ-Ý\s\-']+)/gi;

    // Look for event/incident elements
    const eventEls = document.querySelectorAll('[class*="event"], [class*="Event"], [class*="incident"], [class*="goal"], [class*="card"], [class*="substitut"]');
    for (const el of eventEls) {
      const t = el.textContent.trim();
      if (t.length > 2 && t.length < 200) {
        data.events.push(t);
      }
    }

    data.debug = text.slice(0, 5000);
    return data;
  }, isHome);

  if (isFirst) {
    console.log(`   🔎 Starters trouvés: ${lineupData.starters.length}`);
    console.log(`   🔎 Events trouvés: ${lineupData.events.length}`);
    if (lineupData.starters.length === 0) {
      // Show page text to help identify the correct selectors
      const lines = lineupData.debug.split('\n').filter(l => l.trim().length > 0).slice(0, 40);
      console.log('   📄 Contenu page (40 premières lignes):');
      for (const line of lines) {
        console.log(`      ${line.slice(0, 120)}`);
      }
    } else {
      console.log('   📄 Joueurs trouvés:');
      for (const p of lineupData.starters.slice(0, 5)) {
        console.log(`      #${p.number} ${p.name}`);
      }
      if (lineupData.starters.length > 5) console.log(`      ... et ${lineupData.starters.length - 5} autres`);
    }
  }

  // Build player list
  // For now, all found players go in — we'll filter for Orléans in the import
  const players = lineupData.starters.map(p => ({
    name: p.name,
    number: p.number || '',
    team: ourSide,
    starter: true,
    minutes: 90,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0
  }));

  if (players.length === 0) return null;

  return {
    matchId: matchUrl.split('/').pop(),
    date: matchInfo.date || '',
    round: matchInfo.round || '',
    home: matchInfo.homeTeam,
    away: matchInfo.awayTeam,
    scoreHome: matchInfo.scoreHome,
    scoreAway: matchInfo.scoreAway,
    venue: isHome ? 'Domicile' : 'Extérieur',
    opponent,
    players,
    rawEvents: lineupData.events
  };
}

async function clickTab(page, keywords) {
  try {
    const clicked = await page.evaluate((kws) => {
      const candidates = document.querySelectorAll('a, button, [role="tab"], [class*="tab"], [class*="Tab"], li, nav a, [class*="nav"] a, [class*="menu"] a');
      for (const el of candidates) {
        const text = el.textContent.trim().toLowerCase();
        for (const kw of kws) {
          if (text.includes(kw.toLowerCase()) && text.length < 40) {
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
