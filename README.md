# Gemini Live for Windows

Press **Win+C** (or the Copilot key) and Gemini Live starts listening and sees the display you were working on. Talk over it any time, pick another display (or your webcam) from the flyout, and press Win+C again (or ×) to end.

Created by [Avi](https://avi12.com).

![The Gemini Live pill above the taskbar, listening](https://github.com/user-attachments/assets/351a125b-061b-47f5-931e-a8cbb5196957)

## Demonstration

https://github.com/user-attachments/assets/46c1a0e1-f0db-4c0c-8835-ba38f46a29fb

> [!WARNING]
> By default, Gemini Live rides your Gemini subscription through Google's own web client, which Google doesn't offer for this use. **Google may suspend or ban an account that uses it.** If you'd rather not risk your account, switch to [your own Gemini API key](#use-your-own-api-key-instead) - the official, public Live API.

## Requirements

- Windows 11 23H2 or newer, up to date, so it has the **Customize Copilot key on keyboard** setting that lets you choose what Win+C opens
- A Chromium browser (Chrome, Edge, Brave…) that can sideload an extension in Developer mode, signed in to the Google account you use Gemini with

## Install

Download the files from the [latest release](https://github.com/avi12/gemini-live-for-windows/releases/latest).

### The app

1. Put `GeminiLive-<version>.msix`, `GeminiLive.cer` and `Install-GeminiLive.ps1` in one folder.
2. In that folder, run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\Install-GeminiLive.ps1
   ```
   The release is signed with a self-signed certificate, so the first install asks once (UAC) to trust it. Later versions install over it and keep your microphone permission.
3. **Set it as Win+C.** The script opens Settings › Personalization › Text input. Under **Customize Copilot key on keyboard**, choose **Gemini Live**. That setting covers both the Copilot key and Win+C.

### The browser extension

The extension hands the app your browser's Google session, so Gemini runs signed in as you.

1. Open `chrome://extensions` (`edge://extensions` in Edge) and turn on **Developer mode** (top right).
2. Drag `gemini-live-session-<version>-chrome.zip` from File Explorer onto the page.

The `.crx` in the release is the same extension, signed. You can drag it in the same way, but on Windows, Chrome may turn off an extension that didn't come from the Chrome Web Store, so the `.zip` is the reliable choice.

Stay signed in to Google in that browser. If you sign out there, Gemini Live waits until you sign back in.

The extension is only needed for the Google account engine. With your own API key, skip it.

## Use your own API key instead

Open the pill (Win+C), click the gear, and under **Gemini runs on** choose **Your API key**. Paste the key and press Enter. **Change API key…** in the same menu replaces it. Switch back to **Your Gemini subscription** at any time.

The key is stored encrypted for your Windows user (DPAPI). A `GEMINI_API_KEY` environment variable, if set, takes precedence.

Usage is billed to the key's Google Cloud project under the [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing); the free tier works, with lower rate limits.

### Create a key in the web UI

The quickest route is [Google AI Studio › API keys](https://aistudio.google.com/apikey) › **Create API key**. AI Studio sets up everything the key needs, including the service account it's bound to.

The Gemini API now rejects unrestricted keys, and new Gemini keys must be bound to a service account ([details](https://ai.google.dev/gemini-api/docs/api-key)). To make one in the Google Cloud console instead:

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project (or pick an existing one) from the project picker at the top.
2. Go to **APIs & Services › Library**, search for **Gemini API** (`generativelanguage.googleapis.com`) and click **Enable**.
3. Go to **IAM & Admin › Service accounts › Create service account**, name it (e.g. `gemini-live`) and click **Done**.
4. Go to **APIs & Services › [Credentials](https://console.cloud.google.com/apis/credentials) › Create credentials › API key**.
5. Under **API restrictions**, choose **Restrict key** and tick **Generative Language API**.
6. Tick **Authenticate API calls through a service account**, click **Select a service account**, and pick the one from step 3.
7. Click **Create**, copy the key from the **API key created** dialog, and paste it into Gemini Live.

Use this key only for Gemini. Google's docs warn that a key shared with other APIs breaks Gemini once it's restricted to them.

### Create a key with gcloud

With the [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed, in PowerShell:

```powershell
gcloud auth login
gcloud projects create gemini-live-<something-unique>   # or skip and use an existing project
gcloud config set project gemini-live-<something-unique>

gcloud services enable generativelanguage.googleapis.com apikeys.googleapis.com
$project = gcloud config get-value project
gcloud iam service-accounts create gemini-live --display-name="Gemini Live for Windows"

gcloud beta services api-keys create --display-name="Gemini Live for Windows" `
  --api-target=service=generativelanguage.googleapis.com `
  --service-account="gemini-live@$project.iam.gserviceaccount.com"

$keyName = gcloud services api-keys list --filter="displayName='Gemini Live for Windows'" --format="value(name)"
gcloud services api-keys get-key-string $keyName --format="value(keyString)"
```

The last command prints the key. `--api-target` restricts it to the Gemini API and `--service-account` binds it, like steps 5 and 6 above. Binding needs the `beta` command, and your account needs the **Service Account User** and **Service Account API Key Binding Admin** roles on the project.

## How it works

- **Google account engine (default).** The real Gemini web client (`gemini.google.com/glic`, the one behind Gemini in Chrome) runs in a hidden WebView2. It owns the mic, echo cancellation, the Live connection and Gemini's voice.
  - **Pictures:** it pulls screen stills from the app, a fresh one each second. The app announces the screen under a new tab id each time, since the client sends one picture per tab id.
  - **Text:** each picture comes with an exact text copy of the foreground window, read through UI Automation, so small text Gemini can't make out in the picture still reaches it word for word.
  - **Recovery:** a Live that breaks is retried with Gemini's own *Try again*, then reloaded, up to three times in ten minutes.
- **Your browser's Google session.** The companion extension pushes the session over a loopback WebSocket whenever Google rotates it. The app never rotates the cookies itself, so your browser stays the only owner of the session.
  - The socket has no fixed port. The app listens on a free one each run and hands it out, with a fresh token, through a native messaging host (`GeminiLiveHost.exe`). The browser lets only this extension's ID talk to that host.
  - The extension sends cookies only after the app greets it with that token.
- **API key engine (gear › Gemini runs on › Your API key).** The public Gemini Live API over a WebSocket, with Windows' echo-cancelled audio (default microphone) and about one JPEG screen frame per second. No browser, extension or Google account involved.

## Build from source

Needs the .NET 10 SDK, the Windows 10 SDK (for `makeappx` and `signtool`), Node 24 and pnpm.

```powershell
pnpm install
.\scripts\install.ps1                  # build, sign with a local certificate, install
.\scripts\install.ps1 -Mode Register   # unsigned dev-mode install for fast iteration
.\scripts\install.ps1 -Mode Release    # the release files, in build\release
```

Windows only lists signed providers in the Copilot key setting, so use the default mode to try Win+C. The release mode signs the extension's `.crx` with `keys\chrome.pem`, which git ignores; the extension's ID comes from that key.

| Path | What |
| --- | --- |
| `src/GeminiLive` | the WPF app |
| `src/GeminiLiveHost` | the native messaging host the extension asks for the app's link |
| `bridge/` | the TypeScript injected into the hidden Gemini and Google Home pages |
| `extension/` | the companion browser extension (WXT) |
| `messaging/` | typed messaging, in [@webext-core/messaging](https://webext-core.aklinker1.io/messaging/)'s protocol-map style, shared by the bridges, the extension and (as `Messaging.cs`) the app |
| `analyzers/` | the C# side of the lint rules |
| `package/` | the MSIX manifest and assets |

### Lint

```powershell
pnpm dev:lint   # fallow, oxlint + ESLint, and dotnet format
```

TypeScript follows the youtube-time-manager setup: oxlint for logic, ESLint for layout, fallow for dead code and complexity. The C# side mirrors the same rules through `.editorconfig` and the analyzers in `analyzers/`. A pre-commit hook runs them on staged files.

## Debugging

- Log: `%LOCALAPPDATA%\GeminiLive\log.txt`.
- Create `%LOCALAPPDATA%\GeminiLive\debug.flag` to turn on DevTools and CDP for the hidden pages, each on a free port the log names (`glic: devtools on localhost:<port>`), and to keep the overlays visible in screenshots.

## License

[Apache License 2.0](LICENSE). Forks and other redistributions must keep the [NOTICE](NOTICE) file and credit [Avi](https://avi12.com) in their documentation and in any about or credits screen.

Not affiliated with Google or Microsoft.
