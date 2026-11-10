# Swing Sports

Wii-style motion sports in the browser. A laptop or TV shows the game, and every player's **phone is the controller**: scan the QR code, then swing. Nothing to install.

**Play:** https://sst47.github.io/swing-sports/

| Game | Big screen | What your swing does |
| --- | --- | --- |
| 🎳 **Swing Bowl** | [`bowling/`](bowling/) | A 3D bowling alley. Hold the button, swing, let go. Swing speed sets ball speed, the swing path sets the direction, a wrist twist adds hook. |
| ⛳ **Swing Golf** | [`golf/`](golf/) | A 3D course (three.js). Pick a club, take it back, swing through: speed sets distance, path pushes or pulls the ball, wrist roll draws or fades it. Putts use a soft stroke. |
| ⚾ **Home Run Derby** | [`baseball/`](baseball/) | A 3D ballpark. No buttons while you swing. Swing when the ring closes on the pitch: early pulls, late goes the other way, bat speed sets distance. After every pitch the phone says what happened (hit, foul or miss, and how early or late). |
| 🎾 **Swing Tennis** | [`tennis/`](tennis/) | A 3D stadium court. Play each other (one on their own plays the computer; the winner stays on when others are waiting), or team up for doubles against a computer pair. Switch between the two from any phone or the big screen (**T**). Head to head, the camera changes ends every game so each player gets the view from behind themselves (**V** moves it any time). Your player runs to the ball and you swing: timing aims it (early pulls cross-court, late pushes it the other way), swing speed sets pace, a gentle swing lobs. First to 2 games. |

Up to 6 players per game. **Switch game** (on the big screen, or press **G**) moves everyone to another game mid-match: the room code and players stay the same, and every phone follows along with one tap. The big screen can also be played with the keyboard for testing, and bowling has a [one-phone solo mode](bowling/solo.html).

## How it works

### The phone controller (`js/motion.js`, `js/pad.js`)

One `SwingDetector` reads the phone's gyroscope (`devicemotion`) and fused orientation (`deviceorientation`). Each game uses one of three modes:

- **release** (bowling): hold the button, swing, let go. The throw is read from the last ~0.6 s before release.
- **impact** (golf): hold the button through the swing. The motion is split into a backswing and a forward swing along the backswing's rotation axis. The hit fires by itself at the fastest point of the *forward* swing, so a pause at the top never counts. A forward-only swing counts when the button comes up.
- **auto** (baseball, tennis): no button while you swing. Every fast rotation is a swing, timestamped at its peak; the big screen decides whether it counted. A tap on the button means "ready" (call for the pitch, toss the serve).

What gets measured:
- **Power:** peak rotation speed. It doesn't depend on orientation, so any grip works.
- **Spin / curve:** wrist twist around the phone's long axis near the peak.
- **Direction:** the forward swing's plane compared with the backswing's, in world coordinates from the orientation stream. Wrist twist is removed first, so a hook doesn't change direction.

iOS only exposes motion sensors over HTTPS and after a tap (`DeviceMotionEvent.requestPermission()`); GitHub Pages provides the HTTPS. After you type a name, the pages clear the input history, so swinging can't trigger iOS "Shake to Undo". If there are no sensors (or motion access was denied), the controller falls back to taps: "hold to charge, release" for bowling and golf, and in baseball and tennis one tap calls for the pitch or tosses the serve and the next tap is the swing.

### Phone ↔ screen link (`js/net.js`, `js/room.js`)

The site is fully static. Phones and the big screen exchange small JSON messages through free public MQTT brokers over secure WebSockets (EMQX, HiveMQ, Mosquitto) using MQTT.js. Each game and room code gets its own topic. The screen listens on all brokers, and each phone uses the first one it can reach. This works on any network that can load a web page. Direct WebRTC was tried first, but it often fails between a phone and a laptop.

For baseball and tennis, the phone and screen keep their clocks in sync with round trips. The swing moment is sent on the screen's clock, so relay delay doesn't spoil the timing. The screen also learns and removes each player's systematic lag, such as TV display delay, and waits a moment for a late message before calling a miss.

The host can remove players (✕ on a player in **Players / QR**). A removed phone can only come back by tapping "Join again".

**Switching games** (`js/room.js`, `js/pad.js`): the big screen tells every phone `{ t: 'switch', game, room }`, saves the roster (names and phone ids, in order) for the next page, and opens the new game with the same room code. Each phone opens that game's controller and rejoins straight into its old slot after one tap (phones need a tap before they share motion data).

Public brokers are shared and unauthenticated. That's fine for game moves, but don't send anything private this way.

### Games

- `js/three-kit.js`: shared 3D pieces: the jointed player figure and its pose blending, painted canvas textures, grass shading, confetti and fireworks.
- `js/engine.js`, `js/game.js`: bowling physics (ball, hook, pin collisions) and 10-frame scoring.
- `js/bowl3d.js`: the 3D alley: glossy lanes with real reflections, neon signs and lighting, five lanes of pins, an animated bowler (approach, backswing, slide, follow-through), a rolling ball, chase and pin-deck cameras, and confetti for strikes and spares. `js/render.js` is the 2D fallback when WebGL isn't available.
- `js/golf-engine.js`: course data, surfaces, ball flight (drag, lift, sidespin, wind), roll, putting, clubs calibrated to target distances.
- `js/golf-game.js`: golf turns (farthest from the hole plays next), penalties, scorecard and the 2D minimap. Under trees, the aim swings to the nearest clear line out.
- `js/golf3d.js`: the 3D course: a physically based sky with image-based lighting, soft shadows, a painted mown-grass course with close-up grass detail, a water shader, instanced forests, mountains, clouds, an animated golfer, chase and landing cameras, hole flyovers and a Wii-style putting grid.
- `js/ball-engine.js`, `js/ball-game.js`: baseball pitches (fastball, changeup, curve, slider), timing-based contact, ball flight, the derby rules and HUD.
- `js/tennis-engine.js`: the court, ball flight with topspin, slice and bounce, net cords, shot solving, the hit point after the bounce, swing judging (timing steers and sprays the shot; a stretch or a fast incoming ball adds pressure; first serves go for the lines, second serves play safe) and tennis scoring with deuce and advantage.
- `js/tennis-game.js`: the match: singles or doubles (partners split the court, serves rotate between them, balls down the middle cause a moment's hesitation), serve and toss, rallies, faults and lets, players running to the ball (with a reaction delay and a reach limit, so angled shots can be winners), the computer (aims for the open court, defends when stretched, attacks short balls), the queue (winner stays on; teams rotate a partner), changing ends, and the HUD.
- `js/tennis3d.js`: the 3D stadium: hard court, net with tape and posts, stands all round with an instanced crowd that cheers, umpire's chair, scoreboards, two or four animated players with rackets (forehand, backhand, serve, celebrations), ball trail and shadow, a timing ring, and a broadcast camera that swings over the side of the court when it changes ends.
- `js/ball3d.js`: the 3D ballpark at night: light towers, a cheering crowd, a scoreboard, a pitcher with a full windup and leg kick, a batter who loads, swings and follows through, fielders who chase the ball, a broadcast-style camera for hits, and fireworks for home runs.
- `vendor/three/`: three.js r170 with its Sky and Reflector add-ons (MIT, see `vendor/three/LICENSE`).

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
node tests/tennis.test.js     # shot solving, hit points, in-court rates by timing, serves, scoring
```
