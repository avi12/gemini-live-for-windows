using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Threading;

namespace GeminiLive.Glic;

/// <summary>
/// The Google-account engine: one Live session on the long-lived <see cref="GlicHost"/>. Gemini's
/// own client does the audio, so there are no levels to show; captions arrive as whole utterances.
/// Requests Live can't serve (<see cref="SpokenIntent"/>) take a detour: the PC lights through
/// <see cref="HomeHost"/>, Google apps and web searches through Gemini's text path, whose links
/// come back as chips.
/// </summary>
public sealed partial class GlicConversation : ILiveEngine {
  public event Action<string>? Status;
  public event Action<string, bool>? Transcript;
  public event Action<IReadOnlyList<FoundLink>>? Links;
  public event Action<float, bool>? Level {
    add { }
    remove { }
  }
  public event Action<string>? Ended;

  // Long enough that the user's utterance has settled before we act on it, short enough to beat
  // Gemini's spoken refusal most of the time.
  private static readonly TimeSpan _intentSettle = TimeSpan.FromMilliseconds(1100);

  // A text detour replaces the Live session, which cuts Gemini off mid-word. So it waits for
  // Gemini to start answering (a moment after the request), then for its captions to stop growing
  // - the voice is a beat behind the text - and never longer than the cap, in case it never stops.
  private static readonly TimeSpan _answerStartGrace = TimeSpan.FromSeconds(3);
  private static readonly TimeSpan _speechSettle = TimeSpan.FromMilliseconds(1800);
  private static readonly TimeSpan _maxSpeechWait = TimeSpan.FromSeconds(20);
  private static readonly TimeSpan _speechPoll = TimeSpan.FromMilliseconds(150);

  // Added to a web request so the text turn searches and cites, in whatever language it was asked.
  // It also says what NOT to do: a text turn starts a fresh chat, and without it asks the user for
  // details they have already given - the screen context above is what "this" refers to.
  private const string _webSearchAsk =
      "(This is a new chat, so use only the context above. Don't ask me for details: search the web,"
      + " find the original source, and link the exact pages you used.)";
  private const int _maxContextChars = 300;
  private const int _screenHeadings = 3;
  private const int _screenTextChars = 600;

  private readonly GlicHost _host;
  private readonly HomeHost _home;
  private readonly DispatcherTimer _intentTimer;

  private bool _muted;
  private string _lastUserUtterance = "";
  private string _lastGeminiLine = "";
  private DateTime _lastGeminiCaptionAt = DateTime.MinValue;  // when Gemini's words last grew
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
    _host.View.Region = null;
  }

  public System.Drawing.Rectangle? Region {
    get => _host.View.Region;
    set => _host.View.Region = value;
  }

  public ValueTask DisposeAsync() {
    _intentTimer.Stop();
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
      // Act on the request as soon as it settles, before Gemini can say it can't (proactive). The
      // utterance revises in place, so restart the settle timer on each update.
      _lastUserUtterance = clean;

      if (!_runningDetour) {
        _intentTimer.Stop();
        _intentTimer.Start();
      }
    } else {
      _lastGeminiLine = clean;
      _lastGeminiCaptionAt = DateTime.UtcNow;
      OnGeminiLine(clean, index);
    }
  }

  // Fallback: Gemini got there first and refused something the text path can do. Fix it there.
  private void OnGeminiLine(string line, int index) {
    bool isOpen = index != _handledRefusalIndex && _lastUserUtterance.Length > 0
        && _lastUserUtterance != _handledUtterance;
    if (!isOpen) {
      return;
    }

    if (SpokenIntent.NeedsApp(line)) {
      _handledRefusalIndex = index;
      _ = RunAppActionAsync(_lastUserUtterance);
      return;
    }

    if (SpokenIntent.WithholdsLink(line)) {
      _handledRefusalIndex = index;
      _ = RunWebSearchAsync(_lastUserUtterance);
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
      return;
    }

    if (SpokenIntent.AsksWeb(_lastUserUtterance)) {
      _ = RunWebSearchAsync(_lastUserUtterance);
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
  // reach Calendar, Keep, Tasks or Gmail, re-run the user's request on the text path, show the
  // answer in the card, and resume Live - which keeps the answer in context.
  private Task RunAppActionAsync(string request) {
    return RunTextDetourAsync(request, $"Checking {SpokenIntent.AppName(request)}…",
                              () => Task.FromResult(request));
  }

  // Live answers web questions by voice, so it can name a page but never hand it over, and tends to
  // say it can't give links. The text path searches with Google and keeps the links, which become
  // chips in the card.
  private Task RunWebSearchAsync(string request) {
    return RunTextDetourAsync(request, "Searching the web…", () => WebSearchPromptAsync(request));
  }

  /// <summary>
  /// A detour through the text path: lets Gemini finish what it is saying first, since the text
  /// turn replaces the Live session, then asks the prompt it builds - after the wait, so it can
  /// quote Gemini's whole last line.
  /// </summary>
  private Task RunTextDetourAsync(string request, string status, Func<Task<string>> buildPrompt) {
    return RunDetourAsync(request, status, async () => {
      await WaitForGeminiToFinishAsync();
      await AskTextPathAsync(await buildPrompt());
    });
  }

  /// <summary>
  /// Returns once Gemini has stopped talking for now: it gets a short grace to start answering,
  /// then until its captions have been still for a moment, up to a cap. There is no "speaking"
  /// signal from the page, so a still caption is the best sign it has finished.
  /// </summary>
  private async Task WaitForGeminiToFinishAsync() {
    DateTime asked = DateTime.UtcNow;

    while (DateTime.UtcNow - asked < _answerStartGrace && _lastGeminiCaptionAt < asked) {
      await Task.Delay(_speechPoll);
    }

    while (DateTime.UtcNow - asked < _maxSpeechWait
           && DateTime.UtcNow - _lastGeminiCaptionAt < _speechSettle) {
      await Task.Delay(_speechPoll);
    }
  }

  /// <summary>
  /// The request as the text turn needs it. That turn sees neither the screen nor what Live said, so
  /// "the article I'm looking at" means nothing there: name the window on screen and Live's last
  /// words, then ask it to search and link its sources.
  /// </summary>
  private async Task<string> WebSearchPromptAsync(string request) {
    var prompt = new StringBuilder(request);
    if (await _host.View.ReadAsync() is { } screen) {
      prompt.Append(" (On my screen: ").Append(DescribeScreen(screen)).Append(')');
    }

    if (_lastGeminiLine.Length > 0) {
      prompt.Append(" (You just told me: \"").Append(Clip(_lastGeminiLine)).Append("\".)");
    }

    string asked = prompt.Append(' ').Append(_webSearchAsk).ToString();
    Log.Write($"text turn asks: {asked}");
    return asked;
  }

  /// <summary>
  /// What a fresh text turn needs to know what "this article" is: the window's title, then its
  /// headlines and the start of its text, since a title alone is often just the site's name.
  /// </summary>
  private static string DescribeScreen(ScreenText.View screen) {
    var parts = new List<string>();
    if (screen.Title.Length > 0) {
      parts.Add($"a window titled \"{Clip(screen.Title)}\"");
    }

    IEnumerable<string> headings = screen.Blocks
        .Where(block => block.Kind == ScreenText.BlockKind.Heading)
        .Select(block => block.Text)
        .Take(_screenHeadings);
    foreach (string heading in headings) {
      parts.Add($"heading \"{Clip(heading)}\"");
    }

    string text = string.Join(' ', screen.Blocks.Select(block => block.Text));
    if (text.Length > 0) {
      parts.Add($"text beginning \"{Clip(text, _screenTextChars)}\"");
    }

    return string.Join("; ", parts);
  }

  // Keeps a prompt quick to type: the text turn is typed one trusted key event per character.
  private static string Clip(string text, int limit = _maxContextChars) {
    return text.Length <= limit ? text : text[..limit] + "…";
  }

  private async Task AskTextPathAsync(string request) {
    try {
      TextAnswer answer = await _host.RunActionAsync(request);
      Log.Write($"text turn: {answer.Text.Length} chars, {answer.Links.Count} links back");

      // Shown, not read aloud: only Gemini's own voice speaks.
      if (answer.Text.Length > 0) {
        Transcript?.Invoke(answer.Text, false);
      }

      if (answer.Links.Count > 0) {
        Links?.Invoke([.. answer.Links.Select(link => new FoundLink(link.Title, link.Url, false))]);
      }

      await _host.StartAsync();  // resume Live, now holding the answer in context
      Status?.Invoke(LiveStatus.Listening);
    } catch (Exception e) {
      Log.Write($"text turn failed: {e.Message}");
      Status?.Invoke(LiveStatus.Listening);
      _ = _host.StartAsync();
    }
  }

  // The PC lights live in Google Home, which Gemini's text path can't reach; flip them on the Home
  // web app instead and show the result. Unlike an app action this runs off the Live page, so Live
  // keeps listening throughout.
  private Task RunLightsAsync(string request, bool on) {
    return RunDetourAsync(request, $"Turning the lights {(on ? "on" : "off")}…",
                          () => SwitchLightsAsync(on));
  }

  private async Task SwitchLightsAsync(bool on) {
    try {
      Transcript?.Invoke(await _home.SetLightsAsync(on), false);
    } catch (Exception e) {
      Log.Write($"lights action failed: {e.Message}");
      Transcript?.Invoke("I had trouble reaching the lights.", false);
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
