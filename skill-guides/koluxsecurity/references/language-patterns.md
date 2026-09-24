# Per-Language Vulnerability Patterns

Vulnerable + fixed code pairs for each major backend stack. Detection regexes are grep-friendly. CVE references where applicable.

---

## JavaScript / TypeScript / Node.js

### Prototype Pollution
**CVE-class**: lodash <4.17.12 (CVE-2019-10744), Kibana CVE-2019-7609.
**Detection**: `\b(Object\.assign|_\.merge|_\.mergeWith|_\.set|_\.defaultsDeep|lodash\.set)\s*\([^)]*\b(req\.|request\.|ctx\.|JSON\.parse)`

```js
// VULN
const _ = require('lodash');
_.merge(target, JSON.parse(req.body)); // {"__proto__":{"isAdmin":true}}

// FIX
const target = Object.create(null);
const src = JSON.parse(req.body);
for (const [k, v] of Object.entries(src)) {
  if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
  if (allowedKeys.has(k)) target[k] = v;
}
// or use schema validator: const parsed = MySchema.parse(src);
```

### Path Traversal
```js
// VULN
fs.readFile(`./uploads/${req.query.name}`, cb);

// FIX
const ROOT = path.resolve('./uploads');
const target = path.resolve(ROOT, req.query.name);
if (!target.startsWith(ROOT + path.sep)) return res.sendStatus(400);
fs.readFile(target, cb);
```

### SSRF
```js
// VULN
const r = await fetch(req.query.url); // attacker → http://169.254.169.254/latest/meta-data/

// FIX
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
const ALLOW = new Set(['api.partner.com']);
async function safeFetch(rawUrl) {
  const u = new URL(rawUrl);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('proto');
  if (!ALLOW.has(u.hostname)) throw new Error('host');
  const { address } = await lookup(u.hostname);
  if (ipaddr.parse(address).range() !== 'unicast') throw new Error('private');
  return fetch(u, { redirect: 'error' });
}
```
TOCTOU note: re-check post-redirect; or `redirect: 'error'`.

### NoSQL Injection (Mongoose)
```js
// VULN
User.findOne({ username: req.body.username, password: req.body.password });
// Body: {"username":"admin","password":{"$ne":null}}

// FIX
if (typeof req.body.username !== 'string' || typeof req.body.password !== 'string')
  return res.sendStatus(400);
// Or middleware: app.use(require('express-mongo-sanitize')());
```

### Command Injection
```js
// VULN
const { exec } = require('child_process');
exec(`convert ${req.query.file} out.png`);

// FIX
const { execFile } = require('child_process');
execFile('convert', [req.query.file, 'out.png'], { shell: false }, cb);
// + validate filename matches /^[\w.\-]+$/
```

### Open Redirect
```js
// VULN
res.redirect(req.query.next);

// FIX
const ALLOW = new Set(['/dashboard', '/account']);
const dest = ALLOW.has(req.query.next) ? req.query.next : '/';
res.redirect(dest);
```
**Bypass**: `//evil.com` is host-relative — `next.startsWith('/') && !next.startsWith('//')`.

### ReDoS
**Catastrophic patterns**: `(a+)+`, `(a*)*`, `(a|aa)+`. Tools: `safe-regex` lint, switch to `re2` for linear time.
Known: `ms`, `moment`, `marked`, `validator.isEmail` historical.

### Deserialization
- `node-serialize.unserialize(userInput)` — RCE by design (`_$$ND_FUNC$$_` IIFE). Avoid.
- `eval`, `new Function` — never on user input.
- `serialize-javascript` is safe for output, not input.

### XXE
```js
// VULN
libxmljs.parseXml(xml, { noent: true });

// FIX
libxmljs.parseXml(xml, { noent: false, noblanks: true, nonet: true });
// fast-xml-parser: { processEntities: false }
```

### vm / vm2 Sandbox
- `vm2` is **deprecated** (CVE-2023-37466, CVE-2023-37903 host RCE).
- `vm` module is **not a security boundary** (Node docs).
- Use `isolated-vm` (V8 isolate) or QuickJS-emscripten. Better: don't run untrusted code in-process.

### JWT Misuse
```js
// VULN
jwt.verify(token, secret);          // accepts alg=none in old libs
jwt.verify(token, publicKey);       // RS256 expected; attacker forges with HS256 using publicKey as secret

// FIX
jwt.verify(token, key, {
  algorithms: ['RS256'],
  issuer: 'https://auth.example.com',
  audience: 'api',
});
```
CVE-2022-23529 (jsonwebtoken <9).

### CSRF / CORS / Cookies
```js
// VULN
app.use(cors({ origin: '*', credentials: true }));
res.cookie('sid', t);

// FIX
app.use(cors({ origin: 'https://app.example.com', credentials: true }));
res.cookie('sid', t, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
```

---

## Python

### Pickle / YAML / eval
```python
# RCE — never on untrusted input
pickle.loads(data)            # → json or msgpack with schema
yaml.load(data)               # → yaml.safe_load(data)
eval(user_input)              # → ast.literal_eval, or proper parser
exec(user_code)               # → never
```
CVE-class: GitHub Actions cache, MLflow CVE-2024-37052..37060 (pickle in model files). PyTorch `torch.load(weights_only=False)` is pickle — use `weights_only=True` (default in 2.6+) or safetensors.

### SQL Injection
```python
# VULN
cur.execute(f"SELECT * FROM u WHERE name = '{name}'")
cur.execute("SELECT * FROM u WHERE name = '%s'" % name)

# FIX
cur.execute("SELECT * FROM u WHERE name = %s", (name,))   # psycopg2
cur.execute("SELECT * FROM u WHERE name = ?", (name,))    # sqlite3
```

**SQLAlchemy text() + f-string**:
```python
db.execute(text(f"SELECT * FROM u WHERE id = {uid}"))                # VULN
db.execute(text("SELECT * FROM u WHERE id = :uid"), {"uid": uid})    # FIX
```

**Django**: `Model.objects.raw("SELECT ... %s" % x)` is vulnerable. Use `.raw(sql, [params])`.
`Model.objects.extra(where=[user_input])` — SQLi.
`**request.GET` into `.filter()` — field-name injection.

### SSRF
```python
import ipaddress, socket
from urllib.parse import urlparse

def safe_get(url):
    p = urlparse(url)
    if p.scheme not in ('http', 'https'): raise ValueError
    ip = ipaddress.ip_address(socket.gethostbyname(p.hostname))
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
        raise ValueError
    return requests.get(url, allow_redirects=False, timeout=5)
```

### Path Traversal (Flask)
```python
# VULN
@app.get("/d/<name>")
def d(name): return send_file(f"/uploads/{name}")

# FIX
from flask import send_from_directory
@app.get("/d/<path:name>")
def d(name): return send_from_directory("/uploads", name)  # rejects ..
```

### subprocess / shell
```python
subprocess.run(f"convert {f} out.png", shell=True)      # VULN
subprocess.run(["convert", f, "out.png"], shell=False)  # FIX
```

### XXE
```python
# VULN
etree.fromstring(xml)  # lxml: resolves entities by default in some versions

# FIX
parser = etree.XMLParser(resolve_entities=False, no_network=True, dtd_validation=False)
etree.fromstring(xml, parser)
# Prefer `defusedxml` for any XML.
```

### `assert` for Auth
```python
assert user.is_admin                      # WRONG — Python -O strips it
if not user.is_admin: raise PermissionDenied()  # FIX
```

### Insecure Random
```python
random.random(); random.choice(...)   # VULN for tokens
secrets.token_urlsafe(32)             # FIX
```

---

## Go

### Command / SQL / SSRF
```go
// VULN
exec.Command("sh", "-c", "convert "+name+" out.png")
db.Query(fmt.Sprintf("SELECT * FROM u WHERE id=%s", id))
http.Get(userURL)

// FIX
exec.Command("convert", name, "out.png")
db.Query("SELECT * FROM u WHERE id=$1", id)
// SSRF: custom http.Client with DialContext that rejects private IPs
```

### html/template vs text/template
`text/template` does NOT escape — XSS if used for HTML output. Detection: `import "text/template"` in code emitting HTML.

### Path Traversal
```go
// VULN — filepath.Join doesn't block ..
filepath.Join(root, userPath)

// FIX
clean := filepath.Clean("/" + userPath)
target := filepath.Join(root, clean)
if !strings.HasPrefix(target, root+string(os.PathSeparator)) { return err }
```
Go 1.20+ `filepath.IsLocal`; Go 1.24+ `os.Root` provide safer APIs.

### JSON Unmarshal
`json.Unmarshal` accepts unknown fields silently. Use `dec := json.NewDecoder(r); dec.DisallowUnknownFields()` to reject smuggled fields.

### Race / TOCTOU
Run `go test -race` in CI. Detection: shared map/slice without mutex; check-then-use file ops.

---

## Rust

### sqlx
```rust
// VULN
sqlx::query(&format!("SELECT ... {x}"));

// FIX
sqlx::query!("SELECT ... $1", x)   // compile-time checked
// or bind params via `.bind(x)`
```

### Command
```rust
// VULN
Command::new("sh").arg("-c").arg(format!("convert {f}"))
// FIX
Command::new("convert").arg(f).arg("out.png")
```

### unsafe Audit
For every `unsafe {}`: pointer validity, alignment, no aliased `&mut`, FFI invariants. Tools: `cargo geiger` (quantify), `miri` (UB detection in tests).

### Deserialization DoS
`serde_json::from_slice::<T>(huge)` with `Vec<u8>`/`String` fields → memory blowup. Wrap reader with byte cap.

---

## Java / Spring

### Log4Shell (CVE-2021-44228)
```java
// VULN
log.info("user-agent: " + request.getHeader("User-Agent")); // ${jndi:ldap://...}

// FIX
// Log4j ≥ 2.17.1
// log4j2.formatMsgNoLookups=true
```
Pattern: any logging of unsanitized HTTP input + Log4j 2.0–2.16.

### Spring4Shell (CVE-2022-22965)
Data binding to `class.module.classLoader.*` lets attacker rewrite Tomcat AccessLogValve to drop a JSP webshell.
**Fix**: Spring 5.3.18+/5.2.20+; or `@InitBinder` `setDisallowedFields("class.*", "Class.*", "*.class.*", "*.Class.*")`.

### XXE (JAXP defaults are unsafe)
```java
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
dbf.setXIncludeAware(false);
dbf.setExpandEntityReferences(false);
```

### HQL / JPQL Injection
```java
em.createQuery("FROM User WHERE name = '" + name + "'");                  // VULN
em.createQuery("FROM User WHERE name = :n").setParameter("n", name);      // FIX
```

### Java Deserialization
`ObjectInputStream.readObject()` on untrusted bytes → RCE via gadget chains (commons-collections, ysoserial). Migrate to JSON; if unavoidable, use `ObjectInputFilter` allowlist (JEP 290).

### SSRF
`RestTemplate.getForObject(userUrl, ...)`, `WebClient.create(userUrl)` — same fix as JS.

---

## Ruby / Rails

### Mass Assignment
```ruby
User.update(params[:user])                     # VULN
params.require(:user).permit(:name, :email)    # FIX
```

### YAML.load / Marshal.load
`YAML.load(user)` historically RCE (Psych). Use `YAML.safe_load(user)`. `Marshal.load` on untrusted — never.

### SQL
```ruby
User.where("name = '#{params[:n]}'")            # VULN
User.where("name = ?", params[:n])              # FIX
User.where(name: params[:n])                    # FIX
ActiveRecord::Base.connection.execute("...#{x}") # VULN
```

### Open Redirect
`redirect_to params[:return_to]` — Rails 7+ requires `allow_other_host: false` (default). Validate against allowlist.

---

## PHP

```php
// LFI/RFI
include $_GET['page'];                                // VULN
$pages = ['home','about'];
if (in_array($p, $pages, true)) include "$p.php";     // FIX

// Unserialize
unserialize($_COOKIE['x']);                           // RCE via magic methods
json_decode($_COOKIE['x'], true);                     // FIX

// Weak comparison
if ($hash == $expected)                               // "0e123" == "0e456" → true
if (hash_equals($expected, $hash))                    // FIX, constant-time

// SQLi
mysqli_query($db, "SELECT ... '$user'");              // VULN
$s = $db->prepare("SELECT ... ?");                    // FIX
$s->bind_param("s", $user); $s->execute();
```

---

## SQL / ORM Injection — Per-Library Reference

| ORM | Unsafe | Safe |
|---|---|---|
| pg (node-postgres) | `client.query(\`SELECT ${id}\`)` | `client.query('SELECT $1', [id])` |
| mysql2 | `conn.query('SELECT ' + id)` | `conn.execute('SELECT ?', [id])` |
| TypeORM | `repo.query('SELECT ... "' + name + '"')` | `repo.query('... $1', [name])` or QueryBuilder `.where('name = :name', { name })` |
| Sequelize | `sequelize.query('... ' + id)`; `Sequelize.literal(input)` | `sequelize.query('... :id', { replacements: { id } })` |
| Prisma | `prisma.$queryRawUnsafe(\`... ${name}\`)` | ``prisma.$queryRaw`SELECT ... ${name}` `` (tagged template auto-parameterizes) |
| Drizzle | `db.execute(sql.raw(\`... ${name}\`))` | ``db.execute(sql`SELECT ... ${name}`)`` |
| Knex | `knex.raw('... ' + name)` | `knex.raw('... ?', [name])` or `.where({ name })` |
| Mongoose | `User.find({ $where: '... ' + x })`; `User.find(req.body)` | strict schema; `User.find({ x: Number(x) })` |
| MongoDB driver | `find({ name: req.body.name })` where name is `{ $ne: null }` | coerce: `String(req.body.name)` |
| SQLAlchemy | `session.execute('... ' + name)` | `session.execute(text('... :name'), {'name': name})` |
| Django ORM | `User.objects.raw('... ' + name)`; `.extra(where=[f"name='{n}'"])` | `User.objects.raw('... %s', [name])`; avoid `.extra` |
| ActiveRecord | `User.where("name = '#{n}'")` | `User.where('name = ?', n)` or `.where(name: n)` |

**Detection signal**: any function whose name contains `raw`/`literal`/`unsafe`/`Unsafe` accepting a non-constant string. Tagged-template `sql\`…\`` with interpolated variables in Drizzle/Prisma is **safe**; `sql.raw(...)` is **not**.

---

## Authentication — Cross-Language

| Issue | Fix |
|---|---|
| No session expiry | Short access-token TTL (15 min) + refresh rotation |
| JWT in localStorage | `httpOnly; Secure; SameSite=Lax/Strict` cookie |
| Missing CSRF | SameSite=Strict + double-submit token |
| No login rate-limit | Per-IP + per-account exponential backoff |
| No MFA | TOTP/WebAuthn second factor |
| Weak hashing | Argon2id (m=64MB, t=3, p=1) or bcrypt cost ≥ 12 |
| Tokens in URL | POST tokens; expire on first use |
| Missing OAuth `state` | Generate CSRF-bound state; verify on callback |
| Missing PKCE | Always require `code_challenge=S256` for public clients |
| Open redirect on OAuth callback | Strict allowlist match (full URI, not prefix) |
| Email enumeration | Same message + same timing for unknown vs wrong |
| Predictable reset token | `crypto.randomBytes(32)` URL-safe; ≤15 min; single-use |
| `alg=none` JWT | Pin `algorithms: ['RS256']` |
| HS256/RS256 confusion | Pin algorithm; distinct keys per algorithm |
| Cookies without flags | `Secure; HttpOnly; SameSite`; `__Host-` prefix |

---

## Crypto — Cross-Language

| Issue | Fix |
|---|---|
| Weak hash (MD5/SHA1) | SHA-256/SHA-3 for integrity; Argon2id/bcrypt/scrypt for passwords; HMAC-SHA-256 for MAC |
| ECB mode | `aes-256-gcm` with 96-bit random IV |
| Hardcoded IV | `crypto.randomBytes(12)` per encryption |
| `Math.random()` for tokens | `crypto.randomBytes` / `crypto.getRandomValues` |
| `rejectUnauthorized: false` | Use system trust store; pin where appropriate |
| TLS 1.0/1.1 | TLS 1.2 minimum, prefer 1.3 |
| Missing HSTS | `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` |
| Hardcoded keys | KMS / HSM / Secrets Manager; envelope encryption |
| Static nonce in AES-GCM | Random 96-bit nonce per message; rotate keys |
| Custom crypto | `libsodium` / WebCrypto `subtle.encrypt` |
| `===` for HMAC/token compare | `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` |
| Reused KDF salt | Per-user random ≥16 bytes |
