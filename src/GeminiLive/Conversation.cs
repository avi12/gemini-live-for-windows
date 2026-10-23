namespace GeminiLive;

/// <summary>
/// The API-key engine: mic → Gemini, screen → Gemini, Gemini → speaker, over the public Live
/// API. Mic chunks (every 40 ms) and screen stills (about 1/s) are just two producers writing to
/// the same socket, so listening, looking and talking all happen at once.
/// </summary>
public sealed class Conversation : ILiveEngine {
  public event Action<string>? Status;
  public event Action<string, bool>? Transcript;
  public event Action<float, bool>? Level;
  public event Action<string>? Ended;

  private readonly AudioEngine _audio = new();
  private readonly LiveSession _live;
  private readonly ScreenSource _screen;

  public MonitorInfo Monitor => _screen.Monitor;

  public bool Muted {
    get => _audio.Muted;
    set => _audio.Muted = value;
  }

  public bool ReportsLevels => true;

  private string _utterance = "";
  private bool _utteranceIsUser;

  public Conversation(Settings settings, MonitorInfo monitor) {
    _live = new LiveSession(settings);
    _screen = new ScreenSource(monitor);

    _audio.MicChunk += _live.SendAudio;
    _audio.MicLevel += level => Level?.Invoke(level, true);
    _audio.SpeakerLevel += level => Level?.Invoke(level, false);
    _screen.Frame += _live.SendFrame;

    _live.Audio += pcm => _audio.Play(pcm);
    _live.Interrupted += _audio.Flush;
    _live.UserText += text => Append(text, true);
    _live.ModelText += text => Append(text, false);
    _live.Status += status => Status?.Invoke(status);
    _live.Closed += reason => Ended?.Invoke(reason);
  }

  public async Task StartAsync() {
    await _live.ConnectAsync();
    await _audio.StartAsync();
    _screen.Start();
  }

  public void Share(MonitorInfo monitor) {
    _screen.Monitor = monitor;
  }

  public async ValueTask DisposeAsync() {
    _screen.Dispose();
    _audio.Dispose();
    await _live.DisposeAsync();
  }

  // The API streams transcripts as fragments; the engine contract is whole utterances.
  private void Append(string fragment, bool isUser) {
    if (isUser != _utteranceIsUser) {
      _utterance = "";
    }

    _utteranceIsUser = isUser;
    _utterance += fragment;
    Transcript?.Invoke(_utterance.Trim(), isUser);
  }
}
