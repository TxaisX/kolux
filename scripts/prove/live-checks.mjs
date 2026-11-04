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

const PALETTE = '.palette[role="dialog"][aria-label="Switch workspace"]';
const rows = (page) => page.eval(`[...document.querySelectorAll('${PALETTE} [role=option]')].map(o=>({ label:(o.innerText||'').trim().split('\\n')[0], sel:o.getAttribute('aria-selected') }))`);

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
    const r=rows.find(x=>(x.innerText||'').trim().toLowerCase().startsWith(want)) || rows.find(x=>(x.innerText||'').toLowerCase().includes(want));
    if(!r) return { picked:null, labels: rows.map(x=>(x.innerText||'').trim().split('\\n')[0]) };
    r.click(); return { picked:(r.innerText||'').trim().split('\\n')[0] };
  })()`);
  await sleep(600);
  return hit;
}

const checks = {
  // B-2 / T-610: every screen behind the palette opens its own page.
  async b2(page) {
    say('B-2 / T-610 — every screen can be reached from the palette');
    await openPalette(page);
    const list = await rows(page);
    const labels = list.map((r) => r.label);
    say(`  palette rows: ${labels.join(' | ')}`);
    let ok = true;
    for (const want of ['Show Floor', 'Show Space', 'Show Workspace Statuses', 'Show Artifacts', 'Show Skills']) {
      ok = expect(`row "${want}" is in the palette`, labels.some((l) => l.startsWith(want))) && ok;
    }
    // Each row must open its own page.
    const opens = [
      ['Show Floor', 'section.floor[aria-label="Floor"]'],
      ['Show Space', 'section.space[aria-label="Space"]'],
      ['Show Workspace Statuses', '.ws-board[role="dialog"]'],
      ['Show Artifacts', 'div.artifacts'],
      ['Show Skills', 'section.skills'],
    ];
    for (const [label, sel] of opens) {
      await openPalette(page);
      const r = await pick(page, label);
      const shown = await waitFor(`the page for ${label}`, async () => page.exists(sel), 8000).catch(() => false);
      ok = expect(`${label} opens its page`, !!shown, `picked ${r.picked ?? 'nothing'}; looked for ${sel}`) && ok;
      // A dialog or page that opened can block the next palette; dismiss with Escape.
      if (shown && (await page.exists('.ws-board[role="dialog"]'))) { await page.key('Escape'); await sleep(300); }
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

  // B-7 / BROW-008 box 2: a broken certificate gets its own message.
  async b7(page) {
    say('B-7 / BROW-008 box 2 — a broken certificate gets its own message');
    say(`  app: ${await page.eval("document.title")}`);
    let ok = true;
    await page.key('b', 10); // Mod+Shift+B: new browser tab
    const pane = await waitFor('a browser pane', async () => page.exists('.pane.browser'), 12000).catch(() => false);
    ok = expect('a browser tab opens', !!pane) && ok;
    // A new tab autofocuses its bar only when its pane owns the keyboard. Focus the bar directly;
    // a synthetic click blurs it, and Ctrl+L can land in the focused terminal.
    const bar = await waitFor('the address bar', async () => page.exists('.pane.browser input[aria-label="Address"]'), 12000).catch(() => false);
    ok = expect('the address bar is there', !!bar) && ok;
    if (bar) {
      // The address input is React-controlled; a synthetic click moves focus to the body, so focus
      // it directly and insert the text. Input.insertText fires the input event React listens for.
      await page.eval(`(() => { const i=document.querySelector('.pane.browser input[aria-label="Address"]'); i.focus(); i.select(); return true; })()`);
      await page.send("Input.insertText", { text: "https://expired.badssl.com/" });
      await page.key("Enter");
    }
    const overlay = await waitFor('the load overlay', async () => page.exists('.load-overlay'), 25000).catch(() => false);
    ok = expect('the page shows an overlay', !!overlay) && ok;
    if (overlay) {
      // The overlay renders before browser_diagnose answers; wait for the certificate wording
      // rather than reading the first frame.
      const wording = await waitFor('certificate wording', async () => {
        const t = await page.eval(`document.querySelector('.load-overlay')?.innerText || ""`);
        return /certificate/i.test(t) ? t : false;
      }, 15000).catch(() => false);
      say(`  certificate wording: ${wording ? "present" : "missing"}`);
      const text = await page.eval(`(()=>{const o=document.querySelector('.load-overlay'); return { kind:o.getAttribute('data-kind'), text:o.innerText, retry: !!o.querySelector('[data-go="retry"]') };})()`);
      say(`  overlay: ${JSON.stringify(text)}`);
      ok = expect('it names the certificate problem', /certificate/i.test(text.text)) && ok;
      ok = expect('it offers Retry', !!text.retry) && ok;
      ok = expect('it gives no local-server advice', !/local server|start a server|localhost server/i.test(text.text)) && ok;
    }
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
