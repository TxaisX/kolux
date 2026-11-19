import { describe, expect, it } from "vitest";
import { checkDataPicture, filterDataPictures, skippedNote } from "./notePictures";

// EDIT-009 (T-234-b): inline data pictures are size-checked.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("checkDataPicture", () => {
  it("accepts a small picture and counts its decoded bytes", () => {
    const c = checkDataPicture(PNG);
    expect(c.ok).toBe(true);
    expect(c.bytes).toBe(70);
  });
  it("refuses one over the limit, at the exact edge", () => {
    const nine = "data:image/png;base64,AAAAAAAAAAAA"; // 12 characters = 9 bytes
    expect(checkDataPicture(nine, 9)).toEqual({ ok: true, bytes: 9 });
    expect(checkDataPicture(nine, 8)).toEqual({ ok: false, why: "large", bytes: 9 });
    expect(checkDataPicture("data:image/png;base64,AAAAAAAAAA==", 100)).toEqual({ ok: true, bytes: 7 });
  });
  it("refuses a type that is not a picture, and damaged data", () => {
    expect(checkDataPicture("data:text/html;base64,PGI+")).toMatchObject({ ok: false, why: "type" });
    expect(checkDataPicture("data:image/png;base64,@@@@")).toMatchObject({ ok: false, why: "broken" });
    expect(checkDataPicture("data:image/png;base64,AAAAA")).toMatchObject({ ok: false, why: "broken" });
    expect(checkDataPicture("data:image/png;base64,")).toMatchObject({ ok: false, why: "broken" });
    expect(checkDataPicture("data:image/svg+xml,%E0%A4%A")).toMatchObject({ ok: false, why: "broken" });
  });
  it("takes an unencoded svg picture", () => {
    expect(checkDataPicture("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E").ok).toBe(true);
  });
});

describe("filterDataPictures", () => {
  it("leaves a normal page and a good picture alone", () => {
    const html = `<p>hi</p><img src="${PNG}" alt="dot"><img src="pics/a.png">`;
    expect(filterDataPictures(html)).toBe(html);
  });
  it("swaps an oversized or broken picture for a note and keeps the rest", () => {
    const html = `<p>a</p><img src="data:image/png;base64,${"A".repeat(40)}" alt="x"><p>b</p><img alt="y" src="data:image/png;base64,@@@@">`;
    const out = filterDataPictures(html, 10);
    expect(out).toContain("<p>a</p>");
    expect(out).toContain("<p>b</p>");
    expect(out).not.toContain("<img");
    expect(out.match(/md-picture-skipped/g)?.length).toBe(2);
    expect(out).toContain("is over the 0 MB a note may hold inline");
  });
  it("words each reason", () => {
    expect(skippedNote({ ok: false, why: "large", bytes: 6 * 1024 * 1024 })).toBe("Picture not shown: 6 MB is over the 4 MB a note may hold inline.");
    expect(skippedNote({ ok: false, why: "type", bytes: 0 })).toContain("not a picture type");
    expect(skippedNote({ ok: false, why: "broken", bytes: 0 })).toContain("damaged");
  });
});
