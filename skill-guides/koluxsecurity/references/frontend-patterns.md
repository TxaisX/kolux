# Frontend Vulnerability Patterns

React, Next.js, Vue, Svelte, and browser-side specifics. Many of the worst vulnerabilities of 2024–2026 (Next.js CVE-2025-29927, EchoLeak's exfil channel, Polyfill.io supply-chain) live in the frontend.

---

## XSS via `dangerouslySetInnerHTML` (and equivalents)

CWE-79. The most-frequently-filed CVE class.

```jsx
// VULN — direct render of user content
<div dangerouslySetInnerHTML={{ __html: post.body }} />

// FIX — sanitize first
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.body) }} />

// BETTER — render as text where possible
<div>{post.body}</div>
```

Equivalents in other frameworks:
- Vue: `v-html` — same risk.
- Svelte: `{@html ...}` — same risk.
- Handlebars: `{{{ ... }}}` (triple-stash) — same risk.
- Angular: `[innerHTML]` is sanitized by default; bypassing with `bypassSecurityTrustHtml` is the bug.

---

## DOM-based XSS

```jsx
// VULN
el.innerHTML = location.hash.slice(1);
el.outerHTML = userInput;
document.write(userInput);

// FIX
el.textContent = location.hash.slice(1);
```

Detection: `\b(innerHTML|outerHTML|document\.write)\s*=`.

---

## Unsafe Markdown Rendering

```jsx
// VULN — marked default config allows raw HTML
<div dangerouslySetInnerHTML={{ __html: marked(input) }} />

// FIX
const html = marked(input);
const safe = DOMPurify.sanitize(html);
// Or remark-rehype + rehype-sanitize:
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
const html = await unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeStringify)
  .process(input);
```

---

## Open Redirect

CWE-601. A staple of phishing chains.

```jsx
// VULN
router.push(searchParams.get('next'));
window.location.href = req.query.next;

// FIX
const next = searchParams.get('next');
const safe = next?.startsWith('/') && !next.startsWith('//') ? next : '/';
router.push(safe);
```

**Bypass to test against**:
- `//evil.com` (host-relative — `startsWith('/')` alone fails)
- `/\evil.com` (some browsers parse `\` as `/`)
- `https://app.example.com.evil.com` (suffix attack on naive prefix matching)
- Whitespace tricks: `/\t//evil.com`

Use a strict allowlist of internal paths via a regex like `^/[a-z0-9\-/_]+(?:\?[^#]*)?$`.

---

## Next.js Server Actions

**Critical pattern** — every Server Action is an unauthenticated RPC endpoint by default. Without explicit auth, anyone can invoke them by reverse-engineering the encoded action ID.

```ts
// VULN — anyone calling this from anywhere deletes any post
'use server';
export async function deletePost(id: string) {
  await db.post.delete({ where: { id } });
}

// FIX
'use server';
import { auth } from '@/auth';
export async function deletePost(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  const post = await db.post.findUnique({ where: { id } });
  if (post?.authorId !== session.user.id) throw new Error('forbidden');
  await db.post.delete({ where: { id } });
}
```

**Required for every Server Action**:
1. Authentication check (first non-trivial line).
2. Authorization check (ownership, not just role).
3. Input validation (zod schema).
4. Logging of the security-relevant event.

References:
- CVE-2024-34351 (SSRF via Server Action redirect).
- CVE-2025-29927 (middleware authz bypass via `x-middleware-subrequest`).

---

## Next.js Middleware Auth Anti-Pattern

```ts
// VULN — sole authz check in middleware (CVE-2025-29927 bypass via x-middleware-subrequest header)
export async function middleware(req) {
  if (!req.cookies.get('session')) {
    return NextResponse.redirect('/login');
  }
}

// FIX — middleware as defense-in-depth, not sole gate
// Always re-check auth inside the route/action handler.
// Strip `x-middleware-subrequest` at the edge (CDN / load balancer).
```

---

## SSR Data Leaks

```tsx
// VULN — entire user object (incl. passwordHash, stripeSecretKey) hydrated into HTML
const user = await db.user.findUnique({ where: { id } });
return <ClientThing user={user} />;

// FIX — explicitly project safe fields
return <ClientThing user={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }} />;
```

Anything passed as a prop to a Client Component appears in the page's RSC payload. Read your hydrated HTML during code review.

---

## Hydration Mismatches

When server and client render different content, the difference may leak server-only data into the page or be exploitable via injected client state. Avoid `Math.random()` / `Date.now()` / locale-dependent rendering in components without `suppressHydrationWarning` and proper `useEffect`-deferred client-only state.

---

## Client-Side Auth Checks

```tsx
// VULN — auth only on client; API doesn't re-check
{user.role === 'admin' && <DeleteButton />}

// Acceptable for UX
{user.role === 'admin' && <DeleteButton />}
// AS LONG AS the API/Server Action re-checks auth server-side.
```

The API contract is the boundary, not the UI.

---

## Prototype Pollution in Form Handlers

```js
// VULN
function update(target, src) {
  return Object.assign(target, src); // src from JSON.parse(req.body)
}

// FIX
const target = Object.create(null);
const src = JSON.parse(req.body);
for (const [k, v] of Object.entries(src)) {
  if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
  if (allowedKeys.has(k)) target[k] = v;
}
```

---

## CSP / CSRF / Cookies

### Content-Security-Policy
Minimum baseline (set via `next.config.js` headers / middleware):
```
default-src 'self';
script-src 'self' 'nonce-{NONCE}' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
font-src 'self' data:;
connect-src 'self' https://api.example.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
upgrade-insecure-requests;
```
Avoid `unsafe-inline` for `script-src`; prefer per-request nonces.

### Cookies
Always set:
- `httpOnly` — JS cannot read (no XSS-driven token theft).
- `secure` — HTTPS only.
- `sameSite=lax` (or `strict` for high-value sessions).
- `__Host-` prefix when origin-bound.
- `path=/`, no `domain=` (otherwise leaks to subdomains).

### CSRF
- SameSite=Lax/Strict cookies cover most cross-site POSTs.
- For cross-site flows (OAuth, embeds), use double-submit token + Origin header check.
- State-changing GET endpoints are CSRF-vulnerable by definition — make them POST.

---

## `target="_blank"` Without `rel`

```jsx
// VULN — opener can navigate this window via window.opener
<a href="https://other.com" target="_blank">link</a>

// FIX
<a href="https://other.com" target="_blank" rel="noopener noreferrer">link</a>
```

Modern browsers default to noopener; older ones don't. Always set explicitly.

---

## postMessage Without Origin Check

```js
// VULN
window.addEventListener('message', e => use(e.data));

// FIX
window.addEventListener('message', e => {
  if (e.origin !== 'https://trusted.example.com') return;
  use(e.data);
});
```

---

## next/image Wildcard Hosts

```js
// VULN — any remote image accepted; SSRF surface
remotePatterns: [{ hostname: '**' }]

// FIX
remotePatterns: [
  { protocol: 'https', hostname: 'images.partner.com' },
  { protocol: 'https', hostname: 'cdn.example.com' },
];
```

---

## Third-Party Script Supply Chain

The Polyfill.io 2024 incident: domain sold → malicious JS delivered to ~100k sites.

```html
<!-- VULN — no integrity, third-party CDN -->
<script src="https://cdn.example.com/lib.js"></script>

<!-- FIX — Subresource Integrity + crossorigin -->
<script
  src="https://cdn.example.com/lib.js"
  integrity="sha384-..."
  crossorigin="anonymous"
></script>
```

Better: self-host vetted versions; pin in `package.json` lockfile; review on every bump.

---

## eval / new Function in Frontend

```js
// VULN
new Function('return ' + expr)();
setTimeout('alert(' + x + ')', 100);
setInterval('fn(' + y + ')', 100);

// FIX — never. Use a parser or remove the feature.
```

Detection: `\b(eval|new Function)\s*\(` in any frontend file is almost always wrong outside math expression evaluators (use a real parser there too).

---

## Browser Storage of Secrets

- **localStorage / sessionStorage** are JS-readable → XSS = token theft. Never store auth tokens there.
- **httpOnly cookies** are correct for session tokens.
- **IndexedDB** has the same JS-readable risk; not appropriate for tokens.
- **Web Crypto** + non-extractable keys can hold cryptographic material safely if you really need client-side keys.

---

## Detection Cheat-Sheet (frontend-specific)

```
# Unsafe HTML sinks
\b(dangerouslySetInnerHTML|innerHTML|outerHTML|document\.write|v-html)\b
\{@html\s+|\{\{\{[^}]+\}\}\}

# Open redirect
(router\.push|router\.replace|window\.location\.(href|assign|replace))\s*\(\s*[^)]*(searchParams|req\.query|router\.query|location\.(hash|search))

# Eval
\b(eval|new Function)\s*\(
\bsetTimeout\s*\(\s*[`"'].*[`"']\s*,
\bsetInterval\s*\(\s*[`"'].*[`"']\s*,

# Server Actions without auth
^['"]use server['"];?\s*\n+\s*export\s+(async\s+)?function\s+\w+\s*\([^)]*\)\s*\{
# (then inspect first lines for auth() / session check)

# Storage of secrets
localStorage\.setItem\s*\(\s*['"](?:token|auth|jwt|session|api[_-]?key)

# Wildcard image patterns
hostname:\s*['"]\*\*?['"]

# Missing rel on _blank
target\s*=\s*['"]_blank['"](?![^>]*rel\s*=)
```
