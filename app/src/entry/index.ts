/**
 * The process entry layer: how the process starts, how it hears the Copilot key, and how it becomes
 * `GeminiLive.exe`. Staged, not shipped: the C# entry stays the shipped one until the manifest points at
 * the SEA exe (`scripts\install.ps1 -Entry Sea`, `package\AppxManifest.sea.xml`).
 *
 * Wiring for the app (main.ts / window.ts, owned by the composition):
 * - main thread, first line: `ensureDpiAware()`. Then `describeActivation({ args: userArguments(process.argv),
 *   packagedKind })`; `packagedKind` is `AppInstance.getCurrent().getActivatedEventArgs().kind` of the
 *   Windows App SDK (undefined unpackaged). A `key` activation is a Copilot key press with
 *   `KeySource.coldStart`; a second copy's argv, relayed by the single-instance pipe, goes through
 *   `triggerFromArgument` with `KeySource.forwarded`. A `startup` activation must not start a conversation.
 * - UI worker: `startFastPath({ onTrigger })`, sending each press with `createKeyTriggerSender` over its own
 *   MessageChannel; the main thread serves it with `serveKeyTriggers`.
 * - For the spike, the UI worker calls `startFastPathSpike()` instead when `isFastPathSpikeRequested()`.
 *
 * WHAT ONLY A REAL PACKAGED RUN CAN VERIFY (run `scripts\Register-FastPathSpike.ps1`, a throwaway package
 * `Avi.GeminiLiveFastPathSpike` that leaves the installed app alone; read
 * `%USERPROFILE%\.gemini-live\fast-path-spike.log`):
 *
 * 1. Posted or sent. Select "Gemini Live SPIKE" in Settings > Personalization > Text input > Copilot key.
 *    The log must show the self-test line (`id=0x8001 wParam=99`: the hook works), then press Win+C
 *    (tap), hold and release. `id=0x8001 wParam=0/1/2` lines = POSTED: ship the TypeScript path as is.
 *    No line after the self-test = SENT, or the shell ignores the hidden window. Then try a
 *    WS_EX_TOOLWINDOW window shown off screen before concluding. Only if still silent, build the shim:
 *    a DLL of about 25 lines of C exporting `InstallFastPath(HWND hwnd, UINT wmCopilot, UINT wmRepost)`.
 *    It calls `SetWindowSubclass(hwnd, proc, 1, wmRepost)`; `proc` does
 *    `if (msg == wmCopilot) { PostMessageW(hwnd, wmRepost, wParam, 0); return 0; }`, removes itself on
 *    `WM_NCDESTROY`, and otherwise returns `DefSubclassProc`. Node loads it with `bindFunction({ library:
 *    <absolute path> })` on the UI worker (the window's thread) and the hook listens for `wmRepost`
 *    (WM_APP+2). NOT built, because nothing proves it is needed.
 * 2. The property read-back. Unpackaged it reads back as text (type 31, VT_LPWSTR) converting to 32769 =
 *    0x8001, so the type-31 reading was the window property store keeping values as text and is not a bug.
 *    The spike's first line prints `property=32769`; confirm the same packaged.
 * 3. `uap3:Protocol Parameters="%1"`: launch `geminilive-key://?state=HoldStart` (Win+R) with the app NOT
 *    running; the log of the normal app (or `describeActivation`) must see it at `process.argv[2]`, quotes
 *    stripped. Also confirm a Win+C press with the app closed starts it with that argument.
 * 4. Startup task: sign out and in; `packagedKind` must be 1020 (StartupTask) and no conversation starts.
 * 5. GUI subsystem: Start menu, protocol and alias launches show no console window and `process.stdin`
 *    still works for the native host (run the extension's connect once).
 * 6. Two `Application` elements sharing `GeminiLive.exe` (`-HostExe Shared`): `makeappx pack` and
 *    `Add-AppxPackage` must accept it and the alias `GeminiLiveHost.exe` must start the host. If not,
 *    the default `-HostExe Copy` (a second exe copy) is already the safe layout.
 * 7. Packaged identity: `PILL_IS_PACKAGED` is not set by anyone now; the app must use the package-identity
 *    check, and the Windows App SDK bootstrap must be skipped (it fails 0x80070032 in a package).
 * 8. DPI: per-monitor DPI v2 holds in the packaged exe (node.exe's own manifest is console-era; the call at
 *    startup is the net). Embedding an `RT_MANIFEST` with `PerMonitorV2` would need a resource editor
 *    after postject; not done.
 * 9. Authenticode: postject breaks node.exe's signature; the MSIX is signed as a whole. Confirm Smart App
 *    Control and Defender accept the installed exe, and note the first cold start (874 ms measured
 *    unpackaged on the first run, 74 to 80 ms after).
 * 10. Win2D classes ("Class not registered" in the installed log) need `inProcessServer` entries in the
 *     manifest; the SEA manifest does not add them.
 */
export { ActivationKind, describeActivation, KEY_SCHEME, STARTUP_TASK_ACTIVATION_KIND, triggerFromArgument, userArguments } from "./activation.ts";
export type { Activation } from "./activation.ts";
export { DpiAwareness, ensureDpiAware } from "./dpi.ts";
export { startFastPath, triggerFromWParam, WM_COPILOT } from "./fast-path.ts";
export { isFastPathSpikeRequested, SPIKE_FLAG_FILE, spikeLogPath, startFastPathSpike } from "./fast-path-spike.ts";
export { createKeyTriggerSender, EntryMessage, KeySource, serveKeyTriggers } from "./protocol.ts";
export type { EntryProtocolMap, KeyTriggerPayload } from "./protocol.ts";
export { HOST_ARGUMENT_PREFIX } from "./sea-stub.ts";
