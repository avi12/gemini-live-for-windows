using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;

namespace GeminiLive;

/// <summary>
/// One Gemini Live conversation over the BidiGenerateContent WebSocket. Mic audio and screen
/// frames flow up as independent realtimeInput messages on the same socket while model audio
/// flows down - nothing is turn-based on the wire, which is why you can talk over Gemini while
/// it is looking at your screen. Voice activity detection and barge-in run on Google's side.
/// </summary>
public sealed class LiveSession : IAsyncDisposable
{
    const string Endpoint = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

    readonly Settings _settings;
    readonly Channel<string> _outbox = Channel.CreateBounded<string>(
        new BoundedChannelOptions(256) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
    readonly CancellationTokenSource _cts = new();
    ClientWebSocket? _socket;
    string? _resumeHandle;
    Task? _pump;

    public event Action<byte[]>? Audio;             // 24 kHz PCM16 from the model
    public event Action? Interrupted;               // user barged in - stop playback now
    public event Action<string>? UserText;          // live transcript of what the user said
    public event Action<string>? ModelText;         // live transcript of what Gemini said
    public event Action? TurnComplete;
    public event Action<string>? Status;
    public event Action<string>? Closed;

    public LiveSession(Settings settings) => _settings = settings;

    public async Task ConnectAsync()
    {
        await OpenSocketAsync();
        _pump ??= Task.Run(PumpAsync);
    }

    async Task OpenSocketAsync()
    {
        _socket?.Dispose();
        _socket = new ClientWebSocket();
        _socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        await _socket.ConnectAsync(new Uri($"{Endpoint}?key={Uri.EscapeDataString(_settings.ApiKey)}"), _cts.Token);
        await SendNowAsync(SetupMessage());

        // The server answers setup with setupComplete before anything else.
        var first = await ReceiveAsync();
        if (first is null || first["setupComplete"] is null)
            throw new InvalidOperationException($"Setup rejected: {first?.ToJsonString() ?? _socket.CloseStatusDescription}");
        Status?.Invoke(_resumeHandle is null ? "Connected" : "Reconnected");
        _ = Task.Run(ReceiveLoopAsync);
    }

    string SetupMessage()
    {
        var setup = new JsonObject
        {
            ["model"] = $"models/{_settings.Model}",
            ["generationConfig"] = new JsonObject
            {
                ["responseModalities"] = new JsonArray("AUDIO"),
                ["mediaResolution"] = "MEDIA_RESOLUTION_MEDIUM",
                ["speechConfig"] = new JsonObject
                {
                    ["voiceConfig"] = new JsonObject
                    {
                        ["prebuiltVoiceConfig"] = new JsonObject { ["voiceName"] = _settings.Voice },
                    },
                },
            },
            ["systemInstruction"] = new JsonObject
            {
                ["parts"] = new JsonArray(new JsonObject { ["text"] = SystemPrompt }),
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

    const string SystemPrompt =
        "You are Gemini Live running on the user's Windows PC. You can see their screen: you receive " +
        "a still of the shared display about once a second. Speak naturally and briefly, like a " +
        "person looking over their shoulder. Refer to what is on screen when it helps. If the screen " +
        "has not been shared yet or is unclear, say so instead of guessing.";

    // ---- upstream: realtime input ----

    public void SendAudio(byte[] pcm16) => Enqueue("audio", "audio/pcm;rate=16000", pcm16);
    public void SendFrame(byte[] jpeg) => Enqueue("video", "image/jpeg", jpeg);

    void Enqueue(string kind, string mime, byte[] data) =>
        _outbox.Writer.TryWrite(
            "{\"realtimeInput\":{\"" + kind + "\":{\"mimeType\":\"" + mime + "\",\"data\":\"" + Convert.ToBase64String(data) + "\"}}}");

    async Task PumpAsync()
    {
        await foreach (var message in _outbox.Reader.ReadAllAsync(_cts.Token))
        {
            try
            {
                if (_socket?.State == WebSocketState.Open) await SendNowAsync(message);
            }
            catch (Exception e) when (!_cts.IsCancellationRequested) { Log.Write($"send failed: {e.Message}"); }
        }
    }

    readonly SemaphoreSlim _sendGate = new(1, 1);
    async Task SendNowAsync(string json)
    {
        await _sendGate.WaitAsync(_cts.Token);
        try { await _socket!.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true, _cts.Token); }
        finally { _sendGate.Release(); }
    }

    // ---- downstream ----

    async Task<JsonNode?> ReceiveAsync()
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        while (true)
        {
            var r = await _socket!.ReceiveAsync(buffer, _cts.Token);
            if (r.MessageType == WebSocketMessageType.Close) return null;
            message.Write(buffer, 0, r.Count);
            // The server sends JSON in binary frames; both frame types carry UTF-8 JSON.
            if (r.EndOfMessage) return JsonNode.Parse(message.ToArray());
        }
    }

    async Task ReceiveLoopAsync()
    {
        var socket = _socket;
        try
        {
            while (!_cts.IsCancellationRequested)
            {
                var msg = await ReceiveAsync();
                if (msg is null) break;
                if (Handle(msg)) return; // goAway: a fresh socket took over
            }
            if (socket == _socket && !_cts.IsCancellationRequested)
                Closed?.Invoke(socket?.CloseStatusDescription is { Length: > 0 } d ? d : "Session ended");
        }
        catch (Exception e) when (!_cts.IsCancellationRequested && socket == _socket)
        {
            Log.Write($"receive failed: {e}");
            Closed?.Invoke(e.Message);
        }
        catch { /* superseded or shutting down */ }
    }

    /// <returns>true when this socket has been replaced and its loop should stop.</returns>
    bool Handle(JsonNode msg)
    {
        if (msg["serverContent"] is JsonObject content)
        {
            if (content["interrupted"]?.GetValue<bool>() == true) Interrupted?.Invoke();

            if (content["modelTurn"]?["parts"] is JsonArray parts)
                foreach (var part in parts)
                    if (part?["inlineData"]?["data"]?.GetValue<string>() is { } b64)
                        Audio?.Invoke(Convert.FromBase64String(b64));

            if (content["inputTranscription"]?["text"]?.GetValue<string>() is { Length: > 0 } heard) UserText?.Invoke(heard);
            if (content["outputTranscription"]?["text"]?.GetValue<string>() is { Length: > 0 } said) ModelText?.Invoke(said);
            if (content["turnComplete"]?.GetValue<bool>() == true) TurnComplete?.Invoke();
        }

        if (msg["sessionResumptionUpdate"] is JsonObject resume
            && resume["resumable"]?.GetValue<bool>() == true
            && resume["newHandle"]?.GetValue<string>() is { Length: > 0 } handle)
            _resumeHandle = handle;

        if (msg["goAway"] is not null)
        {
            Log.Write($"goAway {msg["goAway"]?.ToJsonString()} - resuming");
            Status?.Invoke("Reconnecting…");
            _ = Task.Run(async () =>
            {
                try { await OpenSocketAsync(); }
                catch (Exception e) { Closed?.Invoke($"Reconnect failed: {e.Message}"); }
            });
            return true;
        }
        return false;
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        _outbox.Writer.TryComplete();
        if (_socket is { State: WebSocketState.Open } s)
        {
            try { await s.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(1)); }
            catch { }
        }
        _socket?.Dispose();
    }
}
