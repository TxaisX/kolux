---
name: video
description: Make a product film, demo clip, title card or image with HyperFrames and Higgsfield.
---

# Making video and images

Use this when the request is a film, a demo clip, a promo, an animated title, a chart hit,
a social cut, or a generated image asset. The default is a hybrid: real product UI rendered
by HyperFrames, with Higgsfield filling the few assets the UI cannot provide.

## The three engines

- **HyperFrames** renders real HTML to video. Use it for every screen, label, chart, caption
  and transition. It is deterministic, so what you check is what renders. `npx hyperframes`
  works without a global install (Node 22+ and FFmpeg are required).
- **Higgsfield** generates images, video shots and audio. Use it for a hero backdrop, a texture,
  a soundtrack or a shot with a person or a place. Use the CLI once `npm install -g @higgsfield/cli`
  and `higgsfield auth login` have run on this machine, or the remote MCP endpoint in
  `references/higgsfield.md`.
- **The real app** is the best source of product UI. Capture the running app, or build a small
  HTML demo and screenshot it with Playwright. Never let an image model draw the product UI:
  its text and interface details are unreliable, and a wrong label ruins the film.

## The pipeline

1. **Write the brief.** Length, aspect, audience, the one sentence promise, and six beats for
   30 seconds. A 30 second film is six beats of about five seconds, not thirty ideas.
2. **Collect the product.** Screenshots of the real states: the grid working, the Board needing
   you, the composer focused. Crop to what the beat needs.
3. **Scaffold.** `npx hyperframes init <dir>`; read `npx hyperframes docs` and the installed
   skill (`npx hyperframes skills update` if the CLI says it is stale).
4. **Generate only what is missing.** A hero backdrop with `gpt_image_2`, a soundtrack with
   `sonilo_music`, a sound effect with `seed_audio`, a live-action shot with `seedance_2_0`.
   Download every result into the project's `assets/` folder. Do not hotlink.
5. **Build the composition.** One paused GSAP timeline, one root `data-duration`, clips with
   `data-start` and `data-duration`. Real UI frames are `<img>` layers; generated backdrops sit
   behind them. Add the music as a direct child of the root.
6. **Check, then look.** `npx hyperframes lint`, `npx hyperframes check --json`, then
   `npx hyperframes snapshot --at 1,5,10,15,20,25,29` and actually read every PNG. Fix the
   frames before rendering.
7. **Render and verify.** `npx hyperframes render --quality looks --output out.mp4`; confirm
   with `ffprobe` that the duration is the length you asked for. Keep the source HTML and the
   assets beside the MP4 so the film can be changed later.

## The 30 second shape

| Time | Beat | What is on screen |
|---|---|---|
| 0-3s | Hook | One line, one object, one pulse. No logo yet. |
| 3-8s | Problem | The cost of doing it the old way, shown, not explained. |
| 8-15s | Product | The real UI doing the thing. Let the product be legible. |
| 15-22s | Proof | A number, a before/after, a Board card, a finished run. |
| 22-27s | Payoff | The emotional result, one sentence. |
| 27-30s | End card | Product name and one line. Nothing else. |

## Rules that save a render

- Real UI beats generated UI. If a label, menu or number matters, build it in HTML.
- Keep text out of generated images. Add all type in HyperFrames.
- One idea per beat, and a visual change at least every five seconds.
- Music first, then cut. Pick the track before timing the cuts.
- 16:9 for YouTube and embeds, 9:16 for Shorts and Reels, 1:1 for feeds.
- No `repeat: -1`, no `Date.now()`, no `Math.random()`, no network calls at render time.
- Animate transform and opacity, not layout. Preload every asset; the render has no waiting.
- Check the first frame, the last frame, and every text-heavy frame at full size.
- End on the name and one line. A feature list is not an ending.

## References

`kolux skills get video --references` lists them.

- `hyperframes`: the composition contract, commands and a minimal skeleton.
- `higgsfield`: models, commands, the MCP endpoint and prompt rules.
