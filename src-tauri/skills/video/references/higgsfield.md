# Higgsfield: generated images, video and audio

Higgsfield fills the assets that real UI cannot provide: a hero backdrop, a texture, a live-action
shot, a soundtrack, a sound effect. The CLI is the reliable path for an agent. The remote MCP
endpoint is `https://mcp.higgsfield.ai/mcp` for clients that support remote MCP.

## Check access

```bash
npm install -g @higgsfield/cli   # once per machine; puts `higgsfield` on the PATH
higgsfield --version
higgsfield account status        # shows the account, plan and credits
higgsfield auth login            # only when status says not authenticated
```

## Pick a model

| Need | Model | Notes |
|---|---|---|
| Hero image, backdrop, texture, graphic still | `gpt_image_2` | 16:9 or 9:16, 2k, no text in the image |
| A live-action or cinematic shot | `seedance_2_0` | 4-15s; use a start image when identity matters |
| A presenter or UGC-style ad | `marketing_studio_video` | Avatars, products, hooks, 480p/720p |
| A 30s music bed | `sonilo_music` | `--duration 30`, prompt the arc, no vocals unless wanted |
| A sound effect or ambience | `seed_audio` | Impacts, whooshes, room tone |
| A character or stylized still | `nano_banana_2` | Reference-driven |

## Examples

```bash
higgsfield generate create gpt_image_2 \
  --prompt "wide cinematic still, dark navy control room, translucent panes floating, gold rim light, no text, no logos" \
  --aspect_ratio 16:9 --resolution 2k --wait

higgsfield generate create sonilo_music \
  --prompt "minimal tech score, 90 BPM, deep sub pulse, glassy arpeggio, builds to a wide resolved chord, no vocals" \
  --duration 30 --wait

higgsfield generate create seedance_2_0 \
  --prompt "slow dolly through a dark control room, gold light on glass, cinematic" \
  --duration 8 --resolution 1080p --wait

higgsfield generate create seed_audio \
  --prompt "soft UI whoosh, short, clean, no music" --wait
```

`--wait` blocks and prints the result URL. Download it into the project:

```bash
curl -L "<result_url>" -o assets/hero.png
```

## Prompt rules

- Describe camera, light, material and negative space. Do not describe UI labels; generate no text.
- Keep the product UI out of generated images. Real UI is rendered in HTML.
- 16:9 for film and embeds, 9:16 for vertical, 1:1 for feed. Ask for negative space where type goes.
- For music, describe the arc and the ending, not a genre list. Ask for no vocals if the film has
  type-only storytelling.
- Check the result at full size before using it. Regenerate rather than ship a wrong hand or a
  fake interface.

## Cost

The account status shows credits. A 2k hero and a 30s music bed are cheap relative to a video
shot; generate the still and the music first, then decide whether the film needs a generated shot
at all. Do not spend credits on images of UI that HyperFrames can render for free.
