namespace GeminiLive;

/// <summary>The two ways we can run a Live conversation. Persisted in settings.</summary>
public enum EngineKind {
  /// <summary>
  /// Your Google account, through the real Gemini web client (same as Gemini in Chrome).
  /// </summary>
  Google,
  /// <summary>The public Gemini Live API on an API key.</summary>
  ApiKey,
}

/// <summary>One running conversation, whichever engine carries it.</summary>
public interface ILiveEngine : IAsyncDisposable {
  /// <summary>Short state line for the pill, usually one of <see cref="LiveStatus"/>.</summary>
  event Action<string>? Status;
  /// <summary>
  /// The current utterance's full text so far; a new utterance starts when the speaker changes.
  /// </summary>
  event Action<string, bool>? Transcript;  // text, isUser
  /// <summary>Audio peak 0..1 for the glow; only raised when <see cref="ReportsLevels"/>.</summary>
  event Action<float, bool>? Level;  // peak, isUser
  event Action<string>? Ended;

  MonitorInfo Monitor { get; }
  bool Muted { get; set; }
  /// <summary>False when Gemini's own client owns the audio, so there are no levels.</summary>
  bool ReportsLevels { get; }

  /// <summary>
  /// Completes once Gemini is listening. The caller disposes the engine if it throws.
  /// </summary>
  Task StartAsync();

  void Share(MonitorInfo monitor);
}

/// <summary>The status lines more than one place shows or reports.</summary>
public static class LiveStatus {
  public const string Connecting = "Connecting…";
  public const string Listening = "Listening";
  public const string Reconnecting = "Reconnecting…";
  public const string Resuming = "Resuming…";
}
