using System.Text.RegularExpressions;
using System.Windows.Threading;

namespace GeminiLive.Glic;

/// <summary>
/// The Google-account engine: one Live session on the long-lived <see cref="GlicHost"/>. Gemini's
/// own client does the audio, so there are no levels to show; captions arrive as whole utterances.
/// Requests Live can't serve (<see cref="SpokenIntent"/>) take a detour: the PC lights through
/// <see cref="HomeHost"/>, Google apps through Gemini's text path.
/// </summary>
public sealed partial class GlicConversation : ILiveEngine {
  public event Action<string>? Status;
  public event Action<string, bool>? Transcript;
  public event Action<float, bool>? Level {
    add { }
    remove { }
  }
  public event Action<string>? Ended;

  // Long enough that the user's utterance has settled before we act on it, short enough to beat
  // Gemini's spoken refusal most of the time.
  private static readonly TimeSpan _intentSettle = TimeSpan.FromMilliseconds(1100);

  private readonly GlicHost _host;
  private readonly HomeHost _home;
  private readonly DispatcherTimer _intentTimer;
  private readonly SpeechPlayer _speech = new();

  private bool _muted;
  private string _lastUserUtterance = "";
  private string _handledUtterance = "";
  private int _handledRefusalIndex = -1;
  private bool _runningDetour;

  public GlicConversation(GlicHost host, HomeHost home, MonitorInfo monitor) {
    _host = host;
    _home = home;
    host.View.Monitor = monitor;
    host.State += OnState;
    host.Caption += OnCaption;
    host.Failed += OnFailed;
    host.Notice += OnNotice;
    _intentTimer = new DispatcherTimer { Interval = _intentSettle };
    _intentTimer.Tick += OnIntentSettled;
  }

  public MonitorInfo Monitor => _host.View.Monitor;

  public bool Muted {
    get => _muted;
    set {
      _muted = value;
      _host.SetMuted(value);
    }
  }

  public bool ReportsLevels => false;

  // No timeout here: the page reports its own start failure, and waiting for the browser's
  // Google session (extension not yet connected, user signing in) can legitimately take a while.
  public Task StartAsync() {
    return _host.StartAsync();
  }

  public void Share(MonitorInfo monitor) {
    _host.View.Monitor = monitor;
  }

  public ValueTask DisposeAsync() {
    _intentTimer.Stop();
    _speech.Dispose();
    _host.State -= OnState;
    _host.Caption -= OnCaption;
    _host.Failed -= OnFailed;
    _host.Notice -= OnNotice;
    _host.Stop();
    return ValueTask.CompletedTask;
  }

  private void OnState(GlicState state) {
    Status?.Invoke(state == GlicState.Listening ? LiveStatus.Listening : LiveStatus.Resuming);
  }

  // Glic's captions are markdown source ("17\.3"); show them as the words that were spoken.
  private void OnCaption(string text, bool isUser, int index) {
    string clean = MarkdownEscape().Replace(text, "$1");
    Transcript?.Invoke(clean, isUser);

    if (isUser) {
      _speech.Stop();  // the user is talking; don't read over them
      // Act on the request as soon as it settles, before Gemini can say it can't (proactive). The
      // utterance revises in place, so restart the settle timer on each update.
      _lastUserUtterance = clean;

      if (!_runningDetour) {
        _intentTimer.Stop();
        _intentTimer.Start();
      }
    } else if (SpokenIntent.NeedsApp(clean) && index != _handledRefusalIndex
               && _lastUserUtterance.Length > 0) {
      // Fallback: Gemini got there first and refused. Fix it with the text path.
      _handledRefusalIndex = index;
      _ = RunAppActionAsync(_lastUserUtterance);
    }
  }

  // The user's request has stopped changing: if it plainly targets a Google app, handle it now.
  private void OnIntentSettled(object? sender, EventArgs e) {
    _intentTimer.Stop();

    if (_runningDetour || _lastUserUtterance == _handledUtterance) {
      return;
    }

    if (SpokenIntent.TryLightsCommand(_lastUserUtterance, out bool on)) {
      _ = RunLightsAsync(_lastUserUtterance, on);
      return;
    }

    if (SpokenIntent.TargetsApp(_lastUserUtterance)) {
      _ = RunAppActionAsync(_lastUserUtterance);
    }
  }

  /// <summary>
  /// Runs one detour at a time. The request is marked handled up front, so neither trigger
  /// re-fires for it.
  /// </summary>
  private async Task RunDetourAsync(string request, string status, Func<Task> detour) {
    if (_runningDetour) {
      return;
    }

    _runningDetour = true;
    _handledUtterance = request;
    Status?.Invoke(status);
    try {
      await detour();
    } finally {
      _runningDetour = false;
    }
  }

  // Live has no access to the account's Google apps; its text turns do. When Gemini says it can't
  // reach Calendar, Keep, Tasks or Gmail, re-run the user's request on the text path, speak
  // the answer back into the card, and resume Live - which keeps the answer in context.
  private Task RunAppActionAsync(string request) {
    return RunDetourAsync(request, $"Checking {SpokenIntent.AppName(request)}…",
                          () => AskTextPathAsync(request));
  }

  private async Task AskTextPathAsync(string request) {
    try {
      string answer = await _host.RunActionAsync(request);
      Log.Write($"app action: {answer.Length} chars back");

      if (answer.Length > 0) {
        Transcript?.Invoke(answer, false);
        _ = _speech.SpeakAsync(answer);  // Live can't speak it on resume, so read it aloud
      }

      await _host.StartAsync();  // resume Live, now holding the answer in context
      Status?.Invoke(LiveStatus.Listening);
    } catch (Exception e) {
      Log.Write($"app action failed: {e.Message}");
      Status?.Invoke(LiveStatus.Listening);
      _ = _host.StartAsync();
    }
  }

  // The PC lights live in Google Home, which Gemini's text path can't reach; flip them on the Home
  // web app instead and speak the result. Unlike an app action this runs off the Live page, so Live
  // keeps listening and the spoken result simply lands over it.
  private Task RunLightsAsync(string request, bool on) {
    return RunDetourAsync(request, $"Turning the lights {(on ? "on" : "off")}…",
                          () => SwitchLightsAsync(on));
  }

  private async Task SwitchLightsAsync(bool on) {
    try {
      string answer = await _home.SetLightsAsync(on);
      Transcript?.Invoke(answer, false);
      await _speech.SpeakAsync(answer);
    } catch (Exception e) {
      Log.Write($"lights action failed: {e.Message}");
      const string trouble = "I had trouble reaching the lights.";
      Transcript?.Invoke(trouble, false);
      await _speech.SpeakAsync(trouble);
    } finally {
      Status?.Invoke(LiveStatus.Listening);
    }
  }

  private void OnFailed(string message) {
    Ended?.Invoke(message);
  }

  private void OnNotice(string notice) {
    Status?.Invoke(notice);
  }

  [GeneratedRegex(@"\\([\\`*_{}\[\]()#+\-.!>|~])")]
  private static partial Regex MarkdownEscape();
}
