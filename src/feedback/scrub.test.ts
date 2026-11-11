// APP-037: paths and secrets are scrubbed from the feedback text before it goes into the address.
// Every secret here is made up (hunter2 style).
import { expect, test } from "vitest";
import { scrub } from "./scrub";

test("app037: file paths of every kind are replaced, the words around them stay", () => {
  // a path under a user profile folder takes the rest of its line (FIX-1), so those stand last on a line
  const text = "crash in D:\\work\\proj\\src\\a.ts and ~/notes/y.md plus \\\\srv\\share\\f.txt and /opt/tool/bin/x done\nlast in C:\\Users\\me\\proj\\a.ts\nthen /home/me/work/x.rs";
  const out = scrub(text);
  for (const gone of ["D:\\work", "proj\\src", "C:\\Users", "me\\proj", "/home/me", "work/x.rs", "~/notes", "y.md", "\\\\srv", "f.txt", "/opt/tool"]) expect(out, gone).not.toContain(gone);
  expect(out).toBe("crash in [path] and [path] plus [path] and [path] done\nlast in [path]\nthen [path]");
});

test("app037: ordinary text, web addresses and slash commands are not mistaken for paths", () => {
  for (const keep of [
    "The pane froze after a resize",
    "use and/or here",
    "type /clear to start over",
    "see https://github.com/TxaisX/kolux/issues/12 for it",
    "a ratio of 3/4 and 12/05",
  ]) {
    expect(scrub(keep), keep).toBe(keep);
  }
});

test("app037: secrets are masked by shape, by key name and inside addresses", () => {
  const secrets = [
    "sk-ant-api03-FAKEFAKEFAKE1234567890",
    "ghp_FAKEFAKEFAKEFAKE1234567890",
    "github_pat_FAKEFAKEFAKE1234567890",
    "xoxb-FAKE-1234567890-abcdef",
    "AKIAFAKEFAKEFAKE1234",
    "eyJhbGciOiJIUzI1NiJ9.eyJmYWtlIjoxfQ.FAKESIGNATURE12345",
    "hunter2",
    "correcthorse",
  ];
  const text = [
    "key sk-ant-api03-FAKEFAKEFAKE1234567890",
    "gh ghp_FAKEFAKEFAKEFAKE1234567890 and github_pat_FAKEFAKEFAKE1234567890",
    "slack xoxb-FAKE-1234567890-abcdef aws AKIAFAKEFAKEFAKE1234",
    "jwt eyJhbGciOiJIUzI1NiJ9.eyJmYWtlIjoxfQ.FAKESIGNATURE12345",
    "password: hunter2",
    "token=hunter2",
    'config {"api_key": "hunter2"}',
    "ANTHROPIC_API_KEY=hunter2",
    "Authorization: Bearer abcdefghijklmnop",
    "git clone https://me:hunter2@github.com/me/repo.git",
    "my password is correcthorse",
  ].join("\n");
  const out = scrub(text);
  for (const s of secrets) expect(out, s).not.toContain(s);
  expect(out).not.toContain("abcdefghijklmnop");
  expect(out).toContain("github.com/me/repo.git"); // the rest of the address stays
  expect(out).toContain("[masked]");
});

test("app037: words that merely contain a key name are left alone, and scrubbing twice changes nothing", () => {
  expect(scrub("monkey: banana")).toBe("monkey: banana");
  expect(scrub("the token ring network")).toBe("the token ring network");
  const messy = "C:\\Users\\me\\a.ts password=hunter2 /home/me/x/y ghp_FAKEFAKEFAKEFAKE1234567890 Bearer abcdefghijklmnop";
  expect(scrub(scrub(messy))).toBe(scrub(messy));
});

test("app037: line endings are kept as typed", () => {
  expect(scrub("one\r\ntwo\r\n\r\nthree")).toBe("one\r\ntwo\r\n\r\nthree");
});

// FIX-1 (council review of 9b6e5841, FIX-BEFORE 1): every probe the reviewer ran. All names and
// secrets here are made up.
test("fix1: a user folder with a space in its name never leaks, nor the folders after it", () => {
  const out = scrub("see C:\\Users\\Jane Doe\\AppData\\Roaming\\app\\log.txt");
  expect(out).toBe("see [path]");
  const cloud = scrub("saved in C:\\Users\\Jane Doe\\OneDrive - Contoso Ltd\\Desktop\\plan.docx");
  for (const gone of ["Jane", "Doe", "Contoso", "plan.docx"]) expect(cloud, gone).not.toContain(gone);
  const lin = scrub("opened /home/jane doe/projects/my app/main.rs\nand /Users/Jane Doe/Library/x");
  for (const gone of ["jane", "Jane", "doe", "Doe", "projects", "Library"]) expect(lin, gone).not.toContain(gone);
});

test("fix1: a quoted or backticked profile path stops at its closing mark, not before it", () => {
  expect(scrub('failed to open "C:\\Users\\Jane Doe\\a b\\c.txt" twice')).toBe('failed to open "[path]" twice');
  expect(scrub("run `/home/jane doe/bin/x` again")).toBe("run `[path]` again");
  const o = scrub("it is 'C:\\Users\\O'Brien\\x.txt' now");
  for (const gone of ["O'Brien", "Brien", "x.txt"]) expect(o, gone).not.toContain(gone);
});

test("fix1: paths after a backtick, a brace, a colon, in a file address and without a drive are replaced", () => {
  const cases: Array<[string, string]> = [
    ["see `C:\\Users\\jane\\proj\\a.ts` here", "jane"],
    ["file:///C:/Users/jane/Desktop/a.txt", "jane"],
    ["opened file:///home/jane/notes/a.txt", "jane"],
    ["error:C:\\Users\\jane\\x", "jane"],
    ["path:/home/jane/x/y", "jane"],
    ["at {C:\\Users\\jane\\x}", "jane"],
    ["\\Users\\jane\\Desktop\\x", "jane"],
    ["in `D:\\work\\secret-project\\a.ts` too", "secret-project"],
    ["{D:\\work\\secret-project\\a.ts}", "secret-project"],
    ["error:D:\\work\\secret-project\\a.ts", "secret-project"],
    ["file:///D:/work/secret-project/a.ts", "secret-project"],
  ];
  for (const [text, leak] of cases) {
    const out = scrub(text);
    expect(out, text).not.toContain(leak);
    expect(out, text).toContain("[path]");
  }
});

test("fix1: addresses on the web and the words that follow them are still left alone", () => {
  for (const keep of ["see https://github.com/TxaisX/kolux/issues/12 for it", "at http://localhost:3000/api/users now", "ws://host:80/a/b and mailto:me@x.org"]) {
    expect(scrub(keep), keep).toBe(keep);
  }
});

test("fix1: private key blocks, live payment keys, GitLab and npm tokens, and password flags are masked", () => {
  const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAAFAKEFAKEFAKE\nAAAAFAKEFAKEFAKEFAKE\n-----END OPENSSH PRIVATE KEY-----";
  expect(scrub(`before\n${pem}\nafter`)).toBe("before\n[masked]\nafter");
  const cut = scrub("pasted -----BEGIN RSA PRIVATE KEY-----\nMIIFAKEFAKEFAKE\nand no end");
  expect(cut).not.toContain("MIIFAKE");
  const secrets = ["sk_live_FAKEFAKEFAKE12345678", "rk_live_FAKEFAKEFAKE12345678", "glpat-FAKEFAKEFAKE12345678", "npm_FAKEFAKEFAKEFAKE1234567890", "hunter2", "swordfish"];
  const out = scrub(
    [
      "stripe sk_live_FAKEFAKEFAKE12345678 and rk_live_FAKEFAKEFAKE12345678",
      "gitlab glpat-FAKEFAKEFAKE12345678",
      "npm_FAKEFAKEFAKEFAKE1234567890",
      "tool --password hunter2 --user me",
      "tool --token swordfish",
      'tool --password "hunter2"',
      "pass: hunter2",
    ].join("\n"),
  );
  for (const s of secrets) expect(out, s).not.toContain(s);
  expect(out).toContain("--user me");
  expect(out).toContain("--password [masked]");
  expect(out).toContain("pass: [masked]");
  // ordinary words that only start like these stay
  for (const keep of ["npm_config_registry is unset", "the test passed: yes", "--passwords are fine", "a --token-count of five", "run --password --verbose"]) expect(scrub(keep), keep).toBe(keep);
});

test("fix1: the new rules are idempotent too", () => {
  const messy = "see C:\\Users\\Jane Doe\\x.txt\n-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\ntool --password hunter2 `D:\\w\\a.ts` file:///home/jane/x/y glpat-FAKEFAKEFAKE12345678";
  expect(scrub(scrub(messy))).toBe(scrub(messy));
});

// FIX-2 (council review of c75c2b61). All names and secrets are made up.
test("fix2: a user folder is found in any letter case and in the Git Bash and WSL spellings, with a space in the name", () => {
  const paths = [
    "C:\\users\\Jane Doe\\x.txt",
    "c:\\USERS\\jane doe\\x",
    "/c/Users/Jane Doe/x",
    "/C/users/jane doe/x",
    "/mnt/c/Users/Jane Doe/x",
    "/mnt/d/users/jane doe/x",
    "/cygdrive/c/Users/Jane Doe/x",
    "//wsl$/Ubuntu/home/jane doe/x",
    "//wsl$/Ubuntu-22.04/home/Jane Doe/x",
    "\\\\wsl$\\Ubuntu\\home\\jane doe\\x",
    "\\\\wsl.localhost\\Ubuntu\\home\\jane doe\\x",
    "\\\\wsl.localhost\\Debian\\mnt\\c\\Users\\Jane Doe\\x",
    "/HOME/jane doe/x",
  ];
  for (const p of paths) {
    for (const text of [`see ${p}`, `failed to open "${p} y.txt" twice`, `run \`${p} y\` now`]) {
      const out = scrub(text);
      for (const gone of ["Jane", "jane", "Doe", "doe"]) expect(out, text).not.toContain(gone);
      expect(out, text).toContain("[path]");
    }
    expect(scrub(`see ${p}`), p).toBe("see [path]");
  }
});

test("fix2: web addresses with home or users in them are still left alone", () => {
  for (const keep of ["see https://example.org/home/page and https://example.org/Users/list", "see http://c/Users is a host", "git clone https://wsl.localhost/home/a"]) {
    expect(scrub(keep), keep).toBe(keep);
  }
});

test("fix2: the long-path prefixes (backslash backslash, question mark or dot, backslash) and the UNC form are masked whole", () => {
  const paths = [
    "\\\\?\\UNC\\fileserver\\home$\\jane\\x",
    "\\\\?\\UNC\\fileserver\\Users\\Jane Doe\\x",
    "\\\\?\\UNC\\fileserver\\share\\client\\a.ts",
    "\\\\?\\C:\\Users\\jane\\x.txt",
    "\\\\?\\C:\\Users\\Jane Doe\\x.txt",
    "\\\\?\\D:\\work\\client\\a.ts",
    "\\\\.\\D:\\work\\client\\a.ts",
    "\\\\?\\Volume{0f1e2d3c}\\work\\client\\a.ts",
    "\\\\?\\unc\\fileserver\\home$\\jane\\x",
  ];
  for (const p of paths) {
    const out = scrub(`see ${p}`);
    for (const gone of ["jane", "Jane", "Doe", "client", "fileserver", "work", "0f1e2d3c"]) expect(out, p).not.toContain(gone);
    expect(out, p).toBe("see [path]");
    expect(scrub(out), p).toBe(out);
  }
  expect(scrub("error \\\\?\\D:\\work\\client\\a.ts, retry")).toBe("error [path], retry");
  expect(scrub("error:\\\\?\\D:\\work\\client\\a.ts")).toBe("error:[path]");
});

test("fix2: webhook addresses, hf_, AccountKey, sig, MYSQL_PWD, --pass, 'pass is', backtick values and 'Authorization: token' are masked", () => {
  const cases: Array<[string, string]> = [
    ["post https://hooks.slack.com/services/T000FAKE/B000FAKE/XXXXFAKEFAKE now", "T000FAKE"],
    ["post https://hooks.slack.com/services/T000FAKE/B000FAKE/XXXXFAKEFAKE now", "XXXXFAKE"],
    ["post https://discord.com/api/webhooks/123456789/abcFAKE-token_x now", "abcFAKE"],
    ["post https://discordapp.com/api/v10/webhooks/123456789/abcFAKE-token_x now", "abcFAKE"],
    ["hf_FAKEFAKEFAKEFAKE12345678", "hf_FAKE"],
    ["DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=ZmFrZWZha2VrZXk=;EndpointSuffix=core", "ZmFrZWZha2VrZXk"],
    ["https://acme.blob.core/x?sv=2020&sig=FAKEsig%2Bvalue%3D&se=2030", "FAKEsig"],
    ["MYSQL_PWD=hunter2 mysql -u me", "hunter2"],
    ["mysql --pass hunter2 db", "hunter2"],
    ["mysql --pwd hunter2 db", "hunter2"],
    ["my pass is hunter2", "hunter2"],
    ["my pwd was hunter2", "hunter2"],
    ["token: `abc def`", "def"],
    ["secret = `hunter2 and more`", "more"],
    ["Authorization: token ghp_short", "ghp_short"],
    ["Authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"],
  ];
  for (const [text, leak] of cases) {
    const out = scrub(text);
    expect(out, text).not.toContain(leak);
    expect(out, text).toContain("[masked]");
    expect(scrub(out), text).toBe(out); // masking twice changes nothing
  }
  expect(scrub("Authorization: token ghp_short")).toBe("Authorization: token [masked]");
  expect(scrub("mysql --pass hunter2 db")).toBe("mysql --pass [masked] db");
  expect(scrub("DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=ZmFrZWZha2VrZXk=;EndpointSuffix=core")).toContain("AccountName=acme;");
  expect(scrub("post https://hooks.slack.com/services/T000FAKE/B000FAKE/XXXXFAKEFAKE now")).toBe("post [masked] now");
  // look-alikes stay
  for (const keep of ["the sig file and a signal: 5", "a bypass is fine", "he passed is odd", "run --pass-through x", "see https://hooks.slack.com/ for docs", "see https://discord.com/api/docs for it", "hf_trainer is a name", "cwd: here and pwd"]) {
    expect(scrub(keep), keep).toBe(keep);
  }
});

// FIX-2 (FIX-SOON 2): a long single-line paste (a minified file, a base64 blob) must not freeze the window.
// On c75c2b61 these took 5 to 11 seconds each.
{
  const shapes: Record<string, string> = {
    letters: "a".repeat(40_000),
    flags: "--x-".repeat(10_000),
    dots: "C:\\" + ".".repeat(40_000),
    dotsThenWord: "C:\\" + ".".repeat(40_000) + "x",
    quotedClosed: 'open "C:\\Users\\Jane Doe\\a b.txt" '.repeat(5_000),
    quotedOpen: '"C:\\Users\\Jane Doe\\a '.repeat(5_000),
    keywords: "password".repeat(5_000),
    dashes: "-".repeat(40_000),
    dotWords: "a.".repeat(20_000),
    schemes: "ab+".repeat(13_000) + "://",
    slashes: "/a".repeat(20_000),
    pairs: "key=".repeat(10_000),
    sentence: "word ".repeat(8_000),
  };
  for (const [name, text] of Object.entries(shapes)) {
    test(`fix2: a ${text.length} character single line (${name}) is scrubbed in well under a second`, { timeout: 60_000 }, () => {
      const t0 = performance.now();
      const out = scrub(text);
      const ms = performance.now() - t0;
      expect(ms, `${name} took ${ms.toFixed(0)} ms`).toBeLessThan(800);
      expect(out.length, name).toBeGreaterThan(0);
    });
  }
}

test("fix2: a bounded rule still masks a long key name, a long flag and a long path", () => {
  const key = "MY_VERY_" + "LONG_".repeat(8) + "PASSWORD";
  expect(scrub(`${key}=hunter2`)).toBe(`${key}=[masked]`);
  expect(scrub("tool --my-own-auth-token swordfish")).toBe("tool --my-own-auth-token [masked]");
  const deep = "C:\\work\\" + "folder\\".repeat(300) + "a.ts";
  expect(scrub(`see ${deep}, then`)).toBe("see [path], then");
  // a quoted profile path of 3000 characters still hides the name and the rest (a path over the cap is masked to the end of its line)
  const quoted = `"C:\\Users\\Jane Doe\\${"deep folder\\".repeat(250)}x.txt" and more`;
  const out = scrub(quoted);
  for (const gone of ["Jane", "Doe", "deep", "x.txt"]) expect(out, gone).not.toContain(gone);
});

test("an xAI (Grok) key, which Kolux itself asks for, is masked wherever it appears", () => {
  const out = scrub("Grok said: Incorrect API key provided: xai-FAKEfakeFAKEfake1234567890abcd. Try again");
  expect(out).not.toContain("FAKEfake");
  expect(out).toContain("[masked]");
  expect(scrub(out)).toBe(out);
  expect(scrub("the xai-sdk package")).toBe("the xai-sdk package");
});
