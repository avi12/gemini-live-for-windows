using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;

namespace GeminiLive.Glic;

/// <summary>
/// Hosts the real Gemini web client (gemini.google.com/glic - what powers Gemini in Chrome) in a
/// WebView2 that lives off-screen for the whole app lifetime, so Win+C starts Live without a page
/// load. The page owns mic, echo cancellation, the Live connection and Gemini's voice; we supply
/// the screen frames it pulls and read back state + captions.
///
/// It is signed in with your browser's Google session, pushed by the companion extension through
/// <see cref="SessionLink"/>. The browser is the only owner of that session: this WebView2 never
/// rotates the cookies itself (RotateCookies is blocked), it just takes each rotation the browser
/// makes - otherwise the two copies would invalidate each other.
/// </summary>
public sealed class GlicHost : GoogleWebViewHost<GlicMessage> {
  public event Action<GlicState>? State;
  public event Action<string, bool, int>? Caption;  // text, isUser, utterance index
  public event Action<string>? Notice;  // waiting-for-session style status, not fatal
  public event Action<string>? Failed;
  /// <summary>
  /// True while a session is wanted but the companion extension has never connected.
  /// </summary>
  public event Action<bool>? ExtensionNeeded;

  private const string _glicUrl = "https://gemini.google.com/glic";
  private const string _bridgeResource = "GeminiLive.Glic.glic_bridge.js";
  private const string _dispatchKeyEvent = "Input.dispatchKeyEvent";
  private const int _pageWidth = 900;
  private const int _pageHeight = 720;
  private static readonly TimeSpan _messageTimeout = TimeSpan.FromSeconds(3);
  // The page waits up to 6 s for its text box, and up to 30 s for an answer plus a few settles.
  private static readonly TimeSpan _beginActionTimeout = TimeSpan.FromSeconds(10);
  private static readonly TimeSpan _submitTimeout = TimeSpan.FromSeconds(45);
  private static readonly TimeSpan _refreshGrace = TimeSpan.FromSeconds(25);
  // A broken Live is reloaded into a new conversation, but a page that keeps breaking is given up on.
  private const int _maxRestarts = 3;
  private static readonly TimeSpan _restartWindow = TimeSpan.FromMinutes(10);
  private static readonly string _profile = Path.Combine(Log.Dir, "WebView2");

  private readonly SessionLink _link;
  private readonly Queue<DateTime> _restarts = new();

  /// <summary>What Gemini sees: the display or the camera it pulls frames from.</summary>
  public SharedView View { get; } = new();
  public bool Active { get; private set; }

  private TaskCompletionSource? _ready;
  private IReadOnlyList<GoogleCookie> _session = [];
  private string _sessionPrint = "";
  private string? _microphoneId;
  private bool _booted;
  private bool _unavailable;

  /// <summary>
  /// The failures the page reports by code (ErrorMessage in bridge/glic_bridge.ts; wire value: the
  /// kebab-cased name, see <see cref="PageErrorOf"/>). Anything else is a message to show.
  /// </summary>
  private enum PageError { Other, SignedOut, Unavailable, LiveBroke }

  /// <summary>The waiting-for-session lines <see cref="Notice"/> shows.</summary>
  private static class SessionNotice {
    public const string Refreshing = "Refreshing your Google session…";
    public const string SignIn = "Sign in to Google in your browser";
    public const string WaitingForBrowser = "Waiting for your browser…";
    public const string Setup = "One-time setup";
  }

  public GlicHost(SessionLink link)
      : base("Gemini Live - web client", "glic", _profile, _bridgeResource, _pageWidth,
             _pageHeight, _messageTimeout) {
    _link = link;
    link.CookiesReceived += cookies => Dispatcher.BeginInvoke(() => AdoptSession(cookies));
    link.Connected += () => Dispatcher.BeginInvoke(() => ExtensionNeeded?.Invoke(false));

    // Once, not in OnCoreReady: a rebuilt engine keeps the same messenger, which allows one
    // listener per message. The messenger calls these on the UI thread, which owns Core.
    OnReport(GlicProtocol.Booted, _ => OnBooted());
    OnReport(GlicProtocol.Ready, _ => {
      Log.Write("glic: live");
      _ready?.TrySetResult();
    });
    OnReport(GlicProtocol.State, state => State?.Invoke(state));
    OnReport(GlicProtocol.Transcript, line => Caption?.Invoke(
        line.Text, line.Direction == TranscriptDirection.User, line.Index));
    OnReport(GlicProtocol.Error, message => OnPageError(message));
    Messenger.OnMessage(GlicProtocol.Capture, _ => View.CaptureAsync());
    Messenger.OnMessage(GlicProtocol.Read, _ => View.ReadAsync());
  }

  /// <summary>
  /// Wires up a fresh engine, injects the saved session and loads glic - at warm-up, and after a
  /// browser crash, where the reloaded page re-adopts and Live resumes on its own if it was on.
  /// </summary>
  protected override void OnCoreReady(CoreWebView2 core) {
    core.PermissionRequested += OnPermissionRequested;

    _booted = false;
    _session = GoogleCookies.Load();
    _sessionPrint = GoogleCookies.Fingerprint(_session);
    GoogleCookies.Inject(core.CookieManager, _session);
    Log.Write($"glic: {_session.Count} saved Google cookies, "
              + $"extension connected={_link.IsExtensionConnected}");
    core.Navigate(_glicUrl);
  }

  protected override void OnRecovering() {
    _booted = false;
    Notice?.Invoke(LiveStatus.Reconnecting);
  }

  protected override void OnRecoveryFailed(RecoveryFailure failure, Exception? cause) {
    _ready?.TrySetException(cause ?? new InvalidOperationException("Gemini keeps crashing."));
    Failed?.Invoke(failure == RecoveryFailure.CrashLoop ? "Gemini keeps crashing; try again shortly."
                                                        : "Couldn't restart Gemini.");
  }

  // ---- session control ----

  /// <summary>Starts Live; completes once Gemini is actually listening.</summary>
  public Task StartAsync() {
    Active = true;
    _ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

    if (Core is null) {
      _ = RebuildAsync();  // a crash recovery gave up earlier; this is the retry
    } else if (_unavailable || !GoogleCookies.HasSession(_session)) {
      WaitForSession();
    } else if (_booted) {
      Send(GlicProtocol.Start);
    }

    // else: OnBooted starts it as soon as the page is up.
    return _ready.Task;
  }

  // OnCoreReady navigates, and the page's Booted starts Live since Active is set.
  private async Task RebuildAsync() {
    try {
      await EnsureCoreAsync();
    } catch (Exception e) {
      Log.Write($"glic: rebuild failed: {e.Message}");
      _ready?.TrySetException(e);
    }
  }

  public void Stop() {
    Active = false;
    _ready?.TrySetCanceled();
    Send(GlicProtocol.Stop);
  }

  public void SetMuted(bool muted) {
    Send(GlicProtocol.SetMuted, muted);
  }

  /// <summary>
  /// The page's own microphone id (null = Windows' default). Re-applied on every page load.
  /// </summary>
  public void SetMicrophone(string? id) {
    _microphoneId = id;
    Send(GlicProtocol.SetMic, id);
  }

  /// <summary>
  /// The microphones the page can open, as (id, name). Empty until the page has loaded.
  /// </summary>
  public async Task<IReadOnlyList<(string Id, string Name)>> ListMicrophonesAsync() {
    if (Core is null) {
      return [];
    }

    IReadOnlyList<Microphone>? microphones = await Log.AttemptAsync(
        "glic: listing microphones", () => Messenger.SendMessageAsync(GlicProtocol.ListMics));
    return [.. (microphones ?? []).Select(m => (m.Id, m.Label))];
  }

  /// <summary>
  /// Runs a request Live can't serve - a Google app (Calendar, Keep, Tasks, Gmail), or a web search
  /// whose links Live could only say - as a text turn in the same conversation, auto-confirming a
  /// result card, and returns the answer with its links. The caller resumes Live with
  /// <see cref="StartAsync"/>. Typing uses trusted CDP key events, because synthetic input never
  /// enables Glic's Submit.
  /// </summary>
  public async Task<TextAnswer> RunActionAsync(string prompt) {
    if (Core is not { } core) {
      return new TextAnswer("", []);
    }

    bool ready = await Messenger.SendMessageAsync(GlicProtocol.BeginAction,
                                                  timeout: _beginActionTimeout);
    if (!ready) {
      throw new InvalidOperationException("Gemini's text box didn't open for the action");
    }

    foreach (char character in prompt) {
      string key = character.ToString();
      var down = new JsonObject {
        ["type"] = "keyDown",
        ["text"] = key,
        ["unmodifiedText"] = key,
        ["key"] = key,
      };
      await core.CallDevToolsProtocolMethodAsync(_dispatchKeyEvent, down.ToJsonString());
      var up = new JsonObject { ["type"] = "keyUp", ["key"] = key };
      await core.CallDevToolsProtocolMethodAsync(_dispatchKeyEvent, up.ToJsonString());
    }
    return await Messenger.SendMessageAsync(GlicProtocol.SubmitAndRead, timeout: _submitTimeout);
  }

  private static void OnPermissionRequested(object? sender,
                                            CoreWebView2PermissionRequestedEventArgs e) {
    if (e.PermissionKind is CoreWebView2PermissionKind.Microphone) {
      // A parked window can never show a permission prompt, so grant the mic up front.
      e.State = CoreWebView2PermissionState.Allow;
    } else if (e.PermissionKind is CoreWebView2PermissionKind.Camera) {
      // The page never opens the camera itself (SharedView captures it in-process); denying here
      // keeps Chromium from opening the device, which is what triggers Windows' camera prompt.
      e.State = CoreWebView2PermissionState.Deny;
    }
  }

  // ---- the browser's Google session ----

  private void AdoptSession(IReadOnlyList<GoogleCookie> cookies) {
    string print = GoogleCookies.Fingerprint(cookies);
    if (print == _sessionPrint) {
      return;
    }

    _session = cookies;
    _sessionPrint = print;
    GoogleCookies.Save(cookies);

    if (Core is not { } core) {
      return;  // OnCoreReady injects the saved copy
    }

    GoogleCookies.Inject(core.CookieManager, cookies);
    Log.Write("glic: session updated from the browser");

    // A page that loaded without a valid session has to start over with this one.
    if (_booted && !_unavailable) {
      return;
    }

    _unavailable = false;
    core.Navigate(_glicUrl);
  }

  /// <summary>No usable session yet: say why, and ask the extension for a fresh one.</summary>
  private void WaitForSession() {
    if (!Active) {
      return;
    }

    bool connected = _link.IsExtensionConnected;
    // A saved session only ever comes from the extension, so having one means it's installed: it
    // is just asleep (its worker wakes on a timer after the app starts) or the browser is closed.
    bool installed = connected || _session.Count > 0;
    // Holding a session that failed means it went stale: Google's pages keep it fresh only while
    // they run, so have the browser refresh it. Usually that's all a "sign in" needs.
    bool stale = _session.Count > 0;
    Notice?.Invoke(SessionNoticeFor(connected, installed, stale));
    ExtensionNeeded?.Invoke(!installed);

    if (stale) {
      _link.RequestRefresh();
      // The extension's refresh page runs ~15 s; still failing after that means really signed out.
      _ = Task.Delay(_refreshGrace).ContinueWith(_ => Dispatcher.BeginInvoke(() => {
        if (Active && _unavailable) {
          Notice?.Invoke(SessionNotice.SignIn);
        }
      }));
    } else {
      _link.RequestCookies();
    }
  }

  private static string SessionNoticeFor(bool connected, bool installed, bool stale) {
    if (connected) {
      return stale ? SessionNotice.Refreshing : SessionNotice.SignIn;
    }

    return installed ? SessionNotice.WaitingForBrowser : SessionNotice.Setup;
  }

  // ---- messages to and from the page ----

  /// <summary>
  /// Sends a command to the page without waiting for it. A page that is loading or gone misses
  /// it, which is logged; with no engine at all there is nobody to tell.
  /// </summary>
  private async void Send<TData>(Protocol<GlicMessage, TData, None> command, TData data) {
    if (Core is null) {
      return;
    }

    try {
      await Messenger.SendMessageAsync(command, data);
    } catch (Exception e) {
      Log.Write($"glic: {WireName.For(command.Type)} failed: {e.Message}");
    }
  }

  private void Send(Protocol<GlicMessage, None, None> command) {
    Send(command, default(None));
  }

  /// <summary>Handles a report from the page that wants nothing back.</summary>
  private void OnReport<TData>(Protocol<GlicMessage, TData, None> report, Action<TData> onReceived) {
    Messenger.OnMessage(report, data => {
      onReceived(data);
      return default(None);
    });
  }

  private void OnBooted() {
    _booted = true;
    Log.Write("glic: host adopted");

    if (_microphoneId is not null) {
      SetMicrophone(_microphoneId);
    }

    if (Active && !_unavailable) {
      Send(GlicProtocol.Start);
    }
  }

  private void OnPageError(string? message) {
    message ??= "Gemini error";
    Log.Write($"glic error: {message}");
    PageError error = PageErrorOf(message);
    // Signed out or a stale session: get the browser's current one.
    if (error is PageError.SignedOut or PageError.Unavailable) {
      _unavailable = true;
      WaitForSession();
      return;
    }

    if (!Active) {
      return;
    }

    if (error is PageError.LiveBroke) {
      if (TryRestart()) {
        return;
      }

      message = "Gemini Live stopped working";
    }

    _ready?.TrySetException(new InvalidOperationException(message));
    Failed?.Invoke(message);
  }

  private static PageError PageErrorOf(string message) {
    return Enum.GetValues<PageError>().FirstOrDefault(
        error => JsonNamingPolicy.KebabCaseLower.ConvertName(error.ToString()) == message);
  }

  /// <summary>
  /// Live broke and Glic's own Try again didn't bring it back: reload the page, whose Booted starts
  /// Live again since the session is still active. False once the restart budget is spent.
  /// </summary>
  private bool TryRestart() {
    DateTime now = DateTime.UtcNow;
    while (_restarts.Count > 0 && now - _restarts.Peek() > _restartWindow) {
      _restarts.Dequeue();
    }

    if (_restarts.Count >= _maxRestarts || Core is not { } core) {
      return false;
    }

    _restarts.Enqueue(now);
    Log.Write($"glic: Live broke, reloading ({_restarts.Count}/{_maxRestarts})");
    Notice?.Invoke(LiveStatus.Reconnecting);
    _booted = false;
    core.Navigate(_glicUrl);
    return true;
  }
}
