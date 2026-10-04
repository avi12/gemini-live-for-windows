using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace GeminiLive.Glic;

/// <summary>
/// Hosts the real Gemini web client (gemini.google.com/glic - what powers Gemini in Chrome) in a
/// WebView2 that lives off-screen for the whole app lifetime, so Win+C starts Live without a page
/// load. The page owns mic, echo cancellation, the Live connection and Gemini's voice; we supply
/// the screen frames it pulls and read back state + captions. It only comes on-screen to let you
/// sign in to Google.
/// </summary>
public sealed class GlicHost : Window
{
    const string GlicUrl = "https://gemini.google.com/glic";
    const string SignInUrl = "https://accounts.google.com/ServiceLogin?continue=" + GlicUrl;
    static readonly string Profile = Path.Combine(Log.Dir, "WebView2");
    static bool Debugging => Log.Debugging;

    readonly WebView2 _web = new();
    readonly TextBlock _banner = new()
    {
        Text = "Sign in to Google for Gemini Live. This window closes by itself when you're done.",
        Padding = new Thickness(12, 8, 12, 8), FontSize = 13,
    };
    readonly IntPtr _hwnd;
    TaskCompletionSource? _ready;
    bool _booted, _signingIn, _reauthTried, _signInPending;

    /// <summary>Which display the frames come from.</summary>
    public MonitorInfo Monitor { get; set; } = Monitors.All()[0];
    public bool Active { get; private set; }

    public event Action<string>? State;               // listening | paused | idle
    public event Action<string, bool, int>? Caption;  // text, isUser, utterance index
    public event Action<string>? Failed;
    public event Action? SignInNeeded;

    public GlicHost()
    {
        Title = "Gemini Live - Google sign-in";
        Width = 900; Height = 720;
        ShowInTaskbar = false;
        ShowActivated = false;
        WindowStartupLocation = WindowStartupLocation.Manual;
        var dock = new DockPanel();
        DockPanel.SetDock(_banner, Dock.Top);
        _banner.Visibility = Visibility.Collapsed;
        dock.Children.Add(_banner);
        dock.Children.Add(_web);
        Content = dock;
        _hwnd = new System.Windows.Interop.WindowInteropHelper(this).EnsureHandle();
        Closing += (_, e) => { e.Cancel = true; Park(); }; // closing the sign-in window just hides it
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
            (Debugging ? " --remote-debugging-port=9333" : ""));
        var env = await CoreWebView2Environment.CreateAsync(null, Profile, options);
        await _web.EnsureCoreWebView2Async(env);
        var core = _web.CoreWebView2;

        core.Settings.AreDevToolsEnabled = Debugging;
        core.Settings.IsStatusBarEnabled = false;
        // A parked window can never show a permission prompt, so grant the mic up front.
        core.PermissionRequested += (_, e) =>
        {
            if (e.PermissionKind is CoreWebView2PermissionKind.Microphone) e.State = CoreWebView2PermissionState.Allow;
        };
        core.WebMessageReceived += OnMessage;
        core.NavigationCompleted += (_, _) => OnNavigated();
        await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript());

        if (!await GoogleCookies.IsSignedInAsync(core.CookieManager))
            GoogleCookies.ImportFromAgenticGamingAssistant(core.CookieManager);

        core.Navigate(GlicUrl);
    }

    static string BridgeScript()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("GeminiLive.Glic.glic_bridge.js")!;
        return new StreamReader(s).ReadToEnd();
    }

    // ---- session control ----

    /// <summary>Starts Live; completes once Gemini is actually listening.</summary>
    public Task StartAsync()
    {
        Active = true;
        _ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        if (_signInPending) BeginSignIn();
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
                if (_signingIn) EndSignIn();
                if (Active) _ = Eval("window.__glicBridge.start()");
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
                if (message == "signed-out") BeginSignIn();
                // Usually a stale session: re-authenticating fixes it. Only try that once per run.
                else if (message == "unavailable" && !_reauthTried) { _reauthTried = true; BeginSignIn(); }
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

    // ---- sign-in ----

    void OnNavigated()
    {
        var host = new Uri(_web.CoreWebView2.Source).Host;
        Log.Write($"glic: at {host}");
        if (host == "accounts.google.com") BeginSignIn();
    }

    void BeginSignIn()
    {
        // Never pop a sign-in window on our own during warm-up; wait for the user's Win+C.
        if (!Active) { _signInPending = true; return; }
        _signInPending = false;
        if (_signingIn) return;
        _signingIn = true;
        _booted = false;
        Log.Write("glic: needs Google sign-in");
        SignInNeeded?.Invoke();
        if (new Uri(_web.CoreWebView2.Source).Host != "accounts.google.com") _web.CoreWebView2.Navigate(SignInUrl);

        // Bring it on-screen, centred on the display the user is looking at.
        _banner.Visibility = Visibility.Visible;
        var m = Monitors.Active();
        Overlay.Place(_hwnd, m.X + (m.Width - 900) / 2, m.Y + (m.Height - 760) / 2, 900, 760);
        Native.SetForegroundWindow(_hwnd);
        Activate();
    }

    void EndSignIn()
    {
        _signingIn = false;
        _banner.Visibility = Visibility.Collapsed;
        Park();
        Log.Write("glic: signed in");
    }

    /// <summary>Off-screen but "shown", so Chromium keeps the page running at full speed.</summary>
    void Park() => Overlay.Place(_hwnd, -32000, -32000, 900, 720);
}
