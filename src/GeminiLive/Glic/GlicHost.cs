using System.Reflection;
using System.Text.Json.Nodes;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

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
public sealed class GlicHost : Window
{
    const string GlicUrl = "https://gemini.google.com/glic";
    const string RotateCookiesFilter = "https://accounts.google.com/RotateCookies*";
    static readonly string Profile = Path.Combine(Log.Dir, "WebView2");

    readonly WebView2 _web = new();
    readonly SessionLink _link;
    readonly IntPtr _hwnd;
    TaskCompletionSource? _ready;
    IReadOnlyList<GoogleCookie> _session = [];
    string _sessionPrint = "";
    bool _booted, _unavailable;

    /// <summary>Which display the frames come from.</summary>
    public MonitorInfo Monitor { get; set; } = Monitors.All()[0];
    public bool Active { get; private set; }

    public event Action<string>? State;               // listening | paused | idle
    public event Action<string, bool, int>? Caption;  // text, isUser, utterance index
    public event Action<string>? Notice;              // waiting-for-session style status, not fatal
    public event Action<string>? Failed;

    public GlicHost(SessionLink link)
    {
        _link = link;
        Title = "Gemini Live - web client";
        Width = 900; Height = 720;
        ShowInTaskbar = false;
        ShowActivated = false;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Content = _web;
        _hwnd = new System.Windows.Interop.WindowInteropHelper(this).EnsureHandle();
        Closing += (_, e) => { e.Cancel = true; Park(); };
        link.CookiesReceived += cookies => Dispatcher.BeginInvoke(() => AdoptSession(cookies));
    }

    /// <summary>Boots WebView2 and loads Gemini. Called once at app start so Win+C is instant later.</summary>
    public async Task WarmUpAsync()
    {
        Show();
        Park();
        if (!_web.IsLoaded)
        {
            var loaded = new TaskCompletionSource();
            _web.Loaded += (_, _) => loaded.TrySetResult();
            await loaded.Task;
        }

        // Parked off-screen reads as "occluded" to Chromium, which would throttle the page's timers;
        // Gemini's voice must also play without a click inside the page.
        var options = new CoreWebView2EnvironmentOptions(
            "--autoplay-policy=no-user-gesture-required --disable-features=CalculateNativeWinOcclusion " +
            "--disable-background-timer-throttling --disable-renderer-backgrounding" +
            (Log.Debugging ? " --remote-debugging-port=9333" : ""));
        var env = await CoreWebView2Environment.CreateAsync(null, Profile, options);
        await _web.EnsureCoreWebView2Async(env);
        var core = _web.CoreWebView2;

        core.Settings.AreDevToolsEnabled = Log.Debugging;
        core.Settings.IsStatusBarEnabled = false;
        // A parked window can never show a permission prompt, so grant the mic up front.
        core.PermissionRequested += (_, e) =>
        {
            if (e.PermissionKind is CoreWebView2PermissionKind.Microphone) e.State = CoreWebView2PermissionState.Allow;
        };
        // The browser owns cookie rotation; see the class comment.
        core.AddWebResourceRequestedFilter(RotateCookiesFilter, CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) =>
            e.Response = env.CreateWebResourceResponse(null, 204, "No Content", "");
        core.WebMessageReceived += OnMessage;
        await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript());

        _session = GoogleCookies.Load();
        _sessionPrint = GoogleCookies.Fingerprint(_session);
        GoogleCookies.Inject(core.CookieManager, _session);
        Log.Write($"glic: {_session.Count} saved Google cookies, extension connected={_link.IsExtensionConnected}");
        core.Navigate(GlicUrl);
    }

    static string BridgeScript()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("GeminiLive.Glic.glic_bridge.js")!;
        return new StreamReader(s).ReadToEnd();
    }

    // ---- the browser's Google session ----

    void AdoptSession(IReadOnlyList<GoogleCookie> cookies)
    {
        var print = GoogleCookies.Fingerprint(cookies);
        if (print == _sessionPrint) return;
        _session = cookies;
        _sessionPrint = print;
        GoogleCookies.Save(cookies);
        if (_web.CoreWebView2 is not { } core) return; // WarmUpAsync injects the saved copy

        GoogleCookies.Inject(core.CookieManager, cookies);
        Log.Write("glic: session updated from the browser");
        // A page that loaded without a valid session has to start over with this one.
        if (!_booted || _unavailable)
        {
            _unavailable = false;
            core.Navigate(GlicUrl);
        }
    }

    // ---- session control ----

    /// <summary>Starts Live; completes once Gemini is actually listening.</summary>
    public Task StartAsync()
    {
        Active = true;
        _ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        if (_unavailable || !GoogleCookies.HasSession(_session)) WaitForSession();
        else if (_booted) _ = Eval("window.__glicBridge && window.__glicBridge.start()");
        // else: OnMessage("booted") starts it as soon as the page is up.
        return _ready.Task;
    }

    public void Stop()
    {
        Active = false;
        _ready?.TrySetCanceled();
        _ = Eval("window.__glicBridge && window.__glicBridge.stop()");
    }

    public void SetMuted(bool muted) => _ = Eval($"window.__glicBridge && window.__glicBridge.setMuted({(muted ? "true" : "false")})");

    Task Eval(string js) => _web.CoreWebView2 is { } core ? core.ExecuteScriptAsync(js) : Task.CompletedTask;

    /// <summary>No usable session yet: say why, and ask the extension for a fresh one.</summary>
    void WaitForSession()
    {
        if (!Active) return;
        Notice?.Invoke(_link.IsExtensionConnected
            ? "Sign in to Google in your browser - Gemini Live picks it up automatically"
            : "Waiting for the Gemini Live browser extension (see README)");
        _link.RequestCookies();
    }

    // ---- messages from the page ----

    void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonNode? m;
        try { m = JsonNode.Parse(e.WebMessageAsJson); } catch { return; }
        switch (m?["kind"]?.GetValue<string>())
        {
            case "capture":
                SendFrame(m["id"]!.GetValue<int>());
                break;
            case "booted":
                _booted = true;
                Log.Write("glic: host adopted");
                if (Active && !_unavailable) _ = Eval("window.__glicBridge.start()");
                break;
            case "ready":
                Log.Write("glic: live");
                _ready?.TrySetResult();
                break;
            case "state":
                State?.Invoke(m["state"]!.GetValue<string>());
                break;
            case "transcript":
                Caption?.Invoke(m["text"]!.GetValue<string>(), m["direction"]?.GetValue<string>() == "user", m["index"]!.GetValue<int>());
                break;
            case "error":
                var message = m["message"]?.GetValue<string>() ?? "Gemini error";
                Log.Write($"glic error: {message}");
                // Signed out or a stale session: wait for the browser's current one.
                if (message is "signed-out" or "unavailable") { _unavailable = true; WaitForSession(); }
                else if (Active) { _ready?.TrySetException(new InvalidOperationException(message)); Failed?.Invoke(message); }
                break;
        }
    }

    void SendFrame(int id)
    {
        var monitor = Monitor;
        Task.Run(() =>
        {
            try { return ScreenGrabber.Grab(monitor); }
            catch (Exception ex) { Log.Write($"grab failed: {ex.Message}"); return null; }
        }).ContinueWith(t =>
        {
            var f = t.Result;
            var reply = new JsonObject
            {
                ["kind"] = "frame", ["id"] = id,
                ["base64"] = f is null ? null : Convert.ToBase64String(f.Jpeg),
                ["mimeType"] = ScreenGrabber.MimeType,
                ["width"] = f?.Width ?? 0, ["height"] = f?.Height ?? 0,
            };
            _web.CoreWebView2?.PostWebMessageAsJson(reply.ToJsonString());
        }, TaskScheduler.FromCurrentSynchronizationContext());
    }

    /// <summary>Off-screen but "shown", so Chromium keeps the page running at full speed.</summary>
    void Park() => Overlay.Place(_hwnd, -32000, -32000, 900, 720);
}
