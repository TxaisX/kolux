// APP-037: paths and secrets are scrubbed from the feedback text before it goes into the new-issue
// address, because the report leaves for a public page. Masking is idempotent: the replacements
// ("[path]", "[masked]") match none of the rules. Line endings are never touched.
//
// ponytail: a path with a space in it is cut at the first space (the rest stays), except under a user
// profile folder (C:\Users\<name>, /home/<name>, /Users/<name>, \Users\<name>, Git Bash /c/Users/<name>,
// WSL /mnt/c/Users/<name> and \\wsl$\<distro>\home\<name>, in any letter case), whose name may hold a
// space: that one masks the rest of the line, or up to the quote or backtick that closes it (FIX-1 and
// FIX-2, council reviews of 9b6e5841 and c75c2b61). Relative paths (src/a.ts) are left, since they name
// nothing outside the project. Raise either only if a real report leaks one.
//
// Speed (FIX-2): a paste can be one 40 000 character line (a minified file, a base64 blob) and this runs
// on the window's own thread, so no rule may rescan a long run of text from every start position:
// every open-ended run in a key name, flag, scheme or quoted path is capped, and the trailing marks of
// a path are found by walking back from its end. scrub.test.ts times the awkward shapes.

const MASK = "[masked]";
const PATH = "[path]";

/** Where a path may begin: the start, white space, a quote, backtick or bracket, `=`, `,`, `;` or `:`. */
const AT = "(^|[\\s\"'`(\\[<{=,;:])";
const REST = "[^\\s\"'`<>|*?]*";
/** The long-path prefixes `\\?\` and `\\.\`, and `\\?\UNC\` (the same as `\\`). */
const LONG = String.raw`\\\\[?.]\\`;
const LONG_UNC = String.raw`\\\\[?.]\\UNC\\`;
const HOST = "[A-Za-z0-9_.$-]+";
/**
 * The front of a user profile path: the name that follows may hold spaces, so the rest is masked whole.
 * Matched in any letter case. Forms: C:\Users\, \\?\C:\Users\, \Users\, /home/, /Users/, Git Bash /c/Users/,
 * WSL /mnt/c/Users/, \\server\Users\ and \\server\home$\ (also behind \\?\UNC\), //wsl$/<distro>/home/ and
 * \\wsl.localhost\<distro>\home\.
 */
const PROFILE =
  "(?:" +
  [
    String.raw`(?:${LONG})?[A-Za-z]:[\\/]+Users[\\/]+`,
    String.raw`\\Users[\\/]+`,
    String.raw`/(?:(?:mnt|cygdrive)/[a-z]/|[a-z]/)?(?:home|Users)/+`,
    String.raw`(?:${LONG_UNC}|\\\\)${HOST}\\(?:Users|homes?\$?)[\\/]+`,
    String.raw`(?:(?<!:)//|\\\\)wsl(?:\$|\.localhost)[\\/]+[^\\/\s]+[\\/]+(?:(?:mnt|cygdrive)[\\/]+[a-z][\\/]+)?(?:home|Users)[\\/]+`,
  ].join("|") +
  ")";
/**
 * A profile path inside a quote or backtick: masked up to the matching mark (an apostrophe inside a word,
 * O'Brien, does not close it). The search for the closing mark stops after QUOTED_CAP characters; a path
 * that is longer, or never closed, is masked to the end of its line by PROFILE_LINE instead.
 */
const QUOTED_CAP = 2000;
const QUOTED_PROFILE = new RegExp(`(["'\`])(${PROFILE}[^\\r\\n]{0,${QUOTED_CAP}}?)(?=\\1(?!\\w))`, "gi");
const PROFILE_LINE = new RegExp(`${AT}(${PROFILE}[^\\s][^\\r\\n]*)`, "gi");
/** `file:///C:/x` and `file:///home/x`: the address start goes, the path is then found as any other. */
const FILE_URL = /\bfile:\/\/(?:\/(?=[A-Za-z]:[\\/])|(?=\/[\w.~@%+-]+\/))/gi;
const PATHS = [
  new RegExp(`${AT}((?:${LONG})?[A-Za-z]:[\\\\/]${REST})`, "g"), // C:\Users\me\x, C:/x, \\?\D:\x
  new RegExp(`${AT}((?:${LONG_UNC}|\\\\\\\\)${HOST}\\\\${REST})`, "g"), // \\server\share\x, \\?\UNC\server\share\x
  new RegExp(`${AT}(${LONG}${REST})`, "g"), // \\?\Volume{..}\x, \\.\pipe\x: whatever the rules above left
  new RegExp(`${AT}(~[\\\\/]${REST})`, "g"), // ~/x, ~\x
  new RegExp(`${AT}(/[\\w.~@%+-]+(?:/${REST})+)`, "g"), // /home/me/x: two parts at least, so /clear stays
];
const TRAILING_MARKS = ".,;:!?)]}'\"`";

/** The punctuation at the end of a path that belongs to the sentence, not the path. Walks back, so it is linear. */
function trailingMarks(path: string): string {
  let i = path.length;
  while (i > 0 && TRAILING_MARKS.includes(path[i - 1])) i--;
  return path.slice(i);
}

/** Secret shapes that are secrets wherever they appear. */
const SHAPES = [
  /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?(?:-----END \1-----|$)/g, // a PEM block, key or certificate; one cut off before its END goes to the end of the text
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe secret and restricted keys
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g, // GitLab
  /\bnpm_[A-Za-z0-9]{16,}/g,
  /\bhf_[A-Za-z0-9]{16,}/g, // Hugging Face
  /\bxai-[A-Za-z0-9]{20,}/g, // xAI (the Grok card's key)
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, // a JSON web token
  /\bhttps?:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]+/gi, // a Slack webhook address is a credential
  /\bhttps?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9._-]+/gi, // so is a Discord one
];

/**
 * A name that marks its value as a secret. The name is found by its keyword alone (what stands before it is
 * left in place, and nothing before it needs scanning), then up to 128 more name characters.
 */
const NAME = String.raw`(?:password|passwd|passphrase|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|account[_-]?key|credential|authorization|pwd)[A-Za-z0-9_.-]{0,128}|(?<![\w.-])(?:pwd|key|pass|sig)`;
const SCHEME = "(?:Bearer|Basic|Token|Digest)[ \\t]+";
/** `name: value`, `name=value`, `"name": "value"`, name = `value`: the value goes, the name (and a scheme word such as Bearer or token) stays. */
const PAIR = new RegExp(
  `(${NAME})(["']?\\s*[:=]\\s*)(?!(?:${SCHEME})?\\[masked\\])(${SCHEME})?("[^"\\r\\n]*"|'[^'\\r\\n]*'|\`[^\`\\r\\n]*\`|[^\\s"',;}]+)`,
  "gi",
);
/** `--password hunter2`, `--auth-token abc`, `--pass x`: a flag named like a secret takes the next word. */
const FLAG = /(--(?:[a-z0-9]+-){0,6}(?:password|passwd|passphrase|secret|token|api-?key|pass|pwd)[ \t]+)(?!\[masked\]|-)("[^"\r\n]*"|'[^'\r\n]*'|\S+)/gi;
const BEARER = /\bBearer\s+(?!\[masked\])[A-Za-z0-9._~+/=-]{8,}/g;
const SAID = /\b(password|passcode|passphrase|pass|pwd)(\s+(?:is|was)\s+)(?!\[masked\])\S+/gi; // "my password is ..."
const URL_LOGIN = /(\b[a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/@:]+:[^\s/@]+@/gi; // https://user:password@host

function scrubPaths(text: string): string {
  let out = text.replace(FILE_URL, "");
  out = out.replace(QUOTED_PROFILE, `$1${PATH}`);
  out = out.replace(PROFILE_LINE, (_m, before: string) => `${before}${PATH}`);
  for (const re of PATHS) {
    out = out.replace(re, (_m, before: string, path: string) => `${before}${PATH}${trailingMarks(path)}`);
  }
  return out;
}

export function scrub(text: string): string {
  let out = text.replace(URL_LOGIN, `$1${MASK}@`);
  for (const re of SHAPES) out = out.replace(re, MASK);
  out = out.replace(PAIR, (_m, name: string, sep: string, scheme: string | undefined) => `${name}${sep}${scheme ?? ""}${MASK}`);
  out = out.replace(FLAG, `$1${MASK}`);
  out = out.replace(BEARER, `Bearer ${MASK}`);
  out = out.replace(SAID, `$1$2${MASK}`);
  return scrubPaths(out);
}
