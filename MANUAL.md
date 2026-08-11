# LK-Tronics Music Player Manual

## Start the application

For the desktop version, open the installed **Lk-Tronics Music player** application. For development, run:

```powershell
npm start
```

Then open the local URL shown in the terminal (normally `http://localhost:3034`). Alternatively, use `npm run electron:start` to open the desktop window.

## Dashboard controls

### Door status and test

- **Door: Idle / Opened** displays the most recent door event. The opened display returns to idle after five seconds.
- **ESP32: Offline / Online** is the Socket.IO connection indicator used by compatible Socket.IO ESP32 clients.
- **Trigger Door Open** tests the greeting immediately. Use it to check the welcome sound, browser/app audio, and current volume without activating the PIR sensor.
- **Live Event Log** shows the latest door-open events. Select **Clear** to clear only the current displayed log.

### YouTube playlist player

1. Paste a YouTube playlist URL or playlist ID into **Paste YouTube Playlist URL or ID**.
2. Select **Load**.
3. Use play/pause, previous/next, shuffle, repeat, stop, seek, mute, and volume controls as needed.
4. The playlist is saved automatically, along with the selected video, playback position, and volume. Saved playlists can be selected again or deleted from the list.

The app needs an internet connection to load and play YouTube content. The selected playlist volume is reduced while a welcome sound plays and restored afterwards.

### Welcome sound settings

- **Upload New Welcome MP3** uploads an audio file. The first uploaded sound becomes active automatically.
- Use the speaker button to preview a sound.
- Use the check button to make a sound active.
- Use the trash button to delete a sound. If the active sound is deleted, the application uses the bundled default `welcome.mp3`.
- **Play again after (seconds)** controls the cooldown between physical PIR events. It accepts 0–3600 seconds and defaults to 90 seconds. Select **Set Delay** after changing it.

The cooldown is stored in the dashboard's local browser/app storage, so set it on the computer that runs the dashboard. The manual **Trigger Door Open** control bypasses this cooldown.

## ESP32 setup

Open the two sketches in Arduino IDE:

- `esp32/SmartDoor.ino` — sender with PIR sensor and LED.
- `esp32/BuzzerReceiver.ino` — receiver with buzzer.

Install/select an ESP32 board definition, connect one board at a time by USB, select its serial port, and upload the appropriate sketch.

### Wiring

| Board | Connect | Current GPIO |
| --- | --- | --- |
| Sender ESP32 | PIR sensor output | GPIO 4 |
| Sender ESP32 | LED (with suitable resistor) | GPIO 2 |
| Receiver ESP32 | Active buzzer signal | GPIO 5 |
| Both boards | Sensor/buzzer ground | GND |

Power the PIR sensor and buzzer according to their voltage requirements. Ensure all components connected to one board share ground.

## Change Wi-Fi and server IP

In **both** ESP32 sketches, update these values near the top:

```cpp
const char* ssid = "YOUR_2.4_GHZ_WIFI_NAME";
const char* password = "YOUR_WIFI_PASSWORD";
```

In `esp32/SmartDoor.ino`, update the computer's LAN address and port:

```cpp
const char* serverUrl = "http://192.168.X.X:3034/door-event";
```

Use the IPv4 address of the computer running the app, not `localhost`: the ESP32 cannot use the computer's localhost address. On Windows, find it with:

```powershell
ipconfig
```

Use the IPv4 address shown for the Wi-Fi adapter. Give the computer a DHCP reservation/static LAN IP if possible, so the sender does not need updating later. Allow Node.js/the application through Windows Firewall on the selected private network if the ESP32 cannot reach it.

If you set a custom server port, keep the port in `serverUrl` the same. The app automatically moves to the next port only when the chosen port is already in use; the ESP32 does not know that fallback port, so free the configured port or set `PORT` and `serverUrl` explicitly to matching values.

## Change the ESP-NOW receiver MAC address

`SmartDoor.ino` sends buzzer commands to this array:

```cpp
uint8_t buzzerMacAddress[] = {0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
```

Replace it with the receiver ESP32's Wi-Fi station MAC address in hexadecimal. To obtain it, temporarily add this line in the receiver's `setup()` and view Serial Monitor at 115200 baud:

```cpp
Serial.println(WiFi.macAddress());
```

For an address such as `58:2A:BD:77:51:EC`, use:

```cpp
uint8_t buzzerMacAddress[] = {0x58, 0x2A, 0xBD, 0x77, 0x51, 0xEC};
```

Both ESP32 boards must connect to the same Wi-Fi network/channel before ESP-NOW starts. After changing the MAC address, upload the sender sketch again.

## Change pins and timings

Edit the constants in the relevant sketch, then upload it again.

| Setting | File | Default | Meaning |
| --- | --- | --- | --- |
| `pirSensorPin` | `SmartDoor.ino` | `4` | PIR output GPIO |
| `ledPin` | `SmartDoor.ino` | `2` | Motion LED GPIO |
| `debounceMs` | `SmartDoor.ino` | `250` | Motion state-change debounce |
| `buzzerPin` | `BuzzerReceiver.ino` | `5` | Buzzer GPIO |
| `buzzerDurationMs` | `BuzzerReceiver.ino` | `1000` | Buzzer-on duration in milliseconds |

## Troubleshooting

- **Dashboard works but motion does not appear:** check that the sender ESP32 has joined Wi-Fi, the server IP is correct, and the computer firewall permits the port.
- **Buzzer does not sound:** verify the receiver MAC address in the sender sketch, Wi-Fi channel/network on both boards, buzzer wiring, and the receiver Serial Monitor output.
- **No welcome sound:** test with **Trigger Door Open**, check system volume, and select or upload a valid audio file. The Electron app permits automatic event-driven playback.
- **ESP32 indicator remains Offline:** the included `SmartDoor.ino` reports door events through HTTP. The UI's Online badge specifically expects an ESP32 Socket.IO client, so an HTTP event can work even if that badge remains Offline.
- **YouTube playlist does not load:** check the playlist URL/ID, internet access, and whether the playlist is playable/available from the current device.
