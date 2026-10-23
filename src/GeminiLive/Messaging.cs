using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GeminiLive;

/// <summary>
/// One entry of a protocol map: a message type with its data and return types. The C# side of a
/// TypeScript protocol map entry such as <c>[GlicMessage.Capture](): Frame | null</c> (see
/// messaging/src/index.ts), so both ends of a channel type each message the same way.
/// </summary>
public sealed record Protocol<TType, TData, TReturn>(TType Type) where TType : struct, Enum;

/// <summary>The data or return type of a message that carries none; null on the wire.</summary>
[JsonConverter(typeof(NoneConverter))]
public readonly record struct None;

internal sealed class NoneConverter : JsonConverter<None> {
  public override bool HandleNull => true;

  public override None Read(ref Utf8JsonReader reader, Type typeToConvert,
                            JsonSerializerOptions options) {
    reader.Skip();
    return default;
  }

  public override void Write(Utf8JsonWriter writer, None value, JsonSerializerOptions options) {
    writer.WriteNullValue();
  }
}

/// <summary>
/// Typed request/reply messages over one channel, in @webext-core/messaging's shape:
/// <see cref="SendMessageAsync{TData, TReturn}"/> and <see cref="OnMessage{TData, TReturn}"/>,
/// with message types from the enum <typeparamref name="TType"/> (wire value:
/// <see cref="WireName"/>). The envelopes match messaging/src/index.ts:
/// <c>{id, type, data, timestamp}</c> for a request, <c>{replyTo, res | err}</c> for its reply.
/// </summary>
public sealed class Messenger<TType> where TType : struct, Enum {
  // camelCase names and enum values, the same spelling as WireName and the TypeScript side.
  private static readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web) {
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
  };

  private readonly Action<string> _post;
  private readonly TimeSpan _timeout;
  private readonly ConcurrentDictionary<TType, Func<JsonElement, Task<object?>>> _handlers = new();
  private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonElement>> _pending = new();
  private int _nextId;

  /// <param name="post">Sends one envelope, as JSON, to the other end.</param>
  /// <param name="timeout">
  /// How long a send waits for its reply. Channels drop messages while a page navigates or a
  /// socket reconnects, so nothing waits forever.
  /// </param>
  public Messenger(Action<string> post, TimeSpan timeout) {
    _post = post;
    _timeout = timeout;
  }

  private sealed record Request(int Id, string Type, JsonElement Data, long Timestamp);

  private sealed record Reply(
      int ReplyTo, object? Res,
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Err);

  /// <summary>
  /// Sends <paramref name="data"/> and returns the other end's answer. Throws if it has no
  /// listener, its listener throws, or no reply comes within <paramref name="timeout"/> (default:
  /// the messenger's).
  /// </summary>
  public async Task<TReturn> SendMessageAsync<TData, TReturn>(
      Protocol<TType, TData, TReturn> message, TData data, TimeSpan? timeout = null) {
    TimeSpan wait = timeout ?? _timeout;
    int id = Interlocked.Increment(ref _nextId);
    var reply = new TaskCompletionSource<JsonElement>(
        TaskCreationOptions.RunContinuationsAsynchronously);
    _pending[id] = reply;
    try {
      _post(JsonSerializer.Serialize(new {
        id,
        type = WireName.Of(message.Type),
        data,
        timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
      }, _json));
      return Read<TReturn>(await reply.Task.WaitAsync(wait));
    } catch (TimeoutException) {
      throw new TimeoutException($"No reply to \"{WireName.Of(message.Type)}\" in {wait}");
    } finally {
      _pending.TryRemove(id, out _);
    }
  }

  /// <summary>Sends a message that carries no data.</summary>
  public Task<TReturn> SendMessageAsync<TReturn>(Protocol<TType, None, TReturn> message,
                                                 TimeSpan? timeout = null) {
    return SendMessageAsync(message, default(None), timeout);
  }

  /// <summary>
  /// Answers every <paramref name="message"/> the other end sends with
  /// <paramref name="onReceived"/>; one listener per type. Returns what removes it.
  /// </summary>
  public Action OnMessage<TData, TReturn>(Protocol<TType, TData, TReturn> message,
                                          Func<TData, Task<TReturn>> onReceived) {
    Func<JsonElement, Task<object?>> handler =
        async data => await onReceived(Read<TData>(data));
    if (!_handlers.TryAdd(message.Type, handler)) {
      throw new InvalidOperationException($"\"{WireName.Of(message.Type)}\" already has a listener");
    }

    return () => _handlers.TryRemove(message.Type, out _);
  }

  /// <summary>A listener that answers at once.</summary>
  public Action OnMessage<TData, TReturn>(Protocol<TType, TData, TReturn> message,
                                          Func<TData, TReturn> onReceived) {
    return OnMessage(message, data => Task.FromResult(onReceived(data)));
  }

  /// <summary>A field of an envelope as <typeparamref name="T"/>; a missing one reads as null.</summary>
  private static T Read<T>(JsonElement value) {
    return value.ValueKind == JsonValueKind.Undefined ? default! : value.Deserialize<T>(_json)!;
  }

  public void RemoveAllListeners() {
    _handlers.Clear();
  }

  /// <summary>Takes one envelope from the other end: a request to answer or a reply to settle.</summary>
  public void Receive(string json) {
    JsonElement envelope;
    try {
      envelope = JsonSerializer.Deserialize<JsonElement>(json, _json);
    } catch (JsonException) {
      return;  // not one of ours
    }

    if (envelope.ValueKind != JsonValueKind.Object) {
      return;
    }

    if (envelope.TryGetProperty("replyTo", out JsonElement replyTo)) {
      Settle(replyTo.GetInt32(), envelope);
      return;
    }

    Request? request = envelope.Deserialize<Request>(_json);
    if (request is not null) {
      _ = AnswerAsync(request);
    }
  }

  private void Settle(int id, JsonElement envelope) {
    if (!_pending.TryGetValue(id, out TaskCompletionSource<JsonElement>? reply)) {
      return;  // timed out already
    }

    if (envelope.TryGetProperty("err", out JsonElement err) && err.ValueKind == JsonValueKind.String) {
      reply.TrySetException(new InvalidOperationException(err.GetString()));
      return;
    }

    reply.TrySetResult(envelope.TryGetProperty("res", out JsonElement res) ? res.Clone() : default);
  }

  private async Task AnswerAsync(Request request) {
    Reply reply;
    if (WireName.Parse<TType>(request.Type) is not { } type
        || !_handlers.TryGetValue(type, out Func<JsonElement, Task<object?>>? handler)) {
      reply = new Reply(request.Id, null, $"No listener for \"{request.Type}\"");
    } else {
      try {
        reply = new Reply(request.Id, await handler(request.Data), null);
      } catch (Exception e) {
        reply = new Reply(request.Id, null, e.Message);
      }
    }

    _post(JsonSerializer.Serialize(reply, _json));
  }
}
