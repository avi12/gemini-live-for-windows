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
  private static readonly string _profile = Path.Combine(Log.Dir, "WebView2");

  private readonly SessionLink _link;

  /// <summary>Which display the frames come from.</summary>
  public MonitorInfo Monitor { get; set; } = Monitors.All()[0];
  public bool Active { get; private set; }

  /// <summary>True while the webcam is the frame source instead of the screen.</summary>
  public bool UseCamera { get; private set; }

  private TaskCompletionSource? _ready;
  private IReadOnlyList<GoogleCookie> _session = [];
  private string _sessionPrint = "";
  private string? _microphoneId;
  private bool _booted;
  private bool _unavailable;
  private WebcamSource? _camera;
  private ScreenGrabber.Frame? _lastFrame;
  private static readonly TimeSpan _refreshGrace = TimeSpan.FromSeconds(25);
  // A broken Live is reloaded into a new conversation, but a page that keeps breaking is given up on.
  private const int _maxRestarts = 3;
  private static readonly TimeSpan _restartWindow = TimeSpan.FromMinutes(10);
  private readonly Queue<DateTime> _restarts = new();

  /// <summary>The failures the page reports by code (ErrorMessage in glic_bridge.js).</summary>
  private enum PageError { Other, SignedOut, Unavailable, LiveBroke }

  private static readonly IReadOnlyDictionary<string, PageError> _pageErrors =
      new Dictionary<string, PageError> {
        ["signed-out"] = PageError.SignedOut,
        ["unavailable"] = PageError.Unavailable,
        ["live-broke"] = PageError.LiveBroke,
      };

  /// <summary>The waiting-for-session lines <see cref="Notice"/> shows.</summary>
  private static class SessionNotice {
    public const string Refreshing = "Refreshing your Google session…";
    public const string SignIn = "Sign in to Google in your browser";
    public const string WaitingForBrowser = "Waiting for your browser…";
    public const string Setup = "One-time setup";
    public const string Reconnecting = "Reconnecting…";
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
    Messenger.OnMessage(GlicProtocol.Capture, _ => CaptureAsync());
    Messenger.OnMessage(GlicProtocol.Read, _ => ReadAsync());
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
    Notice?.Invoke(SessionNotice.Reconnecting);
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
  /// Shares the webcam instead of the screen, or switches back. Gemini pulls frames the same way
  /// either way (see <see cref="CaptureAsync"/>); this only changes which source answers. Opening
  /// the camera triggers Windows' one-time camera consent for the app. Returns false if the camera
  /// could not be opened, leaving the screen as the source.
  /// </summary>
  public async Task<bool> UseCameraAsync(bool on) {
    if (on == UseCamera) {
      return true;
    }

    _lastFrame = null;  // the other source's picture is no stand-in for this one

    if (on) {
      try {
        var camera = new WebcamSource();
        await camera.InitializeAsync();
        _camera = camera;
        UseCamera = true;
        Log.Write("glic: sharing the camera");
        return true;
      } catch (Exception e) {
        Log.Write($"camera unavailable: {e.Message}");
        return false;
      }
    }

    UseCamera = false;
    WebcamSource? old = _camera;
    _camera = null;

    if (old is not null) {
      await old.DisposeAsync();
    }

    Log.Write("glic: sharing the screen");
    return true;
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

    try {
      IReadOnlyList<Microphone> microphones =
          await Messenger.SendMessageAsync(GlicProtocol.ListMics);
      return [.. microphones.Select(m => (m.Id, m.Label))];
    } catch (Exception e) {
      Log.Write($"glic: listing microphones failed: {e.Message}");
      return [];
    }
  }

  /// <summary>
  /// Runs a Google-apps request (Calendar, Keep, Tasks, Gmail, Home - whatever the account's text
  /// path has) as a text turn in the same conversation, auto-confirming the result card, and
  /// returns the answer. The caller resumes Live with <see cref="StartAsync"/>. Typing uses trusted
  /// CDP key events, because synthetic input never enables Glic's Submit.
  /// </summary>
  public async Task<string> RunActionAsync(string prompt) {
    if (Core is not { } core) {
      return "";
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
    string? answer = await Messenger.SendMessageAsync(GlicProtocol.SubmitAndRead,
                                                      timeout: _submitTimeout);
    return answer ?? "";
  }

  private static void OnPermissionRequested(object? sender,
                                            CoreWebView2PermissionRequestedEventArgs e) {
    if (e.PermissionKind is CoreWebView2PermissionKind.Microphone) {
      // A parked window can never show a permission prompt, so grant the mic up front.
      e.State = CoreWebView2PermissionState.Allow;
    } else if (e.PermissionKind is CoreWebView2PermissionKind.Camera) {
      // We share the screen, never the camera; denying here keeps Chromium from opening the
      // device, which is what triggers Windows' camera prompt.
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

    // Signed out or a stale session: get the browser's current one.
    if (_pageErrors.GetValueOrDefault(message) is PageError.SignedOut or PageError.Unavailable) {
      _unavailable = true;
      WaitForSession();
      return;
    }

    if (!Active) {
      return;
    }

    if (_pageErrors.GetValueOrDefault(message) is PageError.LiveBroke) {
      if (TryRestart()) {
        return;
      }

      message = "Gemini Live stopped working";
    }

    _ready?.TrySetException(new InvalidOperationException(message));
    Failed?.Invoke(message);
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
    Notice?.Invoke(SessionNotice.Reconnecting);
    _booted = false;
    core.Navigate(_glicUrl);
    return true;
  }

  /// <summary>
  /// Answers the page's pull for a picture: the camera's, or a sharp grab of the shared display
  /// made off the UI thread. A failed grab keeps the last good picture rather than leaving Gemini
  /// blind for a frame.
  /// </summary>
  private async Task<Picture?> CaptureAsync() {
    ScreenGrabber.Frame? frame;
    if (UseCamera && _camera is { } camera) {
      frame = await GrabCameraAsync(camera);
    } else {
      MonitorInfo monitor = Monitor;
      frame = await Task.Run(() => Attempt("grab", () => ScreenGrabber.Grab(
          monitor, ScreenGrabber.Detail.Sharp)));
    }

    frame ??= _lastFrame;
    _lastFrame = frame;
    return frame is null ? null
                         : new Picture(frame.Jpeg, ScreenGrabber.MimeType, frame.Width, frame.Height);
  }

  private static async Task<ScreenGrabber.Frame?> GrabCameraAsync(WebcamSource camera) {
    try {
      return await camera.GrabAsync();
    } catch (Exception e) {
      Log.Write($"camera grab failed: {e.Message}");
      return null;
    }
  }

  /// <summary>
  /// Answers the page with an exact text copy of the window on the shared display, read off the UI
  /// thread, which it hands Gemini as the tab's page content next to each picture. None while the
  /// camera is shared.
  /// </summary>
  private async Task<ScreenText.View?> ReadAsync() {
    if (UseCamera) {
      return null;
    }

    MonitorInfo monitor = Monitor;
    return await Task.Run(() => Attempt("screen text", () => ScreenText.Read(monitor)));
  }

  /// <summary>Runs <paramref name="work"/>; null, logged, if it throws.</summary>
  private static T? Attempt<T>(string what, Func<T?> work) where T : class {
    try {
      return work();
    } catch (Exception e) {
      Log.Write($"{what} failed: {e.Message}");
      return null;
    }
  }
}
