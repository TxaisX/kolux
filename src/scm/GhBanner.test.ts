import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import GhBanner from "./GhBanner";

test("GIT-028: a signed-out failure renders the sign-in steps; a rate limit says unavailable; another error renders nothing", () => {
  const signedOut = renderToString(createElement(GhBanner, { error: "github.com: Sign in to GitHub first: run gh auth login", host: "github.com" }));
  expect(signedOut).toContain("Sign in to GitHub");
  expect(signedOut).toContain("Run: gh auth login");
  expect(signedOut).toContain('data-gh-banner="signed-out"');
  const limited = renderToString(createElement(GhBanner, { error: "API rate limit exceeded for user ID 1." }));
  expect(limited).toContain("GitHub is unavailable for now");
  expect(limited).toContain("press Refresh");
  expect(renderToString(createElement(GhBanner, { error: "something odd" }))).toBe("");
  expect(renderToString(createElement(GhBanner, { error: "something odd", signedIn: false }))).toContain("Sign in to GitHub");
  expect(renderToString(createElement(GhBanner, { error: "gh did not answer within 30 seconds; try again in a moment" }))).toContain("taking too long");
});
