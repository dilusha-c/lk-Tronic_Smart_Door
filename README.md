# LK-Tronics Music Player

LK-Tronics Music Player is a Windows desktop and web dashboard for a door-greeting system. When motion is detected at a door, an ESP32 sends a door-open event to the application. The dashboard lowers the volume of an active YouTube playlist, plays a configurable welcome sound, and records the event. A second ESP32 can sound a local buzzer through ESP-NOW at the same time.

## What the project uses

- **Node.js and Express** for the local web server and REST API.
- **Socket.IO** for real-time door status and event-log updates in the dashboard.
- **Electron** to package the dashboard as a Windows desktop application.
- **YouTube IFrame Player API** for YouTube playlist playback.
- **ESP32 (sender)** with a PIR motion sensor for motion/door detection.
- **ESP-NOW** for direct wireless communication from the sender ESP32 to the buzzer ESP32.
- **ESP32 (receiver)** with a buzzer for a one-second audible alert.
- **Multer** for uploading and managing welcome-sound files.

## Hardware

| Part | Purpose | Pin in current sketch |
| --- | --- | --- |
| ESP32 sender | Reads the motion sensor; notifies the app and buzzer | — |
| PIR motion sensor | Detects movement at the door | GPIO 4 |
| Status LED | Indicates detected motion | GPIO 2 |
| ESP32 receiver | Receives ESP-NOW commands | — |
| Active buzzer | Sounds when motion is detected | GPIO 5 |

Both ESP32 boards must join the same 2.4 GHz Wi-Fi network. ESP-NOW also requires the boards to use the same Wi-Fi channel.

## Project layout

```text
server.js                 Local Express/Socket.IO server
main.js                   Electron desktop window and local-server startup
public/                   Dashboard UI, styles, default welcome audio, icon
esp32/SmartDoor.ino       PIR sensor / door-event sender sketch
esp32/BuzzerReceiver.ino  ESP-NOW buzzer receiver sketch
uploads/                  Development-mode uploaded audio storage
playlist_cache.json       Saved YouTube playlist and playback state
```

## Run locally

Requirements: Node.js (current LTS recommended), npm, and the Arduino IDE or PlatformIO with ESP32 board support.

```powershell
npm install
npm start
```

The server normally opens on `http://localhost:3034`. If that port is busy, it automatically tries the next port.

To run the desktop application:

```powershell
npm run electron:start
```

To build a Windows installer:

```powershell
npm run dist
```

## System flow

```text
PIR sensor → Sender ESP32 → HTTP POST /door-event → Dashboard
                 └───────→ ESP-NOW → Receiver ESP32 → Buzzer
```

On a physical door event, the dashboard waits two seconds, fades the YouTube playlist to 20% of its previous volume, plays the selected welcome sound, then restores the playlist volume. The dashboard's **Trigger Door Open** button is a test action: it plays the welcome sound immediately and does not need the hardware.

## Configuration and operation

See [MANUAL.md](MANUAL.md) for UI instructions, changing the server IP/Wi-Fi/device MAC address, uploading welcome audio, and troubleshooting.

## Security note

Wi-Fi credentials and a local-network server address are currently stored directly in the ESP32 sketches. Change the example values before deploying or sharing the project, and do not commit real network passwords to a public repository.
