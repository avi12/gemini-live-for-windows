using System.Text.RegularExpressions;
using System.Windows.Threading;

namespace GeminiLive.Glic;

/// <summary>
/// The Google-account engine: one Live session on the long-lived <see cref="GlicHost"/>. Gemini's
/// own client does the audio, so there are no levels to show; captions arrive as whole utterances.
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
  private readonly DispatcherTimer _intentTimer;
  private readonly SpeechPlayer _speech = new();

  public GlicConversation(GlicHost host, MonitorInfo monitor) {
    _host = host;
    host.Monitor = monitor;
    host.State += OnState;
    host.Caption += OnCaption;
    host.Failed += OnFailed;
    host.Notice += OnNotice;
    _intentTimer = new DispatcherTimer { Interval = _intentSettle };
    _intentTimer.Tick += OnIntentSettled;
  }

  public MonitorInfo Monitor => _host.Monitor;

  public bool Muted {
    get => _muted;
    set {
      _muted = value;
      _host.SetMuted(value);
    }
  }

  public bool ReportsLevels => false;

  private bool _muted;
  private string _lastUserUtterance = "";
  private string _handledUtterance = "";
  private int _handledRefusalIndex = -1;
  private bool _runningAction;

  // No timeout here: the page reports its own start failure, and waiting for the browser's
  // Google session (extension not yet connected, user signing in) can legitimately take a while.
  public Task StartAsync() {
    return _host.StartAsync();
  }

  public void Share(MonitorInfo monitor) {
    _host.Monitor = monitor;
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

  private void OnState(string state) {
    Status?.Invoke(state == "listening" ? LiveStatus.Listening : LiveStatus.Resuming);
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
      if (!_runningAction) {
        _intentTimer.Stop();
        _intentTimer.Start();
      }
    } else if (NeedsApp(clean) && index != _handledRefusalIndex && _lastUserUtterance.Length > 0) {
      // Fallback: Gemini got there first and refused. Fix it with the text path.
      _handledRefusalIndex = index;
      _ = RunAppActionAsync(_lastUserUtterance);
    }
  }

  // The user's request has stopped changing: if it plainly targets a Google app, handle it now.
  private void OnIntentSettled(object? sender, EventArgs e) {
    _intentTimer.Stop();
    if (_runningAction || _lastUserUtterance == _handledUtterance || !TargetsApp(_lastUserUtterance)) {
      return;
    }
    _ = RunAppActionAsync(_lastUserUtterance);
  }

  // Live has no access to the account's Google apps; its text turns do. When Gemini says it can't
  // reach Calendar, Keep, Tasks, Gmail or Home, re-run the user's request on the text path, speak
  // the answer back into the card, and resume Live - which keeps the answer in context.
  private async Task RunAppActionAsync(string request) {
    if (_runningAction) {
      return;
    }
    _runningAction = true;
    _handledUtterance = request;  // so neither trigger re-fires for the same request
    Status?.Invoke($"Checking {AppName(request)}…");
    try {
      string answer = await _host.RunActionAsync(request);
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
    } finally {
      _runningAction = false;
    }
  }

  // Gemini refusing an app it can't reach in Live: a "can't / don't have" paired with an app topic.
  private static bool NeedsApp(string text) {
    return Refusal().IsMatch(text) && AppTopic().IsMatch(text);
  }

  // The user plainly asking an app to do or report something (app topic + an imperative or a
  // question about it) - which Live can't, so handle it on the text path up front.
  private static bool TargetsApp(string text) {
    return AppTopic().IsMatch(text) && Intent().IsMatch(text);
  }

  // The app a request names, for the status line while it runs; ambiguous words fall through.
  private static string AppName(string request) {
    foreach ((Regex pattern, string name) in AppNames) {
      if (pattern.IsMatch(request)) {
        return name;
      }
    }
    return "your Google apps";
  }

  private static readonly (Regex Pattern, string Name)[] AppNames = [
    (new(@"\b(gmail|e-?mail|inbox|mail)\b", RegexOptions.IgnoreCase), "Gmail"),
    (new(@"\b(keep|note|notes)\b", RegexOptions.IgnoreCase), "Keep"),
    (new(@"\b(task|tasks|to-?dos?)\b", RegexOptions.IgnoreCase), "Tasks"),
    (new(@"\b(light|lights|thermostat|device|home)\b", RegexOptions.IgnoreCase), "Google Home"),
    (new(@"\b(calendar|schedule|meeting|event|events)\b", RegexOptions.IgnoreCase), "Calendar"),
  ];

  private void OnFailed(string message) {
    Ended?.Invoke(message);
  }

  private void OnNotice(string notice) {
    Status?.Invoke(notice);
  }

  [GeneratedRegex(@"\\([\\`*_{}\[\]()#+\-.!>|~])")]
  private static partial Regex MarkdownEscape();

  [GeneratedRegex(@"\b(can'?t|cannot|don'?t|do not|unable|not able|no access)\b",
                  RegexOptions.IgnoreCase)]
  private static partial Regex Refusal();

  [GeneratedRegex(
      @"\b(calendar|schedule|meeting|event|remind|reminder|task|to-?do|note|keep|gmail|e-?mail|inbox|mail|home|light|lights|thermostat|device|alarm|timer)\b",
      RegexOptions.IgnoreCase)]
  private static partial Regex AppTopic();

  [GeneratedRegex(
      @"\b(add|create|schedule|set|make|new|delete|remove|cancel|move|reschedule|turn on|turn off|switch on|switch off|dim|list|show|check|read|send|mark|star|archive|do i have|what'?s on|what is on|what'?s my|what are my|when'?s|when is)\b",
      RegexOptions.IgnoreCase)]
  private static partial Regex Intent();
}
