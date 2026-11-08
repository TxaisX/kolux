// JS license gate (LOOP.md section 0): every installed npm package must carry one of the allowed
// licenses. Reads `pnpm licenses list --json` and fails on anything else.
// Run: node scripts/license-check.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const allowed = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib', '0BSD', 'MPL-2.0', 'Unicode-3.0', 'Unicode-DFS-2016', 'BlueOak-1.0.0', 'CC0-1.0', 'Python-2.0', 'CC-BY-4.0', 'Unlicense']);
// Expressions: every alternative of an OR must be allowed-or-not matter; one allowed alternative is enough.
const ok = expr => expr.split(/\s+OR\s+/i).some(alt => allowed.has(alt.replace(/[()]/g, '').trim()))
  || expr.split(/\s+AND\s+/i).every(alt => allowed.has(alt.replace(/[()]/g, '').trim()));

// T-589 (X-proc.14): pnpm before 12 lists a package whose package.json names no license as "Unknown",
// even when it ships a licence file (khroma: a lowercase `license` holding the MIT text). Reading that
// file gives the same answer on every pnpm. ponytail: the common permissive texts only; a package with
// another text stays Unknown and fails, which is the safe side.
const TEXTS = [
  ['MIT', /Permission is hereby granted, free of charge/],
  ['ISC', /Permission to use, copy, modify, and\/or distribute this software for any/],
  ['Apache-2.0', /Apache License,?\s+Version 2\.0/],
  ['BSD-3-Clause', /Redistribution and use in source and binary forms[\s\S]*Neither the name/],
  ['BSD-2-Clause', /Redistribution and use in source and binary forms/],
];
export function licenceFromFile(dir) {
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).find(f => /^licen[cs]e(\.(md|txt))?$/i.test(f)) : null;
  const text = file ? fs.readFileSync(path.join(dir, file), 'utf8') : '';
  return TEXTS.find(([, re]) => re.test(text))?.[0] ?? null;
}

/** The packages whose licence is not allowed, as `name@versions · licence`. */
export function failures(byLicense) {
  const bad = [];
  for (const [license, pkgs] of Object.entries(byLicense))
    for (const p of pkgs) {
      const fromFile = license === 'Unknown' && p.paths?.length > 0 && p.paths.every(dir => ok(licenceFromFile(dir) ?? 'Unknown'));
      if (!ok(license) && !fromFile) bad.push(`${p.name}@${p.versions?.join(',') ?? p.version} · ${license}`);
    }
  return bad;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const byLicense = JSON.parse(execSync('pnpm licenses list --json --long', { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  const bad = failures(byLicense);
  console.log(`license-check: ${Object.values(byLicense).flat().length} packages, ${Object.keys(byLicense).length} licenses`);
  if (bad.length) { console.error('not allowed:\n' + bad.join('\n')); process.exit(1); }
  console.log('license-check: OK');
}
