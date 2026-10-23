using System.Reflection;
using System.Text.Json.Nodes;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace GeminiLive.Glic;

/// <summary>Why a host stopped trying to bring its crashed WebView2 back.</summary>
public enum RecoveryFailure { CrashLoop, RebuildFailed }

/// <summary>
/// A parked, off-screen window hosting a WebView2 that rides the browser's Google session - the base
/// of Gemini's glic page (<see cref="GlicHost"/>) and the Home page (<see cref="HomeHost"/>). It owns
/// what is identical between them: the window chrome, the Chromium flags, the cookie-rotation block,
/// the injected bridge and the typed <see cref="Messenger"/> to it, and surviving a crashed browser
/// process.
///
/// A browser-process crash leaves the WPF control permanently invalid - every later touch, including
/// re-initialising it, throws - so recovery replaces the control itself, never just its core.
/// </summary>
/// <typeparam name="TMessage">The page protocol's message types.</typeparam>
public abstract class GoogleWebViewHost<TMessage> : Window where TMessage : struct, Enum {
  // Parked off-screen reads as occluded, which would throttle the page's timers; the voice must also
  // play without a click inside the page. Both matter for glic and are harmless for Home.
  private const string _arguments =
      "--autoplay-policy=no-user-gesture-required "
      + "--disable-features=CalculateNativeWinOcclusion "
      + "--disable-background-timer-throttling --disable-renderer-backgrounding";
  private const string _rotateCookiesFilter = "https://accounts.google.com/RotateCookies*";
  private const int _parkedAt = -32000;
  private const int _maxCrashStreak = 3;
  private static readonly TimeSpan _crashWindow = TimeSpan.FromSeconds(30);

  private readonly string _logTag;
  private readonly string _profile;
  private readonly string _bridgeResource;
  private readonly int _pageWidth;
  private readonly int _pageHeight;
  private readonly IntPtr _hwnd;
  private WebView2? _web;
  private Task? _building;
  private DateTime _lastCrash = DateTime.MinValue;
  private int _crashStreak;

  /// <summary>
  /// The live engine, or null before warm-up and while a crashed browser is being replaced. Always
  /// reach the page through this, never the control: a dead control throws on every access.
  /// </summary>
  protected CoreWebView2? Core { get; private set; }

  /// <summary>
  /// Messages to and from the page's bridge. A message sent while the page navigates is lost, so
  /// every send times out.
  /// </summary>
  protected Messenger<TMessage> Messenger { get; }

  protected GoogleWebViewHost(string title, string logTag, string profileDir,
                              string bridgeResource, int pageWidth, int pageHeight,
                              TimeSpan messageTimeout) {
    Messenger = new Messenger<TMessage>(json => Core?.PostWebMessageAsJson(json), messageTimeout);
    _logTag = logTag;
    _profile = profileDir;
    _bridgeResource = bridgeResource;
    _pageWidth = pageWidth;
    _pageHeight = pageHeight;
    Title = title;
    Width = pageWidth;
    Height = pageHeight;
    ShowInTaskbar = false;
    ShowActivated = false;
    WindowStartupLocation = WindowStartupLocation.Manual;
    // A tool window, so the parked page never turns up in Alt+Tab or Task View.
    _hwnd = Overlay.Prepare(this, clickThrough: false);
    Closing += (_, e) => {
      e.Cancel = true;
      Park();
    };
  }

  /// <summary>Boots the engine at app start, so the first use doesn't wait for Chromium.</summary>
  public async Task WarmUpAsync() {
    Show();
    Park();
    await EnsureCoreAsync();
  }

  /// <summary>
  /// Wires up a freshly built engine - page-specific handlers, session, first navigation. Runs at
  /// warm-up and after every rebuild.
  /// </summary>
  protected abstract void OnCoreReady(CoreWebView2 core);

  /// <summary>A crash is being recovered from; the page is about to reload.</summary>
  protected virtual void OnRecovering() { }

  /// <summary>Recovery gave up; the next <see cref="EnsureCoreAsync"/> tries again.</summary>
  protected virtual void OnRecoveryFailed(RecoveryFailure failure, Exception? cause) { }

  /// <summary>
  /// Brings the engine up if it isn't: at warm-up, or when a use finds it down after a crash that
  /// recovery gave up on. Joins a build already in flight rather than starting a second.
  /// </summary>
  protected async Task EnsureCoreAsync() {
    if (Core is not null) {
      return;
    }
    if (_building is { } pending) {
      await pending;
      return;
    }
    _building = BuildAsync();
    try {
      await _building;
    } finally {
      _building = null;
    }
  }

  private async Task BuildAsync() {
    Core = null;
    var web = new WebView2();
    if (_web is { } dead) {
      try {
        dead.Dispose();
      } catch (Exception e) {
        Log.Write($"{_logTag}: disposing the crashed control: {e.Message}");
      }
    }
    _web = web;
    Content = web;
    if (!web.IsLoaded) {
      var loaded = new TaskCompletionSource();
      web.Loaded += (_, _) => loaded.TrySetResult();
      await loaded.Task;
    }

    // Port 0: Chromium picks a free port, so debugging never collides with another app's.
    string arguments = _arguments + (Log.Debugging ? " --remote-debugging-port=0" : "");
    CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(
        null, _profile, new CoreWebView2EnvironmentOptions(arguments));
    await web.EnsureCoreWebView2Async(env);
    CoreWebView2 core = web.CoreWebView2;
    if (Log.Debugging) {
      LogDebugPort(env.UserDataFolder);
    }

    core.Settings.AreDevToolsEnabled = Log.Debugging;
    core.Settings.IsStatusBarEnabled = false;
    core.ProcessFailed += OnProcessFailed;
    core.WebMessageReceived += (_, e) => Messenger.Receive(e.WebMessageAsJson);
    // This WebView2 only ever adopts the rotations the browser makes; two writers would invalidate
    // each other's session.
    core.AddWebResourceRequestedFilter(_rotateCookiesFilter, CoreWebView2WebResourceContext.All);
    core.WebResourceRequested += (_, e) =>
        e.Response = env.CreateWebResourceResponse(null, 204, "No Content", "");
    await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript());

    Core = core;
    OnCoreReady(core);
  }

  /// <summary>
  /// Logs the port Chromium picked for CDP, which it writes to DevToolsActivePort (port, then the
  /// browser target's path) in the user data folder.
  /// </summary>
  private void LogDebugPort(string userDataFolder) {
    try {
      string port = File.ReadLines(Path.Combine(userDataFolder, "DevToolsActivePort")).First();
      Log.Write($"{_logTag}: devtools on localhost:{port}");
    } catch (Exception e) {
      Log.Write($"{_logTag}: devtools port unknown: {e.Message}");
    }
  }

  /// <summary>
  /// A browser or render process died. A render crash reloads the page in place; a browser crash
  /// kills the whole control, so it is replaced. Repeated crashes in a short window stop looping.
  /// </summary>
  private async void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e) {
    Log.Write($"{_logTag}: process failed ({e.ProcessFailedKind})");
    bool browserDied = e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited;
    if (browserDied) {
      Core = null;
    }
    DateTime now = DateTime.UtcNow;
    _crashStreak = now - _lastCrash < _crashWindow ? _crashStreak + 1 : 1;
    _lastCrash = now;
    if (_crashStreak > _maxCrashStreak) {
      Log.Write($"{_logTag}: crashing repeatedly; waiting for the next use to retry");
      OnRecoveryFailed(RecoveryFailure.CrashLoop, null);
      return;
    }

    OnRecovering();
    try {
      if (browserDied) {
        await EnsureCoreAsync();
      } else {
        Core?.Reload();  // a render or utility process died but the engine is intact
      }
    } catch (Exception ex) {
      Log.Write($"{_logTag}: recovery failed: {ex.Message}");
      OnRecoveryFailed(RecoveryFailure.RebuildFailed, ex);
    }
  }

  /// <summary>Evaluates an expression in the page, awaiting a promise, and returns its value.</summary>
  protected async Task<JsonNode?> EvalAsync(string expression) {
    if (Core is not { } core) {
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

  private string BridgeScript() {
    using Stream script =
        Assembly.GetExecutingAssembly().GetManifestResourceStream(_bridgeResource)!;
    return new StreamReader(script).ReadToEnd();
  }

  /// <summary>Off-screen but "shown", so Chromium keeps the page running at full speed.</summary>
  private void Park() {
    Overlay.Place(_hwnd, _parkedAt, _parkedAt, _pageWidth, _pageHeight);
  }
}
