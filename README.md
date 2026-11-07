# 🎳 Swing Bowl (+ ⛳ Golf, ⚾ Home Run Derby)

Wii-style motion bowling that runs in the browser. A laptop or TV shows the lane, and each player's **iPhone (or Android phone) becomes the controller**: hold the button, swing your arm, let go. Nothing to install.

**Play:** https://sst47.github.io/swing-bowl/

- ⛳ **Swing Golf:** https://sst47.github.io/swing-bowl/golf/ (3 holes, 8 clubs, wind, water, bunkers, sloped greens).
- ⚾ **Home Run Derby:** https://sst47.github.io/swing-bowl/baseball/ (10 swings each; timing decides pull vs. opposite field).

All three work the same way: open the game on a laptop/TV, scan the QR code with each phone, swing the phone.

## Modes

| Page | What it's for |
| --- | --- |
| `tv.html` | The big screen. Shows the lane, the scoreboard and a QR code/room code for phones to join. Up to 6 players. Also playable with the keyboard. |
| `controller.html` | The phone controller. Reads the gyroscope and sends throws to the big screen. |
| `solo.html` | One phone is both the controller and the screen. |

## How a throw works

- **Position:** ◀ ▶ to move along the foul line. There are no aim buttons; direction comes only from your swing.
- **Power:** while you hold the button, the phone samples `DeviceMotionEvent.rotationRate`. Release speed comes from the peak rotation rate in the last 0.6 s before you let go. It doesn't depend on orientation, so any grip works.
- **Hook:** wrist twist around the phone's long axis (`rotationRate.gamma`) in the last 0.35 s, integrated into degrees. It has a dead zone, and lefties can flip its sign in settings.
- **Direction:** the swing plane of the forward swing is compared with the backswing's in world coordinates. Swing straight back and through for a straight ball, or pull across your body to send it left or right (*Swing sensitivity*: low/normal/high, plus a flip option). This uses the fused `deviceorientation` stream converted to rotation matrices, not raw gyro axes, and removes wrist twist first, so hooking the ball doesn't change its direction.
- **Fallback:** if there are no motion sensors (desktop browser, permission denied), the button switches to "hold to charge, slide to spin".

Keyboard on the big screen: `←` `→` move · `Q` `E` spin · hold `Space` for power · `N` new game · `M` mute.

## Golf and baseball

- **Impact mode:** in golf and baseball you hold the button through the whole swing. The hit fires by itself at the fastest point of the swing (`SwingDetector.watchImpact`), so there's no release to time.
- **Golf:** swing speed → distance for the chosen club (◀ ▶ on the phone; the best club is pre-selected). Swing path vs. backswing → push/pull, wrist roll → draw/fade. Putts use a softer threshold. Ball flight has drag, lift, sidespin and wind. Each surface has its own bounce and roll, and greens are sloped. Farthest from the hole plays next. Water/OOB costs one stroke and replays from the same spot. Max 5 over par per hole.
- **Baseball:** the pitcher throws fastballs, changeups, curves and sliders. The phone timestamps the swing and converts it to the big screen's clock (round-trip clock sync over the relay), so network delay doesn't spoil the timing. ±130 ms from the plate is contact: early pulls, late goes the other way. Bat speed and timing quality set exit velocity and launch angle. Fence 100 m down the lines, 122 m to centre.

## How the phone talks to the screen

The pages are fully static, with no server of our own. Phones and the big screen exchange small JSON messages through **free public MQTT brokers over secure WebSockets** ([EMQX](https://www.emqx.com/en/mqtt/public-mqtt5-broker), [HiveMQ](https://www.hivemq.com/mqtt/public-mqtt-broker/), [Mosquitto](https://test.mosquitto.org/)), using [MQTT.js](https://github.com/mqttjs/MQTT.js). Each room code gets its own topic (`swingbowl/v1/<ROOM>/…`). The screen listens on all the brokers at once, and each phone uses the first one it can reach.

Why a relay rather than a direct peer-to-peer (WebRTC) link? WebRTC often fails between a phone and a laptop: routers without NAT hairpinning, VPNs, phones on cellular. With no relay to fall back on, it just times out. A WebSocket relay works on any network that can load a web page. A throw is a single message, so the extra ~50–150 ms is unnoticeable in bowling.

Notes:
- Public brokers are shared and unauthenticated. Anyone who guessed your room code's topic could read the throws. Fine for a game, but don't send anything private this way.
- iOS only exposes motion sensors over **HTTPS** and after a tap (`DeviceMotionEvent.requestPermission()`). GitHub Pages provides the HTTPS.

## Run locally

```bash
python3 -m http.server 8000      # or: npx serve
```

Open `http://localhost:8000/tv.html` to test on the keyboard. To use a real phone as the controller, you need HTTPS. Push to GitHub Pages, or tunnel your local server, e.g. `npx localtunnel --port 8000` or `ngrok http 8000`.

## Code layout

```
js/engine.js   physics (ball, hook, pin collisions) + 10-frame scoring; no DOM, testable in Node
js/render.js   pseudo-3D canvas renderer (lane, pins, ball, follow camera)
js/game.js     game loop, turns, HUD (scoreboard, pin indicator, messages)
js/audio.js    synthesized sound effects (Web Audio, no files)
js/motion.js   swing detector (DeviceMotion → speed + spin)
js/pad.js      shared phone-controller UI logic
js/net.js      screen/phone link over public MQTT brokers (WebSockets) + clock sync
js/room.js     shared big-screen lobby/room logic (golf, baseball)
js/golf-*.js   golf course, physics, game + renderer
js/ball-*.js   baseball pitches, contact, flight, game + 3D ballpark renderer
tests/         node tests for scoring and physics
```

Run the tests with `node tests/engine.test.js`, `node tests/motion.test.js` (simulated swings, checks the direction estimate), `node tests/golf.test.js` and `node tests/baseball.test.js`.

## Ideas

- Run a private relay (or add WebRTC with a TURN server) instead of the public brokers.
- More games on the same controller: tennis (swing timing), golf (backswing length), boxing.
- Spare-pickup challenge mode and saved high scores.
