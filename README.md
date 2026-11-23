# Doodle Freeze

A mobile first-person shooter drawn on a notebook page. Its one trick: you can stop time.
Every bullet hangs in the air, the doodles freeze mid-step, and you keep moving.

- **Freeze** the page, walk out of the line of fire, and line up shots. Your own shots hang
  in front of the blaster until you let time go again.
- **Send it back**: aim at a hanging red bullet and shoot it. It turns blue and flies back
  to whoever fired it.
- Clear a page of doodles to move on to the next one. Walkers shoot, rushers charge,
  drones strafe from above, spreaders fire fans of five.

## Play

It is a static site with no build step. Serve the folder and open it on a phone
(landscape is best):

```sh
python3 -m http.server 8000
# then open http://<your-computer>:8000 on the phone
```

Any static host works (GitHub Pages, Netlify, and so on). Opening `index.html` straight
from disk does not, because browsers block model loading from `file://`.

| | Phone | Desktop |
|---|---|---|
| Move | left thumb (floating stick) | WASD |
| Aim | right thumb, or drag on FIRE | mouse |
| Shoot | hold FIRE | hold left click |
| Freeze / unfreeze | FREEZE | Space or right click |
| Reload | load | R |
| Pause | II | P or Esc |

## How it is built

- `index.html`: page shell, HUD and menus (plain HTML and CSS)
- `game.js`: the whole game (rendering, time-stop, enemies, input, audio)
- `vendor/`: three.js r128 and its GLTF loader, vendored so the game runs offline
- `assets/`: models, a shadow sprite and sounds. Models are glTF stored as `.json` (binary
  buffer embedded) so any static host serves them; `tools/glb-to-json.js` converts a `.glb`.

The doodle look is done in `game.js`: toon-shaded fills, an ink outline on every model that
re-jitters a few times a second, and hand-drawn canvas textures for the graph-paper floor
and the ruled-paper sky. The outline wobble runs on world time, so the lines stop boiling
when the page is frozen.

## Credits

- Models and sounds from [Kenney](https://kenney.nl)'s Starter Kit FPS and Starter Kit 3D
  Platformer (MIT licensed, see `assets/LICENSE-kenney.md`). Sounds were converted from
  Ogg to MP3 so they play on iOS.
- [three.js](https://threejs.org) r128 (MIT licensed, see `vendor/LICENSE-three.txt`).
