using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
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

  /// <summary>The realtimeInput streams we send; the wire field is <see cref="WireName"/>'s.</summary>
  private enum RealtimeInput { Audio, Video }

  private readonly Settings _settings;
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
    Enqueue(RealtimeInput.Audio, _audioMimeType, pcm16);
  }

  public void SendFrame(byte[] jpeg) {
    Enqueue(RealtimeInput.Video, ScreenGrabber.MimeType, jpeg);
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
    await SendNowAsync(SetupMessage());

    // The server answers setup with setupComplete before anything else.
    JsonNode? first = await ReceiveAsync();
    if (first?["setupComplete"] is null) {
      throw new InvalidOperationException(
          $"Setup rejected: {first?.ToJsonString() ?? _socket.CloseStatusDescription}");
    }

    Status?.Invoke(_resumeHandle is null ? "Connected" : "Reconnected");
    _ = Task.Run(ReceiveLoopAsync);
  }

  private string SetupMessage() {
    var setup = new JsonObject {
      ["model"] = $"models/{_settings.Model}",
      ["generationConfig"] = new JsonObject {
        ["responseModalities"] = new JsonArray("AUDIO"),
        ["mediaResolution"] = "MEDIA_RESOLUTION_MEDIUM",
        ["speechConfig"] = new JsonObject {
          ["voiceConfig"] = new JsonObject {
            ["prebuiltVoiceConfig"] = new JsonObject { ["voiceName"] = _settings.Voice },
          },
        },
      },
      ["systemInstruction"] = new JsonObject {
        ["parts"] = new JsonArray(new JsonObject { ["text"] = _systemPrompt }),
      },
      ["tools"] = new JsonArray(new JsonObject { ["googleSearch"] = new JsonObject() }),
      ["inputAudioTranscription"] = new JsonObject(),
      ["outputAudioTranscription"] = new JsonObject(),
      // Audio+video sessions are capped at ~2 minutes of context without this.
      ["contextWindowCompression"] = new JsonObject { ["slidingWindow"] = new JsonObject() },
      // Lets us reconnect into the same conversation when the server sends goAway.
      ["sessionResumption"] = _resumeHandle is null
          ? new JsonObject()
          : new JsonObject { ["handle"] = _resumeHandle },
    };
    return new JsonObject { ["setup"] = setup }.ToJsonString();
  }

  private void Enqueue(RealtimeInput kind, string mimeType, byte[] data) {
    // Built by hand: this runs 25 times a second for audio alone.
    _outbox.Writer.TryWrite(
        "{\"realtimeInput\":{\"" + WireName.For(kind) + "\":{\"mimeType\":\"" + mimeType + "\",\"data\":\""
        + Convert.ToBase64String(data) + "\"}}}");
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

  private async Task<JsonNode?> ReceiveAsync() {
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
        return JsonNode.Parse(message.ToArray());
      }
    }
  }

  private async Task ReceiveLoopAsync() {
    ClientWebSocket? socket = _socket;
    try {
      while (!_cts.IsCancellationRequested) {
        JsonNode? msg = await ReceiveAsync();
        if (msg is null) {
          break;
        }

        if (Handle(msg)) {
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
  private bool Handle(JsonNode msg) {
    if (msg["serverContent"] is JsonObject content) {
      HandleContent(content);
    }

    if (msg["sessionResumptionUpdate"] is JsonObject resume
        && resume["resumable"]?.GetValue<bool>() == true
        && resume["newHandle"]?.GetValue<string>() is { Length: > 0 } handle) {
      _resumeHandle = handle;
    }

    if (msg["goAway"] is not { } goAway) {
      return false;
    }

    Log.Write($"goAway {goAway.ToJsonString()} - resuming");
    Status?.Invoke(LiveStatus.Reconnecting);
    _ = Task.Run(ResumeAsync);
    return true;
  }

  private void HandleContent(JsonObject content) {
    if (content["interrupted"]?.GetValue<bool>() == true) {
      Interrupted?.Invoke();
    }

    if (content["modelTurn"]?["parts"] is JsonArray parts) {
      foreach (JsonNode? part in parts) {
        if (part?["inlineData"]?["data"]?.GetValue<string>() is { } base64) {
          Audio?.Invoke(Convert.FromBase64String(base64));
        }
      }
    }

    if (content["inputTranscription"]?["text"]?.GetValue<string>() is { Length: > 0 } heard) {
      UserText?.Invoke(heard);
    }

    if (content["outputTranscription"]?["text"]?.GetValue<string>() is { Length: > 0 } said) {
      ModelText?.Invoke(said);
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
