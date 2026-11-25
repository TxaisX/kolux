// The empty chat (2026-11-24, the Open WebUI screen): the model's name large over a centred box, and three
// suggestion chips that fill the box and send nothing.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Suggestions, Welcome } from "./WelcomeView";
import { STARTERS, markFor } from "./welcome";

describe("suggestion chips", () => {
  it("are three, in plain words", () => {
    expect(STARTERS).toHaveLength(3);
    for (const s of STARTERS) expect(s.label + s.text).not.toMatch(/—/);
  });

  it("fill the box with the chip's text and do not send", () => {
    const onFill = vi.fn();
    const tree = Suggestions({ onFill }) as unknown as { props: { children: { props: { onClick: () => void; children: string } }[] } };
    const chips = tree.props.children;
    expect(chips).toHaveLength(3);
    chips[1].props.onClick();
    expect(onFill).toHaveBeenCalledTimes(1);
    expect(onFill).toHaveBeenCalledWith(STARTERS[1].text);
  });
});

describe("welcome head", () => {
  it("names the model large with its mark", () => {
    const out = renderToStaticMarkup(createElement(Welcome, { label: "Claude Opus 5.5", provider: "anthropic", starting: false }));
    expect(out).toContain("Claude Opus 5.5");
    expect(out).toContain("chat-welcome-title");
    expect(out).toContain("<img");
  });
  it("uses the neutral glyph for a maker with no mark, and says when it is still starting", () => {
    const out = renderToStaticMarkup(createElement(Welcome, { label: "Llama 4", provider: "meta-llama", starting: true }));
    expect(out).toContain("Llama 4");
    expect(out).not.toContain("<img");
    expect(out).toContain("Starting");
  });
  it("maps makers to the marks Kolux has", () => {
    expect(markFor("anthropic")).toBe("claude");
    expect(markFor("openai")).toBe("codex");
    expect(markFor("x-ai")).toBe("grok");
    expect(markFor("deepseek"), "no borrowed logo for a maker Kolux has no mark for").toBeNull();
  });
});
