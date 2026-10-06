using System.Reflection;
using System.Text.Json.Nodes;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace GeminiLive.Glic;

/// <summary>The Live states the page reports (State in glic_bridge.js).</summary>
public enum GlicState { Idle, Listening, Resuming }

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
public sealed class GlicHost : Window {
  public event Action<GlicState>? State;
  public event Action<string, bool, int>? Caption;  // text, isUser, utterance index
  public event Action<string>? Notice;  // waiting-for-session style status, not fatal
  public event Action<string>? Failed;
  /// <summary>
  /// True while a session is wanted but the companion extension has never connected.
  /// </summary>
  public event Action<bool>? ExtensionNeeded;

  private const string _glicUrl = "https://gemini.google.com/glic";
  private const string _rotateCookiesFilter = "https://accounts.google.com/RotateCookies*";
  private const string _bridgeResource = "GeminiLive.Glic.glic_bridge.js";
  private const string _bridge = "window.__glicBridge";  // the object glic_bridge.js installs
  private const string _dispatchKeyEvent = "Input.dispatchKeyEvent";
  private const int _pageWidth = 900;
  private const int _pageHeight = 720;
  private const int _parkedAt = -32000;
  // Parked off-screen reads as "occluded" to Chromium, which would throttle the page's timers;
  // Gemini's voice must also play without a click inside the page.
  private const string _browserArguments =
      "--autoplay-policy=no-user-gesture-required "
      + "--disable-features=CalculateNativeWinOcclusion "
      + "--disable-background-timer-throttling --disable-renderer-backgrounding";
  private static readonly string _profile = Path.Combine(Log.Dir, "WebView2");

  private readonly WebView2 _web = new();
  private readonly SessionLink _link;
  private readonly IntPtr _hwnd;

  /// <summary>Which display the frames come from.</summary>
  public MonitorInfo Monitor { get; set; } = Monitors.All()[0];
  public bool Active { get; private set; }

  private TaskCompletionSource? _ready;
  private IReadOnlyList<GoogleCookie> _session = [];
  private string _sessionPrint = "";
  private string? _microphoneId;
  private bool _booted;
  private bool _unavailable;
  private static readonly TimeSpan _refreshGrace = TimeSpan.FromSeconds(25);

  /// <summary>The session failures the page reports (ErrorMessage in glic_bridge.js).</summary>
  private enum PageError { Other, SignedOut, Unavailable }

  private static readonly IReadOnlyDictionary<string, PageError> PageErrors =
      new Dictionary<string, PageError> {
        ["signed-out"] = PageError.SignedOut,
        ["unavailable"] = PageError.Unavailable,
      };

  /// <summary>
  /// Message kinds on the WebView2 channel, both directions (Kind in glic_bridge.js). The wire
  /// value is <see cref="WireName"/>'s lower-cased name.
  /// </summary>
  private enum PageMessageKind { Booted, Capture, Error, Frame, Ready, State, Transcript }

  /// <summary>Who spoke a transcript line (Direction in glic_bridge.js).</summary>
  private enum TranscriptDirection { User, Assistant }

  /// <summary>The waiting-for-session lines <see cref="Notice"/> shows.</summary>
  private static class SessionNotice {
    public const string Refreshing = "Refreshing your Google session…";
    public const string SignIn = "Sign in to Google in your browser";
    public const string WaitingForBrowser = "Waiting for your browser…";
    public const string Setup = "One-time setup";
  }

  public GlicHost(SessionLink link) {
    _link = link;
    Title = "Gemini Live - web client";
    Width = _pageWidth;
    Height = _pageHeight;
    ShowInTaskbar = false;
    ShowActivated = false;
    WindowStartupLocation = WindowStartupLocation.Manual;
    Content = _web;
    _hwnd = new System.Windows.Interop.WindowInteropHelper(this).EnsureHandle();
    Closing += (_, e) => {
      e.Cancel = true;
      Park();
    };
    link.CookiesReceived += cookies => Dispatcher.BeginInvoke(() => AdoptSession(cookies));
    link.Connected += () => Dispatcher.BeginInvoke(() => ExtensionNeeded?.Invoke(false));
  }

  /// <summary>
  /// Boots WebView2 and loads Gemini. Called once at app start so Win+C is instant later.
  /// </summary>
  public async Task WarmUpAsync() {
    Show();
    Park();
    if (!_web.IsLoaded) {
      var loaded = new TaskCompletionSource();
      _web.Loaded += (_, _) => loaded.TrySetResult();
      await loaded.Task;
    }

    var options = new CoreWebView2EnvironmentOptions(
        _browserArguments + (Log.Debugging ? " --remote-debugging-port=9333" : ""));
    CoreWebView2Environment env =
        await CoreWebView2Environment.CreateAsync(null, _profile, options);
    await _web.EnsureCoreWebView2Async(env);
    CoreWebView2 core = _web.CoreWebView2;

    core.Settings.AreDevToolsEnabled = Log.Debugging;
    core.Settings.IsStatusBarEnabled = false;
    core.PermissionRequested += OnPermissionRequested;
    // The browser owns cookie rotation; see the class comment.
    core.AddWebResourceRequestedFilter(_rotateCookiesFilter, CoreWebView2WebResourceContext.All);
    core.WebResourceRequested += (_, e) =>
        e.Response = env.CreateWebResourceResponse(null, 204, "No Content", "");
    core.WebMessageReceived += OnMessage;
    await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript());

    _session = GoogleCookies.Load();
    _sessionPrint = GoogleCookies.Fingerprint(_session);
    GoogleCookies.Inject(core.CookieManager, _session);
    Log.Write($"glic: {_session.Count} saved Google cookies, "
              + $"extension connected={_link.IsExtensionConnected}");
    core.Navigate(_glicUrl);
  }

  // ---- session control ----

  /// <summary>Starts Live; completes once Gemini is actually listening.</summary>
  public Task StartAsync() {
    Active = true;
    _ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    if (_unavailable || !GoogleCookies.HasSession(_session)) {
      WaitForSession();
    } else if (_booted) {
      _ = CallBridge("start()");
    }
    // else: OnMessage's Booted starts it as soon as the page is up.
    return _ready.Task;
  }

  public void Stop() {
    Active = false;
    _ready?.TrySetCanceled();
    _ = CallBridge("stop()");
  }

  public void SetMuted(bool muted) {
    _ = CallBridge($"setMuted({(muted ? "true" : "false")})");
  }

  /// <summary>
  /// The page's own microphone id (null = Windows' default). Re-applied on every page load.
  /// </summary>
  public void SetMicrophone(string? id) {
    _microphoneId = id;
    _ = CallBridge($"setMic({JsonValue.Create(id)?.ToJsonString() ?? "null"})");
  }

  /// <summary>
  /// The microphones the page can open, as (id, name). Empty until the page has loaded.
  /// </summary>
  public async Task<IReadOnlyList<(string Id, string Name)>> ListMicrophonesAsync() {
    JsonNode? value = await EvalAsync($"{_bridge} ? {_bridge}.listMics() : []");
    return value?.AsArray()
        .Select(m => (m!["id"]!.GetValue<string>(), m["label"]!.GetValue<string>()))
        .ToList() ?? [];
  }

  /// <summary>
  /// Runs a Google-apps request (Calendar, Keep, Tasks, Gmail, Home - whatever the account's text
  /// path has) as a text turn in the same conversation, auto-confirming the result card, and
  /// returns the answer. The caller resumes Live with <see cref="StartAsync"/>. Typing uses trusted
  /// CDP key events, because synthetic input never enables Glic's Submit.
  /// </summary>
  public async Task<string> RunActionAsync(string prompt) {
    if (_web.CoreWebView2 is not { } core) {
      return "";
    }
    JsonNode? ready = await EvalAsync($"{_bridge} && {_bridge}.beginAction()");
    if (ready?.GetValue<bool>() != true) {
      throw new InvalidOperationException("Gemini's text box didn't open for the action");
    }
    foreach (char ch in prompt) {
      string key = ch.ToString();
      var down = new JsonObject {
        ["type"] = "keyDown", ["text"] = key, ["unmodifiedText"] = key, ["key"] = key,
      };
      await core.CallDevToolsProtocolMethodAsync(_dispatchKeyEvent, down.ToJsonString());
      var up = new JsonObject { ["type"] = "keyUp", ["key"] = key };
      await core.CallDevToolsProtocolMethodAsync(_dispatchKeyEvent, up.ToJsonString());
    }
    JsonNode? reply = await EvalAsync($"{_bridge}.submitAndRead()");
    return reply?.GetValue<string>() ?? "";
  }

  /// <summary>Evaluates an expression in the page, awaiting a promise, and returns its value.</summary>
  private async Task<JsonNode?> EvalAsync(string expression) {
    if (_web.CoreWebView2 is not { } core) {
      return null;
    }
    // ExecuteScriptAsync doesn't await promises; Runtime.evaluate does.
    var request = new JsonObject {
      ["expression"] = expression,
      ["awaitPromise"] = true,
      ["returnByValue"] = true,
    };
    string json =
        await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate", request.ToJsonString());
    return JsonNode.Parse(json)?["result"]?["value"];
  }

  private static string BridgeScript() {
    using Stream script =
        Assembly.GetExecutingAssembly().GetManifestResourceStream(_bridgeResource)!;
    return new StreamReader(script).ReadToEnd();
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
    if (_web.CoreWebView2 is not { } core) {
      return;  // WarmUpAsync injects the saved copy
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
    Notice?.Invoke(connected ? (stale ? SessionNotice.Refreshing : SessionNotice.SignIn)
                   : installed ? SessionNotice.WaitingForBrowser
                   : SessionNotice.Setup);
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

  /// <summary>Calls the bridge glic_bridge.js installs, if the current page has it yet.</summary>
  private Task CallBridge(string call) {
    if (_web.CoreWebView2 is not { } core) {
      return Task.CompletedTask;
    }
    return core.ExecuteScriptAsync($"{_bridge} && {_bridge}.{call}");
  }

  // ---- messages from the page ----

  private void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e) {
    JsonNode? m;
    try {
      m = JsonNode.Parse(e.WebMessageAsJson);
    } catch {
      return;
    }
    if (m is null) {
      return;
    }
    switch (WireName.Parse<PageMessageKind>(m["kind"]?.GetValue<string>())) {
      case PageMessageKind.Capture:
        SendFrame(m["id"]!.GetValue<int>());
        break;
      case PageMessageKind.Booted:
        OnBooted();
        break;
      case PageMessageKind.Ready:
        Log.Write("glic: live");
        _ready?.TrySetResult();
        break;
      case PageMessageKind.State:
        State?.Invoke(WireName.Parse<GlicState>(m["state"]!.GetValue<string>()) ?? GlicState.Idle);
        break;
      case PageMessageKind.Transcript:
        Caption?.Invoke(m["text"]!.GetValue<string>(),
                        WireName.Parse<TranscriptDirection>(m["direction"]?.GetValue<string>())
                            == TranscriptDirection.User,
                        m["index"]!.GetValue<int>());
        break;
      case PageMessageKind.Error:
        OnPageError(m["message"]?.GetValue<string>() ?? "Gemini error");
        break;
    }
  }

  private void OnBooted() {
    _booted = true;
    Log.Write("glic: host adopted");
    if (_microphoneId is not null) {
      SetMicrophone(_microphoneId);
    }
    if (Active && !_unavailable) {
      _ = CallBridge("start()");
    }
  }

  private void OnPageError(string message) {
    Log.Write($"glic error: {message}");
    // Signed out or a stale session: get the browser's current one.
    if (PageErrors.GetValueOrDefault(message) is PageError.SignedOut or PageError.Unavailable) {
      _unavailable = true;
      WaitForSession();
      return;
    }
    if (!Active) {
      return;
    }
    _ready?.TrySetException(new InvalidOperationException(message));
    Failed?.Invoke(message);
  }

  private void SendFrame(int id) {
    MonitorInfo monitor = Monitor;
    Task.Run(() => TryGrab(monitor))
        .ContinueWith(t => PostFrame(id, t.Result),
                      TaskScheduler.FromCurrentSynchronizationContext());
  }

  private static ScreenGrabber.Frame? TryGrab(MonitorInfo monitor) {
    try {
      return ScreenGrabber.Grab(monitor);
    } catch (Exception e) {
      Log.Write($"grab failed: {e.Message}");
      return null;
    }
  }

  private void PostFrame(int id, ScreenGrabber.Frame? frame) {
    var reply = new JsonObject {
      ["kind"] = WireName.Of(PageMessageKind.Frame),
      ["id"] = id,
      ["base64"] = frame is null ? null : Convert.ToBase64String(frame.Jpeg),
      ["mimeType"] = ScreenGrabber.MimeType,
      ["width"] = frame?.Width ?? 0,
      ["height"] = frame?.Height ?? 0,
    };
    _web.CoreWebView2?.PostWebMessageAsJson(reply.ToJsonString());
  }

  /// <summary>Off-screen but "shown", so Chromium keeps the page running at full speed.</summary>
  private void Park() {
    Overlay.Place(_hwnd, _parkedAt, _parkedAt, _pageWidth, _pageHeight);
  }
}
