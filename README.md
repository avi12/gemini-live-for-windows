# Gemini Live for Windows

Press **Win+C** (or the Copilot key) → Gemini Live starts listening and sees the display you were working on. Talk over it any time; pick another display from the flyout if you have several. Press Win+C again (or ×) to end.

## How it runs

- **Google account engine (default).** The real Gemini web client (`gemini.google.com/glic`, the one behind Gemini in Chrome) runs in a hidden WebView2. It owns the mic, echo cancellation, the Live connection and Gemini's voice, and it pulls screen stills from the app. It's signed in with **your browser's Google session**, which the companion extension pushes over `ws://127.0.0.1:8479` whenever Google rotates it. The app never rotates the cookies itself, so your browser stays the only owner of the session.
- **API key engine (fallback, gear menu).** The public Gemini Live API over a WebSocket, with Windows' echo-cancelled audio and ~1 fps JPEG screen frames.

## Setup

1. **Install the app** (one UAC prompt to trust the local signing cert the first time):
   ```powershell
   .\scripts\install.ps1
   ```
2. **Load the extension** in Edge or Chrome: open `edge://extensions` (or `chrome://extensions`), turn on **Developer mode**, click **Load unpacked**, and pick the `extension` folder. It has a fixed ID (`logpjalpegggobmjjimpacngnnhaakmd`), and the app accepts the session only from that ID.
3. **Choose it for Win+C**: Settings › Personalization › Text input › *Customize Copilot key on keyboard* › **Gemini Live**.

Stay signed in to Google in that browser. If you sign out there, Gemini Live waits until you sign back in.

## Debugging

- Log: `%LOCALAPPDATA%\GeminiLive\log.txt` (packaged installs: the package's LocalCache).
- Create `%LOCALAPPDATA%\GeminiLive\debug.flag` to turn on DevTools and CDP on `localhost:9333` for the hidden Gemini page, and to keep the overlays visible in screenshots.
- `.\scripts\install.ps1 -Mode Register` gives an unsigned dev-mode install for fast iteration. Windows only lists signed providers in the Copilot key setting.
