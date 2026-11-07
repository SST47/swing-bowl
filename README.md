# 🎳 Swing Bowl

Wii-style motion bowling that runs in the browser. A laptop or TV shows the lane, and each player's **iPhone (or Android phone) becomes the controller**: hold the button, swing your arm, let go. Nothing to install.

**Play:** https://sst47.github.io/swing-bowl/

## Modes

| Page | What it's for |
| --- | --- |
| `tv.html` | The big screen. Shows the lane, the scoreboard and a QR code/room code for phones to join. Up to 6 players. Also playable with the keyboard. |
| `controller.html` | The phone controller. Reads the gyroscope and sends throws to the big screen. |
| `solo.html` | One phone is both the controller and the screen. |

## How a throw works

- **Position / aim:** ◀ ▶ to move along the foul line, ↖ ↗ to angle the throw.
- **Power:** while you hold the button, the phone samples `DeviceMotionEvent.rotationRate`. Release speed comes from the peak rotation rate in the last 0.6 s before you let go. It doesn't depend on orientation, so any grip works.
- **Hook:** wrist twist around the phone's long axis (`rotationRate.gamma`) in the last 0.35 s, integrated into degrees. It has a dead zone, and lefties can flip its sign in settings.
- **Fallback:** if there are no motion sensors (desktop browser, permission denied), the button switches to "hold to charge, slide to spin".

Keyboard on the big screen: `←` `→` move · `↑` `↓` aim · `Q` `E` spin · hold `Space` for power · `N` new game · `M` mute.

## How the phone talks to the screen

The pages are fully static, with no server of our own. Phones connect to the big screen **peer-to-peer over WebRTC** using [PeerJS](https://peerjs.com/). The screen registers a room like `swingbowl-v1-KQTZ` on PeerJS's free public signalling server. Once the handshake is done, throws go directly between devices.

Notes:
- Both devices need internet access for the handshake. The same Wi-Fi network gives the lowest latency.
- Some strict networks (corporate or hotel Wi-Fi, some cellular) block peer-to-peer connections. There's no TURN relay configured. See *Ideas* below.
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
js/net.js      PeerJS host/client wrapper
tests/         node tests for scoring and physics
```

Run the tests with `node tests/engine.test.js`.

## Ideas

- Add a TURN server (or a tiny WebSocket relay) for networks that block WebRTC.
- More games on the same controller: tennis (swing timing), golf (backswing length), boxing.
- Spare-pickup challenge mode and saved high scores.
