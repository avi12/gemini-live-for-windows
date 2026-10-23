# Gemini Live for Windows

Press **Win+C** (or the Copilot key) → Gemini Live starts listening and sees the display you were working on. Talk over it any time; pick another display from the flyout if you have several. Press Win+C again (or ×) to end.

## How it runs

- **Google account engine (default).** The real Gemini web client (`gemini.google.com/glic`, the one behind Gemini in Chrome) runs in a hidden WebView2. It owns the mic, echo cancellation, the Live connection and Gemini's voice, and it pulls screen stills from the app: a fresh one each second (the app announces the screen under a new tab id, since Glic sends one picture per tab id), each with an exact text copy of the foreground window read through UI Automation, so small text Gemini can't make out in the picture still reaches it word for word. A Live that breaks is retried with Gemini's own *Try again*, then reloaded (up to three times in ten minutes). It's signed in with **your browser's Google session**, which the companion extension pushes over `ws://127.0.0.1:8479` whenever Google rotates it. The app never rotates the cookies itself, so your browser stays the only owner of the session.
- **API key engine (fallback, gear menu).** The public Gemini Live API over a WebSocket, with Windows' echo-cancelled audio and ~1 fps JPEG screen frames.

## Setup

1. **Install the app** (one UAC prompt to trust the local signing cert the first time):
   ```powershell
   .\scripts\install.ps1
   ```
2. **Load the extension** in Edge or Chrome: open `edge://extensions` (or `chrome://extensions`), turn on **Developer mode**, click **Load unpacked**, and pick `%USERPROFILE%\.gemini-live\extension` (the app copies its WXT build there when you click *Add the browser extension*; from source: `pnpm --dir extension build` → `extension\.output\chrome-mv3`). It has a fixed ID (`logpjalpegggobmjjimpacngnnhaakmd`), and the app accepts the session only from that ID.
3. **Choose it for Win+C**: Settings › Personalization › Text input › *Customize Copilot key on keyboard* › **Gemini Live**.

Stay signed in to Google in that browser. If you sign out there, Gemini Live waits until you sign back in.

## Debugging

- Log: `%LOCALAPPDATA%\GeminiLive\log.txt` (packaged installs: the package's LocalCache).
- Create `%LOCALAPPDATA%\GeminiLive\debug.flag` to turn on DevTools and CDP on `localhost:9333` for the hidden Gemini page, and to keep the overlays visible in screenshots.
- `.\scripts\install.ps1 -Mode Register` gives an unsigned dev-mode install for fast iteration. Windows only lists signed providers in the Copilot key setting.
