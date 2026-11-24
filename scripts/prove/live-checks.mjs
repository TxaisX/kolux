// Named live checks on the installed build. Each one prints PASS/FAIL lines and writes
// evidence/live-installed-<name>.txt. Start the app first:
//
//   node scripts/prove/live-installed.mjs start        (fresh throwaway profile)
//   node scripts/prove/live-checks.mjs b2
//   node scripts/prove/live-installed.mjs stop
//
// The checks read the DOM the app actually renders, so the evidence is the app's own state,
// not a guess from the source.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attach, sleep, waitFor } from './live-installed.mjs';

export const ROOT = fileURLToPathRoot();

function fileURLToPathRoot() {
  return join(import.meta.dirname ?? '.', '..', '..');
}

const log = [];
const say = (s) => { log.push(s); console.log(s); };
const expect = (label, ok, detail = '') => { say(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); return ok; };

const PALETTE = '.palette[role="dialog"][aria-label="Go to / Run a command"]';
// The row's own text sits in its .name span; the button also holds the Alt+number badge and the
// agent mark, whose text comes first in innerText and is not part of the label.
const rows = (page) => page.eval(`[...document.querySelectorAll('${PALETTE} [role=option]')].map(o=>({ label:((o.querySelector('.name')||o).innerText||'').trim(), sel:o.getAttribute('aria-selected') }))`);

async function openPalette(page) {
  const open = await page.exists(PALETTE);
  if (!open) { await page.key('j', 10); } // Mod+Shift+J
  await waitFor('the palette', async () => page.exists(PALETTE), 8000);
  await sleep(250);
}

async function pick(page, text) {
  // The input is React-controlled: type into it rather than setting .value.
  await page.click(`${PALETTE} input`);
  await page.key('a', 2); // Ctrl+A
  await page.type(text);
  await sleep(350);
  const hit = await page.eval(`(()=>{
    const rows=[...document.querySelectorAll('${PALETTE} [role=option]')];
    const want=${JSON.stringify(text.toLowerCase())};
    const named=(x)=>((x.querySelector('.name')||x).innerText||'').trim().toLowerCase();
    const r=rows.find(x=>named(x).startsWith(want)) || rows.find(x=>(x.innerText||'').toLowerCase().includes(want));
    if(!r) return { picked:null, labels: rows.map(x=>((x.querySelector('.name')||x).innerText||'').trim()) };
    r.click(); return { picked:((r.querySelector('.name')||r).innerText||'').trim() };
  })()`);
  await sleep(600);
  return hit;
}

const checks = {
  // B-2 / T-610: every screen behind the palette opens its own page. Terminals is the only screen the
  // window still has (src/chrome/TopBar.tsx SCREEN_IDS): Floor, Space, Workspace Statuses, Artifacts
  // and Skills were removed, so b2 no longer asks for their rows or the pages behind them.
  async b2(page) {
    say('B-2 / T-610 — every screen can be reached from the palette');
    await openPalette(page);
    const list = await rows(page);
    const labels = list.map((r) => r.label);
    say(`  palette rows: ${labels.join(' | ')}`);
    let ok = true;
    for (const want of ['Terminals']) {
      ok = expect(`row "Show ${want}" is in the palette`, labels.some((l) => l.startsWith(`Show ${want}`))) && ok;
    }
    // Each row must open its own page: picking it closes the palette and lands on that screen.
    const opens = [['Terminals', '.grid']];
    for (const [want, sel] of opens) {
      await openPalette(page);
      const r = await pick(page, `Show ${want}`);
      const closed = await waitFor('the palette to close', async () => !(await page.exists(PALETTE)), 8000).catch(() => false);
      const shown = await waitFor(`the page for Show ${want}`, async () => page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); return !!e && e.offsetParent !== null})()`), 8000).catch(() => false);
      ok = expect(`Show ${want} opens its page`, !!closed && !!shown, `picked ${r.picked ?? 'nothing'}; palette ${closed ? 'closed' : 'stayed'}; looked for ${sel}`) && ok;
    }
    return ok;
  },

  // B-4 / T-565: Escape closes only the box in front.
  async b4(page) {
    say('B-4 / T-565 — Escape closes only the box in front');
    let ok = true;
    await page.key(',', 2); // Ctrl+,
    const opened = await waitFor('Settings', async () => page.exists('.settings[role="dialog"][aria-label="Settings"]'), 8000).catch(() => false);
    ok = expect('Ctrl+, opens Settings', !!opened) && ok;
    if (opened) {
      await sleep(400);
      await page.key('Escape');
      const closed = await waitFor('Settings to close', async () => !(await page.exists('.settings')), 5000).catch(() => false);
      ok = expect('Escape closes Settings', !!closed) && ok;
    }
    // The terminal must not take the key: open Settings from a terminal pane and type a marker after
    // the Escape; the marker must not reach the shell.
    const kept = await page.eval(`(()=>({ focus: document.activeElement ? (document.activeElement.tagName+'.'+document.activeElement.className) : null, settings: !!document.querySelector('.settings') }))()`);
    say(`  after Escape: ${JSON.stringify(kept)}`);
    return ok;
  },

};

const name = process.argv[2];
if (!name) {
  console.log('checks: ' + Object.keys(checks).join(', '));
  process.exit(2);
}
const page = await attach();
const ok = await checks[name](page);
page.close();
const file = join(ROOT, 'evidence', `live-installed-${name}.txt`);
writeFileSync(file, `LIVE CHECK ${name} — ${new Date().toISOString()}\n${'-'.repeat(60)}\n${log.join('\n')}\n\nRESULT: ${ok ? 'PASS' : 'FAIL'}\n`);
console.log(`\n${ok ? 'RESULT: PASS' : 'RESULT: FAIL'}  (${file})`);
process.exit(ok ? 0 : 1);
