# Standstill

A mobile first-person shooter where the clock only runs while you do.

Stand still and the room nearly freezes: bullets hang in the air with their streaks behind
them, and you have all the time you want to read the situation. Every step, turn and shot
lets time run again, for you and for everything trying to hit you.

## What is in the game

- **Campaign:** 15 hand-built levels in three chapters (Cold Start, Undertow, Afterimage),
  each chapter with its own colour scheme. Levels run forward: you start at one end,
  everything hostile is ahead of you, and the way leads (sometimes round a corner) to an
  exit that opens once the level is clear. Levels unlock in order.
- **Fair fire:** hostiles wait where they are placed and wake when they can see you. They
  only open fire while they are in your view. Every hostile bullet draws the line it will
  travel, every shot has some aim error, and markers round the crosshair point at any
  threat that is outside your view.
- **Five hostiles:** gunners, rushers that charge, drones overhead, spreaders that fire
  fans of five, and snipers that paint a line on you before firing down it. Ground
  hostiles find their way round walls and through doors.
- **Medals:** up to three per level, for clearing it, for letting less time pass than the
  par (measured on the in-game clock), and for 60% accuracy.
- **Chips and the Armory:** clearing levels and earning medals pays chips. Chips buy two
  more weapons (Repeater, Scatter) and three upgrades (Deep Still, Quick Hands, Second
  Chance).
- **Endless:** unlocks after level 1-5. Waves keep appearing in front of you; your best
  wave is saved.
- **Rules of the clock:** walking runs it at full speed, turning nudges it, each shot costs
  a short burst. One hit ends the attempt for either side. Your weapon readies on the world
  clock, so you have to move to shoot again. You can shoot bullets out of the air.

Progress is saved in the browser (`localStorage`), per device.

## Play

It is a static site with no build step. Serve the folder and open it on a phone
(landscape is best):

```sh
python3 -m http.server 8000
# then open http://<your-computer>:8000 on the phone
```

Any static host works (GitHub Pages, Netlify, and so on). Served over https it can be
installed to the home screen and played offline (`manifest.webmanifest`, `sw.js`). Opening
`index.html` straight from disk does not work, because browsers block model loading from
`file://`.

| | Phone | Desktop |
|---|---|---|
| Move | left thumb (floating stick) | WASD |
| Aim | right thumb, or drag on FIRE | mouse |
| Shoot | hold FIRE | hold left click or Space |
| Pause | II | P or Esc |
| Retry after a hit | Retry | Space, Enter or R |

## Adding levels

Levels are text maps in `levels.js`; the legend is at the top of that file. A level is a
name, a one-line tip and a map with a start `P`, an exit `E` and hostiles placed ahead:

```js
{ name: 'Doorway', tip: 'Step into the door, fire, step back.',
  map: [
    '#######',
    '#..E..#',
    '#g....#',
    '#....g#',
    '###.###',
    '#..=..#',
    '#..P..#',
    '#######' ] }
```

Run `node tools/check-levels.js` after editing. It checks that every level is sealed, has
one start and one exit, and that every hostile and the exit can be reached. Par is worked
out from the number of hostiles and the walk to the exit unless the level sets `par`.
Optional reinforcement waves (`waves: ['rr']` with numbered doors in the map) only ever
come through a door that is in front of the player.

## How it is built

- `index.html`: page shell, HUD and all menu screens (plain HTML and CSS)
- `levels.js`: campaign content
- `game.js`: engine (rendering, the clock, room building, pathfinding, enemies, input,
  audio), progression (save data, medals, armory) and screen logic
- `vendor/`: three.js r128 and its GLTF loader, vendored so the game runs offline
- `assets/`: models, a shadow sprite, icons and sounds. Models are glTF stored as `.json`
  (binary buffer embedded) so any static host serves them; `tools/glb-to-json.js` converts
  a `.glb`.

The look is flat fills with three hard shading steps and thin edge lines on a dark ground.
Models are stripped of their textures and recoloured in `game.js`. The room dims and cools
while the clock crawls; hostiles and bullets are left out of that so they stay readable.

## What it still needs before it is sold

This is a playable vertical slice, not a finished product. Known gaps:

- **Playtesting and balance.** Par times, enemy counts and prices are first guesses. They
  have been run by an automated bot, not tuned by people playing on phones.
- **Its own art and sound.** The models and effects are from free Kenney starter kits that
  many other games also use. A game that sells needs characters, weapons, music and a
  store icon of its own.
- **Store packaging.** For Google Play or the App Store the web build has to be wrapped
  (for example with Capacitor, or a Trusted Web Activity on Android), signed, and given
  store listings, screenshots and a privacy policy.
- **A business model.** There are no ads, purchases or analytics in the code.
- **More content.** Fifteen short levels is roughly an hour of play.

## Credits

- Models and sounds from [Kenney](https://kenney.nl)'s Starter Kit FPS and Starter Kit 3D
  Platformer (MIT licensed, see `assets/LICENSE-kenney.md`). Sounds were converted from
  Ogg to MP3 so they play on iOS.
- [three.js](https://threejs.org) r128 (MIT licensed, see `vendor/LICENSE-three.txt`).
