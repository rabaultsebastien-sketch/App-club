#!/usr/bin/env node
/* =============================================================
   Scraper FFF — US Orléans (National)

   Source : epreuves.fff.fr (site officiel de la FFF)

   Usage :
     node scripts/scrape-fff.js          # tous les matchs récents
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
const TEAM_KEYWORDS = ['orléans', 'orleans', 'us orleans'];
const TEST_MODE = process.argv.includes('--test');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normName(name) {
  return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
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

  // Capture API/XHR responses
  const captured = [];
  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (/api|json|match|calendrier|resultat|feuille|composition/i.test(url)) {
        const ct = response.headers()['content-type'] || '';
        if (ct.includes('json') || ct.includes('text')) {
          const text = await response.text();
          if (text && text.length > 50) {
            captured.push({ url, body: text.slice(0, 100000) });
          }
        }
      }
    } catch (_) {}
  });

  try {
    // --- Page résultats ---
    console.log('🌐 Ouverture FFF résultats...');
    await page.goto(FFF_URL, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(3000);

    // Accept cookies if present
    try {
      const cookieBtn = await page.$('[class*="cookie"] button, [id*="cookie"] button, button[class*="accept"], .didomi-continue-without-agreeing, #didomi-notice-agree-button');
      if (cookieBtn) {
        await cookieBtn.click();
        await sleep(1000);
        console.log('🍪 Cookies acceptés');
      }
    } catch (_) {}

    // Take debug screenshot
    try {
      await page.screenshot({ path: path.join(DEBUG_DIR, 'fff-results.png') });
      console.log('📸 Screenshot: .cache/debug-fff/fff-results.png');
    } catch (_) {}

    // Dump page structure
    const pageInfo = await page.evaluate(() => {
      const info = {
        title: document.title,
        url: location.href,
        bodyText: document.body?.innerText?.slice(0, 2000) || '',
        links: [],
        tables: [],
        matchCards: []
      };

      // Find all links
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href');
        const text = a.textContent.trim().slice(0, 100);
        if (href && text && (
          /match|feuille|resultat|orleans|journee/i.test(href + text)
        )) {
          info.links.push({ href, text });
        }
      });

      // Find tables
      document.querySelectorAll('table').forEach((t, i) => {
        const rows = Array.from(t.querySelectorAll('tr')).slice(0, 5);
        info.tables.push({
          index: i,
          rowCount: t.querySelectorAll('tr').length,
          sample: rows.map(r => r.textContent.trim().slice(0, 150))
        });
      });

      // Find match-like cards/rows
      const matchSelectors = [
        '[class*="match"]', '[class*="Match"]', '[class*="result"]',
        '[class*="rencontre"]', '[class*="Rencontre"]',
        '[class*="game"]', '[class*="fixture"]',
        '[class*="calendrier"] > *', '[class*="Calendrier"] > *'
      ];
      for (const sel of matchSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          info.matchCards.push({
            selector: sel,
            count: els.length,
            samples: Array.from(els).slice(0, 3).map(el => ({
              tag: el.tagName,
              cls: (el.className || '').toString().slice(0, 100),
              text: el.textContent.trim().slice(0, 200),
              href: el.querySelector('a')?.href || ''
            }))
          });
        }
      }

      return info;
    });

    console.log('\n📋 PAGE INFO:');
    console.log(`   Titre: ${pageInfo.title}`);
    console.log(`   URL: ${pageInfo.url}`);
    console.log(`   Liens pertinents: ${pageInfo.links.length}`);

    if (pageInfo.links.length > 0) {
      console.log('\n🔗 LIENS TROUVÉS:');
      for (const link of pageInfo.links.slice(0, 20)) {
        console.log(`   ${link.text.slice(0, 60).padEnd(60)} → ${link.href}`);
      }
    }

    if (pageInfo.matchCards.length > 0) {
      console.log('\n🏟️ ÉLÉMENTS MATCH:');
      for (const mc of pageInfo.matchCards) {
        console.log(`   ${mc.selector}: ${mc.count} éléments`);
        for (const s of mc.samples) {
          console.log(`     [${s.tag}] ${s.text.slice(0, 100)}`);
          if (s.href) console.log(`       → ${s.href}`);
        }
      }
    }

    if (pageInfo.tables.length > 0) {
      console.log('\n📊 TABLES:');
      for (const t of pageInfo.tables) {
        console.log(`   Table ${t.index}: ${t.rowCount} lignes`);
        for (const row of t.sample) {
          console.log(`     ${row.slice(0, 120)}`);
        }
      }
    }

    // Look for Orléans matches specifically
    const orleansMatches = await page.evaluate((keywords) => {
      const results = [];
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        const text = el.textContent.trim().toLowerCase();
        const directText = el.childNodes.length <= 3 ? text : '';
        if (!directText) continue;
        for (const kw of keywords) {
          if (directText.includes(kw.toLowerCase()) && directText.length < 300) {
            const parent = el.closest('a, tr, [class*="match"], [class*="rencontre"], [class*="result"]');
            results.push({
              text: directText.slice(0, 200),
              tag: el.tagName,
              cls: (el.className || '').toString().slice(0, 80),
              parentHref: parent?.href || parent?.querySelector('a')?.href || '',
              parentText: parent?.textContent?.trim().slice(0, 200) || ''
            });
            break;
          }
        }
      }
      return results.slice(0, 15);
    }, TEAM_KEYWORDS);

    if (orleansMatches.length > 0) {
      console.log(`\n⚜️ MATCHS ORLÉANS TROUVÉS: ${orleansMatches.length}`);
      for (const m of orleansMatches) {
        console.log(`   [${m.tag}] ${m.text.slice(0, 100)}`);
        if (m.parentHref) console.log(`     → ${m.parentHref}`);
      }
    } else {
      console.log('\n⚠️ Aucun match Orléans trouvé sur la page');
      console.log('   Contenu page (500 premiers caractères):');
      console.log(`   ${pageInfo.bodyText.slice(0, 500)}`);
    }

    // Save captured API responses
    if (captured.length > 0) {
      fs.writeFileSync(path.join(DEBUG_DIR, 'fff-api.json'), JSON.stringify(captured, null, 2));
      console.log(`\n📡 ${captured.length} réponses API capturées → .cache/debug-fff/fff-api.json`);
      for (const c of captured.slice(0, 10)) {
        console.log(`   ${c.url.slice(0, 120)}`);
      }
    }

    // Save full HTML for analysis
    const html = await page.evaluate(() => document.body.innerHTML);
    fs.writeFileSync(path.join(DEBUG_DIR, 'fff-results.html'), html);

  } catch (err) {
    console.log(`\n❌ Erreur: ${err.message}`);
    try { await page.screenshot({ path: path.join(DEBUG_DIR, 'fff-error.png') }); } catch (_) {}
  }

  console.log('\n(Fermez Chrome pour terminer)');
  await new Promise(r => browser.on('disconnected', r));
})();
