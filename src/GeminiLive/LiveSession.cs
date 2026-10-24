using System.Net.WebSockets;
using System.Text;
using System.Threading.Channels;

namespace GeminiLive;

/// <summary>
/// One Gemini Live conversation over the BidiGenerateContent WebSocket. Mic audio and screen
/// frames flow up as independent realtimeInput messages on the same socket while model audio
/// flows down - nothing is turn-based on the wire, which is why you can talk over Gemini while
/// it is looking at your screen. Voice activity detection and barge-in run on Google's side.
/// </summary>
public sealed class LiveSession : IAsyncDisposable {
  public event Action<byte[]>? Audio;  // 24 kHz PCM16 from the model
  public event Action? Interrupted;  // user barged in - stop playback now
  public event Action<string>? UserText;  // live transcript of what the user said
  public event Action<string>? ModelText;  // live transcript of what Gemini said
  public event Action<string>? Status;
  public event Action<string>? Closed;

  private const string _endpoint =
      "wss://generativelanguage.googleapis.com/ws/"
      + "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
  private const int _receiveBufferBytes = 64 * 1024;
  private const string _systemPrompt =
      "You are Gemini Live running on the user's Windows PC. You can see their screen: you "
      + "receive a still of the shared display about once a second. Speak naturally and briefly, "
      + "like a person looking over their shoulder. Refer to what is on screen when it helps. If "
      + "the screen has not been shared yet or is unclear, say so instead of guessing.";
  private static readonly string _audioMimeType = $"audio/pcm;rate={AudioEngine.MicRate}";
  private static readonly TimeSpan _keepAlive = TimeSpan.FromSeconds(20);
  private static readonly TimeSpan _closeTimeout = TimeSpan.FromSeconds(1);

  private readonly Settings _settings;
  // Each unread server field is logged once, so a schema change shows up without flooding the log.
  private readonly HashSet<string> _unhandledSeen = [];
  private readonly Channel<string> _outbox = Channel.CreateBounded<string>(
      new BoundedChannelOptions(256) {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleReader = true,
      });
  private readonly CancellationTokenSource _cts = new();
  private readonly SemaphoreSlim _sendGate = new(1, 1);

  private ClientWebSocket? _socket;
  private string? _resumeHandle;
  private Task? _pump;

  public LiveSession(Settings settings) {
    _settings = settings;
  }

  public async Task ConnectAsync() {
    await OpenSocketAsync();
    _pump ??= Task.Run(PumpAsync);
  }

  // ---- upstream: realtime input ----

  public void SendAudio(byte[] pcm16) {
    Enqueue(new RealtimeInput(Audio: new Blob(_audioMimeType, pcm16)));
  }

  public void SendFrame(byte[] jpeg) {
    Enqueue(new RealtimeInput(Video: new Blob(ScreenGrabber.MimeType, jpeg)));
  }

  public async ValueTask DisposeAsync() {
    _cts.Cancel();
    _outbox.Writer.TryComplete();

    if (_socket is { State: WebSocketState.Open } socket) {
      try {
        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None)
            .WaitAsync(_closeTimeout);
      } catch {
        // Closing politely is best-effort; the socket is disposed either way.
      }
    }

    _socket?.Dispose();
  }

  private async Task OpenSocketAsync() {
    _socket?.Dispose();
    _socket = new ClientWebSocket();
    _socket.Options.KeepAliveInterval = _keepAlive;
    var uri = new Uri($"{_endpoint}?key={Uri.EscapeDataString(_settings.ApiKey)}");
    await _socket.ConnectAsync(uri, _cts.Token);
    await SendNowAsync(LiveApi.Serialize(new LiveClientMessage(Setup: Setup())));

    // The server answers setup with setupComplete before anything else.
    byte[]? first = await ReceiveAsync();
    if (first is null || LiveApi.Parse(first).SetupComplete is null) {
      throw new InvalidOperationException(
          $"Setup rejected: {(first is null ? _socket.CloseStatusDescription : Encoding.UTF8.GetString(first))}");
    }

    Status?.Invoke(_resumeHandle is null ? "Connected" : "Reconnected");
    _ = Task.Run(ReceiveLoopAsync);
  }

  private LiveSetup Setup() {
    return new LiveSetup(
        Model: $"models/{_settings.Model}",
        GenerationConfig: new GenerationConfig(
            ResponseModalities: [Modality.Audio],
            MediaResolution: MediaResolution.Medium,
            SpeechConfig: new SpeechConfig(new VoiceConfig(new PrebuiltVoiceConfig(_settings.Voice)))),
        SystemInstruction: new Content([new Part(Text: _systemPrompt)]),
        Tools: [new Tool(GoogleSearch: new GoogleSearch())],
        InputAudioTranscription: new AudioTranscriptionConfig(),
        OutputAudioTranscription: new AudioTranscriptionConfig(),
        // Audio+video sessions are capped at ~2 minutes of context without this.
        ContextWindowCompression: new ContextWindowCompressionConfig(new SlidingWindow()),
        // Lets us reconnect into the same conversation when the server sends goAway.
        SessionResumption: new SessionResumptionConfig(_resumeHandle));
  }

  private void Enqueue(RealtimeInput input) {
    _outbox.Writer.TryWrite(LiveApi.Serialize(new LiveClientMessage(RealtimeInput: input)));
  }

  private async Task PumpAsync() {
    await foreach (string message in _outbox.Reader.ReadAllAsync(_cts.Token)) {
      if (_socket?.State != WebSocketState.Open) {
        continue;
      }

      try {
        await SendNowAsync(message);
      } catch (Exception e) when (!_cts.IsCancellationRequested) {
        Log.Write($"send failed: {e.Message}");
      }
    }
  }

  private async Task SendNowAsync(string json) {
    await _sendGate.WaitAsync(_cts.Token);
    try {
      await _socket!.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true,
                               _cts.Token);
    } finally {
      _sendGate.Release();
    }
  }

  // ---- downstream ----

  /// <summary>One whole message's UTF-8 JSON; null once the server closes.</summary>
  private async Task<byte[]?> ReceiveAsync() {
    var buffer = new byte[_receiveBufferBytes];
    using var message = new MemoryStream();
    while (true) {
      WebSocketReceiveResult received = await _socket!.ReceiveAsync(buffer, _cts.Token);
      if (received.MessageType == WebSocketMessageType.Close) {
        return null;
      }

      message.Write(buffer, 0, received.Count);

      // The server sends JSON in binary frames; both frame types carry UTF-8 JSON.
      if (received.EndOfMessage) {
        return message.ToArray();
      }
    }
  }

  private async Task ReceiveLoopAsync() {
    ClientWebSocket? socket = _socket;
    try {
      while (!_cts.IsCancellationRequested) {
        byte[]? json = await ReceiveAsync();
        if (json is null) {
          break;
        }

        if (Handle(LiveApi.Parse(json))) {
          return;  // goAway: a fresh socket took over
        }
      }

      if (socket == _socket && !_cts.IsCancellationRequested) {
        Closed?.Invoke(
            socket?.CloseStatusDescription is { Length: > 0 } reason ? reason : "Session ended");
      }
    } catch (Exception e) when (!_cts.IsCancellationRequested && socket == _socket) {
      Log.Write($"receive failed: {e}");
      Closed?.Invoke(e.Message);
    } catch {
      // Superseded or shutting down.
    }
  }

  /// <returns>true when this socket has been replaced and its loop should stop.</returns>
  private bool Handle(LiveServerMessage msg) {
    if (msg.ServerContent is { } content) {
      HandleContent(content);
    }

    if (msg.SessionResumptionUpdate is { Resumable: true, NewHandle: { Length: > 0 } handle }) {
      _resumeHandle = handle;
    }

    foreach (string field in msg.Unhandled?.Keys ?? Enumerable.Empty<string>()) {
      if (_unhandledSeen.Add(field)) {
        Log.Write($"live api: ignoring \"{field}\"");
      }
    }

    if (msg.GoAway is not { } goAway) {
      return false;
    }

    Log.Write($"goAway in {goAway.TimeLeft ?? "?"} - resuming");
    Status?.Invoke(LiveStatus.Reconnecting);
    _ = Task.Run(ResumeAsync);
    return true;
  }

  private void HandleContent(ServerContent content) {
    if (content.Interrupted) {
      Interrupted?.Invoke();
    }

    foreach (Part part in content.ModelTurn?.Parts ?? []) {
      if (part.InlineData is { } audio) {
        Audio?.Invoke(audio.Data);
      }
    }

    if (content.InputTranscription is { Text.Length: > 0 } heard) {
      UserText?.Invoke(heard.Text);
    }

    if (content.OutputTranscription is { Text.Length: > 0 } said) {
      ModelText?.Invoke(said.Text);
    }
  }

  private async Task ResumeAsync() {
    try {
      await OpenSocketAsync();
    } catch (Exception e) {
      Closed?.Invoke($"Reconnect failed: {e.Message}");
    }
  }
}
