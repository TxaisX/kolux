# HyperFrames: the short contract

HyperFrames turns one HTML file into a video. The file is the timeline; a paused GSAP timeline
does the motion; the renderer seeks it frame by frame.

## Minimal composition

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; background: #0b0820; }
    #ad { position: relative; width: 1920px; height: 1080px; overflow: hidden; color: #fffaea;
          font-family: Inter, system-ui, sans-serif; }
    .scene { position: absolute; inset: 0; }
    .clip { position: absolute; inset: 0; }
    h1 { position: absolute; left: 120px; top: 380px; margin: 0; font-size: 120px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>
</head>
<body>
  <div id="ad" data-composition-id="ad" data-duration="30" data-width="1920" data-height="1080">
    <div class="clip scene" data-start="0" data-duration="6" data-track-index="0">
      <h1 id="headline">One window. Twelve agents.</h1>
    </div>
    <audio id="music" src="assets/music.mp3" data-start="0" data-duration="30" data-volume="0.8"></audio>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.from("#headline", { y: 60, opacity: 0, duration: 0.9, ease: "power3.out" }, 0.2);
    tl.to("#headline", { opacity: 0, duration: 0.4 }, 5.2);
    window.__timelines["ad"] = tl;
  </script>
</body>
</html>
```

The root is the sized box. Every clip carries `class="clip"`, `data-start`, `data-duration` and
a track. The root `data-duration` is the render length, not the timeline length. The timeline key
must equal the root `data-composition-id`.

## Commands

```bash
npx --yes hyperframes init <dir>        # blank project
npx hyperframes lint                    # structural check while writing
npx hyperframes check --json            # the gate: lint, runtime, layout, contrast
npx hyperframes snapshot --at 1,5,10    # PNGs under .hyperframes/artifacts/snapshots
npx hyperframes preview                 # live Studio preview
npx hyperframes render --quality looks --output out.mp4
npx hyperframes skills update           # refresh the full authoring skills
```

Use `--quality draft` while iterating and `--quality delivery` for the final. A 30 second film
renders in a minute or two locally. Verify with `ffprobe -show_entries format=duration`.

## Media

- Images: `<img src="assets/hero.png">`; preload before the timeline seeks.
- Video: `<video src="assets/shot.mp4">` must be a **direct child of the root**, never inside a
  scene wrapper; the framework owns playback.
- Audio: `<audio id="music" src="assets/music.mp3" data-start="0" data-duration="30">` also
  direct child. Every `<audio>` needs an `id` or it is left out of the mix (`check` reports it
  as `media_missing_id`). No `crossorigin` on any media element.
- Download every generated asset into `assets/`; never rely on a remote URL at render time.

## Determinism rules

- One `gsap.timeline({ paused: true })` per composition, built synchronously.
- No clocks, network, input state, unseeded random, or `repeat: -1`.
- Animate transform and opacity. Do not animate `display` or `visibility`; the framework owns
  clip visibility.
- No `<br>` in body text; size every transformed element.
- A full-frame background belongs on a full-bleed child (`inset: 0`), not on the root.
- Duplicate ids across sub-compositions render blank media; prefix ids per scene.

If the CLI or a check fails, read `npx hyperframes --help` and the installed
`hyperframes-core` and `hyperframes-cli` skills before improvising.
