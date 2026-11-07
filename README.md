# Swing Sports

Wii-style motion sports in the browser. A laptop or TV shows the game, and every player's **phone is the controller**: scan the QR code, then swing. Nothing to install.

**Play:** https://sst47.github.io/swing-sports/

| Game | Big screen | What your swing does |
| --- | --- | --- |
| 🎳 **Swing Bowl** | [`bowling/`](bowling/) | Hold the button, swing, let go. Swing speed sets ball speed, the swing path sets the direction, a wrist twist adds hook. |
| ⛳ **Swing Golf** | [`golf/`](golf/) | A 3D course (three.js). Pick a club, take it back, swing through: speed sets distance, path pushes or pulls the ball, wrist roll draws or fades it. Putts use a soft stroke. |
| ⚾ **Home Run Derby** | [`baseball/`](baseball/) | No buttons while you swing. Swing when the ring closes on the pitch: early pulls, late goes the other way, bat speed sets distance. |

Up to 6 players per game. The big screen can also be played with the keyboard for testing, and bowling has a [one-phone solo mode](bowling/solo.html).

## How it works

### The phone controller (`js/motion.js`, `js/pad.js`)

One `SwingDetector` reads the phone's gyroscope (`devicemotion`) and fused orientation (`deviceorientation`). Each game uses one of three modes:

- **release** (bowling): hold the button, swing, let go. The throw is read from the last ~0.6 s before release.
- **impact** (golf): hold the button through the swing. The motion is split into a backswing and a forward swing along the backswing's rotation axis. The hit fires by itself at the fastest point of the *forward* swing, so a pause at the top never counts. A forward-only swing counts when the button comes up.
- **auto** (baseball): no button. The first fast rotation is the swing, timestamped at its peak, then the detector re-arms.

What gets measured:
- **Power:** peak rotation speed. It doesn't depend on orientation, so any grip works.
- **Spin / curve:** wrist twist around the phone's long axis near the peak.
- **Direction:** the forward swing's plane compared with the backswing's, in world coordinates from the orientation stream. Wrist twist is removed first, so a hook doesn't change direction.

iOS only exposes motion sensors over HTTPS and after a tap (`DeviceMotionEvent.requestPermission()`); GitHub Pages provides the HTTPS. After you type a name, the pages clear the input history, so swinging can't trigger iOS "Shake to Undo". If there are no sensors, the controller falls back to "hold to charge, release".

### Phone ↔ screen link (`js/net.js`, `js/room.js`)

The site is fully static. Phones and the big screen exchange small JSON messages through free public MQTT brokers over secure WebSockets (EMQX, HiveMQ, Mosquitto) using MQTT.js. Each game and room code gets its own topic. The screen listens on all brokers, and each phone uses the first one it can reach. This works on any network that can load a web page. Direct WebRTC was tried first, but it often fails between a phone and a laptop.

For baseball, the phone and screen keep their clocks in sync with round trips. The swing moment is sent on the screen's clock, so relay delay doesn't spoil the timing. The screen also learns and removes the room's systematic lag, such as TV display delay.

The host can remove players (✕ on a player in **Players / QR**). A removed phone can only come back by tapping "Join again".

Public brokers are shared and unauthenticated. That's fine for game moves, but don't send anything private this way.

### Games

- `js/engine.js`, `js/render.js`, `js/game.js`: bowling physics (ball, hook, pin collisions), 10-frame scoring, pseudo-3D canvas lane.
- `js/golf-engine.js`: course data, surfaces, ball flight (drag, lift, sidespin, wind), roll, putting, clubs calibrated to target distances.
- `js/golf-game.js`: golf turns (farthest from the hole plays next), penalties, scorecard and the 2D minimap.
- `js/golf3d.js`: the 3D course: a physically based sky with image-based lighting, soft shadows, a painted mown-grass course with close-up grass detail, a water shader, instanced forests, mountains, clouds, an animated golfer, chase and landing cameras, hole flyovers and a Wii-style putting grid.
- `js/ball-engine.js`, `js/ball-game.js`: baseball pitches (fastball, changeup, curve, slider), timing-based contact, ball flight, ballpark renderer, timing ring.
- `vendor/three/`: three.js r170 (MIT, see `vendor/three/LICENSE`).

## Run locally

```bash
python3 -m http.server 8000      # or: npx serve
```

Open `http://localhost:8000/` and pick a game; keyboard controls are listed in each lobby. To use a real phone as the controller you need HTTPS: push to GitHub Pages, or tunnel the local server (`npx localtunnel --port 8000`, `ngrok http 8000`).

## Tests

```bash
node tests/engine.test.js     # bowling scoring + pin physics
node tests/motion.test.js     # swing direction from simulated orientation streams
node tests/detector.test.js   # hit detection: golf swings with a pause at the top, putts, bat swings
node tests/golf.test.js       # club distances, curve, wind, putting, hazards
node tests/baseball.test.js   # flight distances and the contact model
```
