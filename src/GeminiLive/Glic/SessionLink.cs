using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Channels;

namespace GeminiLive.Glic;

/// <summary>
/// The loopback WebSocket the companion browser extension (extension/ in this repo) keeps open.
/// It pushes the browser's Google cookies on connect and on every rotation; we can also ask for
/// them on demand. Only the extension's pinned ID may connect. Each connection speaks
/// <see cref="LinkProtocol"/> through its own <see cref="Messenger{TType}"/>.
///
/// No fixed port, since any port can already be taken: we listen on a free one and publish it with
/// a fresh token in the extension's folder (<see cref="ExtensionSetup.PublishLink"/>). The
/// extension sends cookies only after our Hello carries that token, so whatever else ends up on a
/// stale port never gets the session.
/// </summary>
public sealed class SessionLink {
  public event Action<IReadOnlyList<GoogleCookie>>? CookiesReceived;
  public event Action? Connected;

  private const int _tokenBytes = 32;
  // From the manifest "key", so only our extension can hand us a Google session.
  private const string _extensionOrigin = "chrome-extension://bejbkccodipbnbjeagmihnhnfadnjgeh";
  private const string _webSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";  // RFC 6455
  private const int _maxHandshakeBytes = 16 * 1024;
  private const int _receiveBufferBytes = 64 * 1024;
  private static readonly TimeSpan _pingInterval = TimeSpan.FromSeconds(20);
  // The extension answers from a live service worker at once; a slower reply means it is gone.
  private static readonly TimeSpan _messageTimeout = TimeSpan.FromSeconds(10);

  private readonly List<Messenger<LinkMessage>> _clients = [];
  private readonly object _gate = new();
  private readonly string _token = Convert.ToHexString(RandomNumberGenerator.GetBytes(_tokenBytes));

  public bool IsExtensionConnected {
    get {
      lock (_gate) {
        return _clients.Count > 0;
      }
    }
  }

  public void Start() {
    TcpListener listener;
    try {
      listener = new TcpListener(IPAddress.Loopback, 0);
      listener.Start();
    } catch (Exception e) {
      Log.Write($"session link: cannot listen: {e.Message}");
      return;
    }
    int port = ((IPEndPoint)listener.LocalEndpoint).Port;
    Log.Write($"session link: listening on {port}");
    ExtensionSetup.PublishLink(port, _token);
    _ = Task.Run(() => AcceptLoopAsync(listener));
  }

  /// <summary>Ask the extension for the current session right now.</summary>
  public void RequestCookies() {
    foreach (Messenger<LinkMessage> client in Clients()) {
      _ = QueryAsync(client);
    }
  }

  /// <summary>
  /// The session we have stopped working: ask the extension to have the browser refresh it. The
  /// refreshed cookies arrive like any rotation.
  /// </summary>
  public void RequestRefresh() {
    Broadcast(LinkProtocol.Refresh);
  }

  private async Task AcceptLoopAsync(TcpListener listener) {
    _ = Task.Run(PingLoopAsync);
    while (true) {
      TcpClient client = await listener.AcceptTcpClientAsync();
      _ = Task.Run(() => ServeAsync(client));
    }
  }

  private async Task ServeAsync(TcpClient client) {
    using TcpClient _ = client;
    NetworkStream stream = client.GetStream();
    Dictionary<string, string>? headers = await ReadHandshakeAsync(stream);
    if (headers is null) {
      return;
    }

    if (!headers.TryGetValue("origin", out string? origin) || origin != _extensionOrigin
        || !headers.TryGetValue("sec-websocket-key", out string? key)) {
      await stream.WriteAsync("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"u8.ToArray());
      Log.Write($"session link: refused origin {origin ?? "(none)"}");
      return;
    }

    // RFC 6455 fixes SHA-1 for the handshake; it is not used for security here.
#pragma warning disable CA5350
    string accept =
        Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + _webSocketGuid)));
#pragma warning restore CA5350
    await stream.WriteAsync(Encoding.ASCII.GetBytes(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        + $"Sec-WebSocket-Accept: {accept}\r\n\r\n"));

    using WebSocket socket = WebSocket.CreateFromStream(
        stream, isServer: true, subProtocol: null, keepAliveInterval: TimeSpan.Zero);
    // A WebSocket takes one send at a time, so every frame queues here for one sender.
    Channel<string> outbox =
        Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });
    Task sending = SendLoopAsync(socket, outbox.Reader);
    var messenger = new Messenger<LinkMessage>(json => outbox.Writer.TryWrite(json), _messageTimeout);
    messenger.OnMessage(LinkProtocol.Cookies, cookies => {
      Deliver(cookies);
      return default(None);
    });
    // Replies, the Hello's included, arrive through this loop, so it runs before anything is sent.
    Task receiving = ReceiveLoopAsync(socket, messenger);
    try {
      try {
        await messenger.SendMessageAsync(LinkProtocol.Hello, _token);
      } catch (Exception e) {
        Log.Write($"session link: hello refused: {e.Message}");
        socket.Abort();
        return;
      }
      lock (_gate) {
        _clients.Add(messenger);
      }
      Log.Write("session link: extension connected");
      Connected?.Invoke();
      await receiving;
    } finally {
      bool wasConnected;
      lock (_gate) {
        wasConnected = _clients.Remove(messenger);
      }

      if (wasConnected) {
        Log.Write("session link: extension disconnected");
      }

      await receiving;
      outbox.Writer.TryComplete();
      await sending;
    }
  }

  /// <summary>Feeds every text frame to the messenger until the socket closes.</summary>
  private static async Task ReceiveLoopAsync(WebSocket socket, Messenger<LinkMessage> messenger) {
    try {
      while (socket.State == WebSocketState.Open) {
        string? message = await ReceiveTextAsync(socket);
        if (message is null) {
          break;
        }

        messenger.Receive(message);
      }
    } catch (Exception e) {
      Log.Write($"session link: {e.Message}");
    }
  }

  /// <summary>Sends the queued frames one at a time, as the socket requires.</summary>
  private static async Task SendLoopAsync(WebSocket socket, ChannelReader<string> outbox) {
    await foreach (string json in outbox.ReadAllAsync()) {
      try {
        await socket.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true,
                               CancellationToken.None);
      } catch (Exception e) {
        Log.Write($"session link send: {e.Message}");
      }
    }
  }

  private void Deliver(IReadOnlyList<GoogleCookie> cookies) {
    List<GoogleCookie> auth = GoogleCookies.AuthCookies(cookies);
    Log.Write($"session link: {auth.Count} auth cookies from the browser");
    CookiesReceived?.Invoke(auth);
  }

  private async Task QueryAsync(Messenger<LinkMessage> client) {
    try {
      Deliver(await client.SendMessageAsync(LinkProtocol.Query));
    } catch (Exception e) {
      Log.Write($"session link query: {e.Message}");
    }
  }

  private async Task PingLoopAsync() {
    using var timer = new PeriodicTimer(_pingInterval);
    while (await timer.WaitForNextTickAsync()) {
      Broadcast(LinkProtocol.Ping);
    }
  }

  /// <summary>Sends a message without data to every connected extension; failures are logged.</summary>
  private void Broadcast(Protocol<LinkMessage, None, None> message) {
    foreach (Messenger<LinkMessage> client in Clients()) {
      _ = client.SendMessageAsync(message).ContinueWith(
          t => Log.Write(
              $"session link {WireName.For(message.Type)}: {t.Exception?.InnerException?.Message}"),
          TaskContinuationOptions.OnlyOnFaulted);
    }
  }

  private Messenger<LinkMessage>[] Clients() {
    lock (_gate) {
      return [.. _clients];
    }
  }

  private static async Task<string?> ReceiveTextAsync(WebSocket socket) {
    var buffer = new byte[_receiveBufferBytes];
    using var message = new MemoryStream();
    while (true) {
      WebSocketReceiveResult received = await socket.ReceiveAsync(buffer, CancellationToken.None);
      if (received.MessageType == WebSocketMessageType.Close) {
        return null;
      }

      message.Write(buffer, 0, received.Count);

      if (received.EndOfMessage) {
        return Encoding.UTF8.GetString(message.ToArray());
      }
    }
  }

  /// <summary>Reads the HTTP upgrade request; header names lower-cased.</summary>
  private static async Task<Dictionary<string, string>?> ReadHandshakeAsync(NetworkStream stream) {
    var bytes = new List<byte>();
    var one = new byte[1];
    while (bytes.Count < _maxHandshakeBytes) {
      if (await stream.ReadAsync(one) == 0) {
        return null;
      }

      bytes.Add(one[0]);

      if (EndsWithBlankLine(bytes)) {
        break;
      }
    }
    string[] lines = Encoding.ASCII.GetString(bytes.ToArray())
        .Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
    return lines.Skip(1)
        .Select(line => line.Split(':', 2))
        .Where(header => header.Length == 2)
        .GroupBy(header => header[0].Trim().ToLowerInvariant())
        .ToDictionary(group => group.Key, group => group.First()[1].Trim());
  }

  private static bool EndsWithBlankLine(List<byte> bytes) {
    return bytes.Count >= 4 && bytes[^1] == '\n' && bytes[^2] == '\r'
        && bytes[^3] == '\n' && bytes[^4] == '\r';
  }
}
