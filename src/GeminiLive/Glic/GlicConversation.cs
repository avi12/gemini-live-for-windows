using System.Text.RegularExpressions;

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

  private readonly GlicHost _host;

  public GlicConversation(GlicHost host, MonitorInfo monitor) {
    _host = host;
    host.Monitor = monitor;
    host.State += OnState;
    host.Caption += OnCaption;
    host.Failed += OnFailed;
    host.Notice += OnNotice;
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
      _lastUserUtterance = clean;
    } else if (NeedsApp(clean) && index != _handledRefusalIndex && _lastUserUtterance.Length > 0) {
      _handledRefusalIndex = index;
      _ = RunAppActionAsync(_lastUserUtterance);
    }
  }

  // Live has no access to the account's Google apps; its text turns do. When Gemini says it can't
  // reach Calendar, Keep, Tasks, Gmail or Home, re-run the user's request on the text path, speak
  // the answer back into the card, and resume Live - which keeps the answer in context.
  private async Task RunAppActionAsync(string request) {
    if (_runningAction) {
      return;
    }
    _runningAction = true;
    Status?.Invoke("Checking your Google apps…");
    try {
      string answer = await _host.RunActionAsync(request);
      if (answer.Length > 0) {
        Transcript?.Invoke(answer, false);
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
}
