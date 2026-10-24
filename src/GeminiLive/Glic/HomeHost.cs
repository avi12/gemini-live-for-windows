using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;

namespace GeminiLive.Glic;

/// <summary>
/// Controls the account's Google Home devices by driving the real Home web app (home.google.com)
/// in a hidden WebView2 - the same "ride the browser's Google session" approach as
/// <see cref="GlicHost"/>, for the one thing Gemini's text path can't reach. The page owns auth and
/// the device graph; <c>home_bridge.js</c> finds a tile and reads its lit state when asked over the
/// <see cref="HomeProtocol"/> messages, and we flip it with a trusted click. The page is loaded on
/// demand, never kept live in the background. PC lights only.
/// </summary>
public sealed class HomeHost : GoogleWebViewHost<HomeMessage> {
  private const string _homeUrl = "https://home.google.com/";
  private const string _bridgeResource = "GeminiLive.Glic.home_bridge.js";
  private const int _pageWidth = 1100;  // wide enough that the device grid lays out, not the phone view
  private const int _pageHeight = 900;
  // Readiness is polled while the page loads, when messages are dropped; fail fast and poll again.
  private static readonly TimeSpan _messageTimeout = TimeSpan.FromSeconds(1);
  private static readonly string _profile = Path.Combine(Log.Dir, "WebView2Home");
  private static readonly TimeSpan _readyPoll = TimeSpan.FromMilliseconds(400);
  private static readonly TimeSpan _readyTimeout = TimeSpan.FromSeconds(20);
  private static readonly TimeSpan _settle = TimeSpan.FromMilliseconds(1600);  // tile reflects the new state

  public HomeHost(SessionLink link)
      : base("Gemini Live - Home", "home", _profile, _bridgeResource, _pageWidth,
             _pageHeight, _messageTimeout) {
    link.CookiesReceived += cookies => Dispatcher.BeginInvoke(() => AdoptSession(cookies));
  }

  /// <summary>
  /// Sets the PC lights on or off, returning a short line to speak. Reads the tile's state first,
  /// so an already-correct light is a no-op instead of a toggle the wrong way.
  /// </summary>
  public async Task<string> SetLightsAsync(bool on) {
    await EnsureHomeAsync();

    if (!await WaitReadyAsync()) {
      return "I couldn't reach your Google Home.";
    }

    PcLights? state = await ReadLightsAsync();
    if (state is not { Found: true }) {
      return "I couldn't find the PC lights.";
    }

    string name = state.Name ?? "PC lights";
    Log.Write($"home: {name} text='{state.Text}' on={state.On}");

    if (state.On is null) {
      return $"I couldn't tell whether the {name} are on.";
    }

    if (state.On == on) {
      return $"The {name} are already {OnOff(on)}.";
    }

    await ClickAsync(state.X, state.Y);
    await Task.Delay(_settle);
    PcLights? after = await ReadLightsAsync();
    if (after is not { Found: true, On: { } nowOn }) {
      return "I couldn't confirm the lights changed.";
    }

    Log.Write($"home: {name} after text='{after.Text}' on={nowOn}");
    return nowOn == on ? $"Turned the {name} {OnOff(on)}." : "I couldn't switch the lights.";
  }

  private static string OnOff(bool on) => on ? "on" : "off";

  /// <summary>The PC Lights tile as the page reads it, or null when the page didn't answer.</summary>
  private Task<PcLights?> ReadLightsAsync() {
    return Log.AttemptAsync("home: reading the lights",
                            () => Messenger.SendMessageAsync(HomeProtocol.PcLights));
  }

  // The engine is up; the Home page itself loads on demand (see EnsureHomeAsync), so leave it blank.
  // Home is idle most of the time, so a crash has no session to resume - the next command reloads it.
  protected override void OnCoreReady(CoreWebView2 core) {
    GoogleCookies.Inject(core.CookieManager, GoogleCookies.Load());
  }

  // Loads Home on demand with the current session and only when we're not already on the signed-in
  // device view - first use, or after a stale session bounced the page to the welcome screen. This
  // keeps us off home.google.com in the background, where a second live Google tab could disturb
  // glic's session. Brings the engine back first if a crash took it down.
  private async Task EnsureHomeAsync() {
    await EnsureCoreAsync();

    if (Core is not { } core) {
      return;
    }

    GoogleCookies.Inject(core.CookieManager, GoogleCookies.Load());

    if (!(core.Source ?? "").StartsWith(_homeUrl + "home", StringComparison.Ordinal)) {
      core.Navigate(_homeUrl);
      await Task.Delay(_settle);  // let the navigation start before we poll readiness
    }
  }

  private void AdoptSession(IReadOnlyList<GoogleCookie> cookies) {
    if (Core is { } core) {
      GoogleCookies.Inject(core.CookieManager, cookies);  // keep in step with the browser's session
    }
  }

  private async Task<bool> WaitReadyAsync() {
    DateTime deadline = DateTime.UtcNow + _readyTimeout;
    while (DateTime.UtcNow < deadline) {
      if (Core is null) {
        return false;
      }

      if (await IsReadyAsync()) {
        return true;
      }

      await Task.Delay(_readyPoll);
    }
    return false;
  }

  // While the page is still loading the bridge isn't listening yet (no listener) or the message is
  // lost to the navigation (timeout); either just means not ready yet.
  private async Task<bool> IsReadyAsync() {
    try {
      return await Messenger.SendMessageAsync(HomeProtocol.Ready);
    } catch (Exception e) when (e is TimeoutException or InvalidOperationException) {
      return false;
    }
  }

  // The Home tiles ignore synthetic DOM clicks, so flip the light with a trusted CDP mouse event -
  // the same reason glic types with trusted key events.
  private async Task ClickAsync(int x, int y) {
    if (Core is not { } core) {
      return;
    }

    foreach (string type in new[] { "mousePressed", "mouseReleased" }) {
      var e = new JsonObject {
        ["type"] = type,
        ["x"] = x,
        ["y"] = y,
        ["button"] = "left",
        ["buttons"] = 1,
        ["clickCount"] = 1,
      };
      await core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", e.ToJsonString());
    }
  }
}
