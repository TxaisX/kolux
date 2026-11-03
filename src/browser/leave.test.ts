import { expect, test } from "vitest";
import { LEAVE_URL_SHOWN, leaveAsk, leaveText } from "./leave";

test("t661 the ask names the real host, never a user name or a look-alike", () => {
  expect(leaveAsk("system", "https://kolux.app@other.example/x")?.host).toBe("other.example");
  expect(leaveAsk("system", "https://exаmple.com/")?.host).toBe("xn--exmple-4nf.com"); // Cyrillic а shown as punycode
  expect(leaveAsk("system", "http://127.0.0.1:5173/")?.host).toBe("127.0.0.1:5173");
  expect(leaveText(leaveAsk("system", "https://other.example/")!).question).toBe("Open other.example in your default browser?");
  expect(leaveText(leaveAsk("revoke", "https://localhost:8443/")!).question).toBe("Stop trusting the certificate of localhost:8443?");
});

test("t661 the bar keeps the parsed address, caps what it shows, and the confirm names the host", () => {
  const l = leaveAsk("system", "HTTPS://Other.Example/a b")!;
  expect(l.url).toBe("https://other.example/a%20b");
  expect(leaveAsk("system", "https://kolux.app:pw@other.example/x")?.url).toBe("https://other.example/x");
  expect(leaveText(l).confirm).toBe("Open other.example");
  expect(leaveText(leaveAsk("revoke", "https://localhost:8443/")!).confirm).toBe("Stop trusting localhost:8443");
  const long = leaveText(leaveAsk("system", `https://other.example/${"x".repeat(400)}`)!).shown;
  expect(long.length).toBe(LEAVE_URL_SHOWN + 1);
  expect(long.endsWith("…")).toBe(true);
});

test("t661 nothing but an http(s) address is offered", () => {
  for (const u of ["javascript:alert(1)", "file:///C:/x", "mailto:a@b.example", "kolux-chord:pick", "", "https://"]) expect(leaveAsk("system", u), u).toBeNull();
});
