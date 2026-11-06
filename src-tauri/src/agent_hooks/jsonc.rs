//! T-122 (STAT-019): a comment-keeping edit of a commented JSON file (JSON with `//` and `/* */`
//! comments and trailing commas), with no parser dependency. Kolux's own text goes in as blocks
//! opened and closed by marker comments, right after an opening brace or bracket; every other byte
//! of the file stays as it was, and taking the blocks out gives the file back byte for byte.

use serde_json::Value;

/// The comment lines around each of Kolux's blocks.
pub const BEGIN: &str = "// >>> kolux-rs status hooks (written by Kolux; Kolux takes this block out when its hooks go) >>>";
pub const END: &str = "// <<< kolux-rs status hooks <<<";

/// One parsed value: where it starts (its first byte).
#[derive(Debug)]
pub struct Node {
    pub start: usize,
    pub kind: Kind,
}

#[derive(Debug)]
pub enum Kind {
    /// The members in file order: key and value.
    Object(Vec<(String, Node)>),
    /// How many items the list holds.
    Array(usize),
    Other,
}

impl Node {
    /// The last member named `key` (the one a JSON reader keeps).
    pub fn member(&self, key: &str) -> Option<&Node> {
        match &self.kind {
            Kind::Object(m) => m.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn is_empty(&self) -> bool {
        match &self.kind {
            Kind::Object(m) => m.is_empty(),
            Kind::Array(n) => *n == 0,
            Kind::Other => true,
        }
    }
}

/// A parsed file: the root value, its comments and the trailing commas (byte ranges).
pub struct Doc {
    pub root: Node,
    pub comments: Vec<(usize, usize)>,
    pub trailing: Vec<usize>,
}

struct P<'a> {
    b: &'a [u8],
    i: usize,
    comments: Vec<(usize, usize)>,
    trailing: Vec<usize>,
}

impl P<'_> {
    fn err<T>(&self, what: &str) -> Result<T, String> {
        Err(format!("{what} at byte {}", self.i))
    }

    fn skip(&mut self) -> Result<(), String> {
        loop {
            match self.b.get(self.i) {
                Some(b' ' | b'\t' | b'\r' | b'\n') => self.i += 1,
                Some(b'/') if self.b.get(self.i + 1) == Some(&b'/') => {
                    let s = self.i;
                    while self.b.get(self.i).is_some_and(|c| *c != b'\n') {
                        self.i += 1;
                    }
                    // A line comment ends before its line break (and before a CR of a CRLF).
                    let e = if self.i > s && self.b[self.i - 1] == b'\r' { self.i - 1 } else { self.i };
                    self.comments.push((s, e));
                }
                Some(b'/') if self.b.get(self.i + 1) == Some(&b'*') => {
                    let s = self.i;
                    self.i += 2;
                    loop {
                        match self.b.get(self.i) {
                            None => return self.err("unclosed comment"),
                            Some(b'*') if self.b.get(self.i + 1) == Some(&b'/') => {
                                self.i += 2;
                                break;
                            }
                            _ => self.i += 1,
                        }
                    }
                    self.comments.push((s, self.i));
                }
                // A byte order mark at the very start reads as nothing.
                Some(0xEF) if self.i == 0 && self.b.starts_with(&[0xEF, 0xBB, 0xBF]) => self.i += 3,
                _ => return Ok(()),
            }
        }
    }

    fn string(&mut self) -> Result<String, String> {
        let s = self.i;
        self.i += 1;
        loop {
            match self.b.get(self.i) {
                None => return self.err("unclosed string"),
                Some(b'\\') => self.i += 2,
                Some(b'"') => {
                    self.i += 1;
                    break;
                }
                _ => self.i += 1,
            }
        }
        let raw = std::str::from_utf8(&self.b[s..self.i]).map_err(|e| e.to_string())?;
        serde_json::from_str::<String>(raw).map_err(|e| format!("bad string at byte {s} ({e})"))
    }

    fn value(&mut self) -> Result<Node, String> {
        self.skip()?;
        let start = self.i;
        match self.b.get(self.i) {
            Some(b'{') => {
                self.i += 1;
                let mut members = Vec::new();
                loop {
                    self.skip()?;
                    match self.b.get(self.i) {
                        Some(b'}') => {
                            self.i += 1;
                            break;
                        }
                        Some(b'"') => {}
                        _ => return self.err("expected a key or }"),
                    }
                    let key = self.string()?;
                    self.skip()?;
                    if self.b.get(self.i) != Some(&b':') {
                        return self.err("expected :");
                    }
                    self.i += 1;
                    let v = self.value()?;
                    members.push((key, v));
                    self.skip()?;
                    match self.b.get(self.i) {
                        Some(b',') => {
                            let comma = self.i;
                            self.i += 1;
                            self.skip()?;
                            if self.b.get(self.i) == Some(&b'}') {
                                self.trailing.push(comma);
                            }
                        }
                        Some(b'}') => {}
                        _ => return self.err("expected , or }"),
                    }
                }
                Ok(Node { start, kind: Kind::Object(members) })
            }
            Some(b'[') => {
                self.i += 1;
                let mut n = 0;
                loop {
                    self.skip()?;
                    if self.b.get(self.i) == Some(&b']') {
                        self.i += 1;
                        break;
                    }
                    self.value()?;
                    n += 1;
                    self.skip()?;
                    match self.b.get(self.i) {
                        Some(b',') => {
                            let comma = self.i;
                            self.i += 1;
                            self.skip()?;
                            if self.b.get(self.i) == Some(&b']') {
                                self.trailing.push(comma);
                            }
                        }
                        Some(b']') => {}
                        _ => return self.err("expected , or ]"),
                    }
                }
                Ok(Node { start, kind: Kind::Array(n) })
            }
            Some(b'"') => {
                self.string()?;
                Ok(Node { start, kind: Kind::Other })
            }
            Some(c) if c.is_ascii_alphanumeric() || *c == b'-' => {
                while self.b.get(self.i).is_some_and(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'+' | b'.')) {
                    self.i += 1;
                }
                Ok(Node { start, kind: Kind::Other })
            }
            _ => self.err("expected a value"),
        }
    }
}

/// Parses `text`; an error names the byte where reading stopped.
pub fn parse(text: &str) -> Result<Doc, String> {
    let mut p = P { b: text.as_bytes(), i: 0, comments: Vec::new(), trailing: Vec::new() };
    let root = p.value()?;
    p.skip()?;
    if p.i != p.b.len() {
        return p.err("text after the end");
    }
    Ok(Doc { root, comments: p.comments, trailing: p.trailing })
}

/// `text` as plain JSON: comments and trailing commas blanked out, every other byte kept.
pub fn to_value(text: &str) -> Result<Value, String> {
    let doc = parse(text)?;
    let mut b = text.as_bytes().to_vec();
    for &(s, e) in &doc.comments {
        for c in &mut b[s..e] {
            if *c != b'\n' && *c != b'\r' {
                *c = b' ';
            }
        }
    }
    for &t in &doc.trailing {
        b[t] = b' ';
    }
    let start = if b.starts_with(&[0xEF, 0xBB, 0xBF]) { 3 } else { 0 };
    serde_json::from_slice(&b[start..]).map_err(|e| e.to_string())
}

/// The byte spans of Kolux's blocks in `text`: from the line break before the begin marker through
/// the line break after the end marker. A begin marker with no end marker is an error.
pub fn blocks(text: &str) -> Result<Vec<(usize, usize)>, String> {
    let doc = parse(text)?;
    let mut out = Vec::new();
    let mut open: Option<usize> = None;
    for &(s, e) in &doc.comments {
        let c = &text[s..e];
        if c.starts_with("// >>> kolux") {
            if open.is_some() {
                return Err("a Kolux block has lost its end marker".into());
            }
            let mut a = s;
            while a > 0 && matches!(text.as_bytes()[a - 1], b' ' | b'\t') {
                a -= 1;
            }
            if text[..a].ends_with("\r\n") {
                a -= 2;
            } else if text[..a].ends_with('\n') {
                a -= 1;
            }
            open = Some(a);
        } else if c.starts_with("// <<< kolux") {
            match open.take() {
                Some(a) => {
                    // The block ends with the line break after its end marker.
                    let after = if text[e..].starts_with("\r\n") { 2 } else { usize::from(text[e..].starts_with('\n')) };
                    out.push((a, e + after));
                }
                None => return Err("a Kolux end marker has no begin marker".into()),
            }
        }
    }
    if open.is_some() {
        return Err("a Kolux block has lost its end marker".into());
    }
    Ok(out)
}

/// `text` with Kolux's blocks taken out, or `None` when it holds none.
pub fn without(text: &str) -> Result<Option<String>, String> {
    let spans = blocks(text)?;
    if spans.is_empty() {
        return Ok(None);
    }
    let mut out = text.to_string();
    for (s, e) in spans.into_iter().rev() {
        out.replace_range(s..e, "");
    }
    Ok(Some(out))
}

/// The line break the file already uses.
pub fn newline(text: &str) -> &'static str {
    if text.contains("\r\n") { "\r\n" } else { "\n" }
}

/// One block holding `content` (already JSON text), to go right after an opening brace or
/// bracket; `more` says the container already holds something, so the block ends with a comma.
pub fn block(content: &str, more: bool, indent: &str, nl: &str) -> String {
    format!("{nl}{indent}{BEGIN}{nl}{indent}{content}{}{nl}{indent}{END}{nl}", if more { "," } else { "" })
}

/// `text` with each `(offset, insert)` put in at its byte offset.
pub fn insert_all(text: &str, mut edits: Vec<(usize, String)>) -> String {
    edits.sort_by_key(|(at, _)| std::cmp::Reverse(*at));
    let mut out = text.to_string();
    for (at, s) in edits {
        out.insert_str(at, &s);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANNED: &str = "// Devin settings\r\n{\r\n  /* the model */\r\n  \"model\": \"x\", // trailing note\r\n  \"list\": [1, 2,],\r\n  \"url\": \"http://a//b /* not a comment */\",\r\n}\r\n";

    #[test]
    fn stat_019_commented_json_parses_with_comments_and_trailing_commas() {
        let doc = parse(CANNED).unwrap();
        assert_eq!(doc.comments.len(), 3, "the two // comments and the /* */ one; the ones inside the string are not comments");
        assert_eq!(doc.trailing.len(), 2);
        let v = to_value(CANNED).unwrap();
        assert_eq!(v["url"], "http://a//b /* not a comment */");
        assert_eq!(v["list"], serde_json::json!([1, 2]));
        assert!(parse("{ /* open").is_err() && parse("{\"a\": }").is_err() && parse("{} x").is_err());
    }

    #[test]
    fn stat_019_a_block_goes_in_and_comes_out_byte_for_byte() {
        let doc = parse(CANNED).unwrap();
        let at = doc.root.start + 1;
        let new = insert_all(CANNED, vec![(at, block("\"k\": 1", !doc.root.is_empty(), "  ", newline(CANNED)))]);
        assert!(new.contains("// Devin settings") && new.contains("/* the model */") && new.contains("// trailing note"));
        assert_eq!(to_value(&new).unwrap()["k"], 1);
        assert_eq!(without(&new).unwrap().as_deref(), Some(CANNED));
        assert_eq!(without(CANNED).unwrap(), None);
        let lost = new.replace(END, "// gone");
        assert!(blocks(&lost).is_err(), "a block without its end marker is never guessed at");
        let empty = "{}";
        let one = insert_all(empty, vec![(1, block("\"k\": 1", false, "  ", "\n"))]);
        assert_eq!(to_value(&one).unwrap()["k"], 1, "no comma into an empty object");
        assert_eq!(without(&one).unwrap().as_deref(), Some(empty));
    }
}
