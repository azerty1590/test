# Standstill

A mobile first-person shooter where the clock only runs while you do.

Stand still and the room nearly freezes: bullets hang in the air with their streaks behind
them, and you have all the time you want to read the situation. Every step, turn and shot
lets time run again, for you and for everything trying to hit you.

- **Time follows you.** Walking runs the clock at full speed, turning nudges it, and each
  shot costs a short burst. The gauge at the top shows the current rate.
- **One hit ends it**, for them and for you. Retry is instant and restarts the same room.
- **Your blaster readies on the world clock**, so you cannot stand still and empty it. You
  have to move to shoot again, and moving is what lets their bullets reach you.
- **Shoot bullets out of the air.** Put the crosshair on an incoming shot (the dot turns
  pink) and fire.
- Rooms get harder: gunners, rushers that charge, drones overhead, spreaders firing fans
  of five. Cover changes from room to room.

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
| Shoot | hold FIRE | hold left click or Space |
| Pause | II | P or Esc |
| Retry after a hit | Retry | Space, Enter or R |

## How it is built

- `index.html`: page shell, HUD and menus (plain HTML and CSS)
- `game.js`: the whole game (rendering, the clock, enemies, input, audio)
- `vendor/`: three.js r128 and its GLTF loader, vendored so the game runs offline
- `assets/`: models, a shadow sprite and sounds. Models are glTF stored as `.json` (binary
  buffer embedded) so any static host serves them; `tools/glb-to-json.js` converts a `.glb`.

The look is flat fills with three hard shading steps and thin edge lines on night blue.
Models are stripped of their textures and recoloured in `game.js`. The room dims and cools
while the clock crawls; hostiles and bullets are left out of that so they stay readable.

## Credits

- Models and sounds from [Kenney](https://kenney.nl)'s Starter Kit FPS and Starter Kit 3D
  Platformer (MIT licensed, see `assets/LICENSE-kenney.md`). Sounds were converted from
  Ogg to MP3 so they play on iOS.
- [three.js](https://threejs.org) r128 (MIT licensed, see `vendor/LICENSE-three.txt`).
