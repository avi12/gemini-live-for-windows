using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GeminiLive.Glic;

/// <summary>
/// Every message type on the link, both directions (MessageType in link.ts). The wire value is
/// <see cref="WireName"/>'s lower-cased name: "query", "refresh", …
/// </summary>
public enum LinkMessageType {
  Cookies,  // extension → app: the current Google cookies
  Query,    // app → extension: send the cookies now
  Refresh,  // app → extension: ours stopped working; refresh the browser's session, then send it
  Ping,     // app → extension: keepalive
  Pong,     // extension → app: keepalive answer
}

/// <summary>
/// The loopback WebSocket the companion browser extension (extension/ in this repo) keeps open.
/// It pushes the browser's Google cookies on connect and on every rotation; we can also ask for
/// them on demand. Only the extension's pinned ID may connect.
/// </summary>
public sealed class SessionLink {
  public event Action<IReadOnlyList<GoogleCookie>>? CookiesReceived;
  public event Action? Connected;

  private const int _port = 8479;  // = LINK_URL in extension/src/lib/link.ts
  // From the manifest "key", so only our extension can hand us a Google session.
  private const string _extensionOrigin = "chrome-extension://logpjalpegggobmjjimpacngnnhaakmd";
  private const string _webSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";  // RFC 6455
  private const int _maxHandshakeBytes = 16 * 1024;
  private const int _receiveBufferBytes = 64 * 1024;
  private static readonly TimeSpan _pingInterval = TimeSpan.FromSeconds(20);

  private readonly List<WebSocket> _clients = [];
  private readonly object _gate = new();

  public bool IsExtensionConnected {
    get {
      lock (_gate) {
        return _clients.Count > 0;
      }
    }
  }

  public void Start() {
    _ = Task.Run(AcceptLoopAsync);
  }

  /// <summary>Ask the extension for the current session right now.</summary>
  public void RequestCookies() {
    Send(LinkMessageType.Query);
  }

  /// <summary>
  /// The session we have stopped working: ask the extension to have the browser refresh it. The
  /// refreshed cookies arrive like any rotation.
  /// </summary>
  public void RequestRefresh() {
    Send(LinkMessageType.Refresh);
  }

  private async Task AcceptLoopAsync() {
    TcpListener listener;
    try {
      listener = new TcpListener(IPAddress.Loopback, _port);
      listener.Start();
    } catch (Exception e) {
      Log.Write($"session link: cannot listen on {_port}: {e.Message}");
      return;
    }

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
    lock (_gate) {
      _clients.Add(socket);
    }
    Log.Write("session link: extension connected");
    Connected?.Invoke();
    try {
      while (socket.State == WebSocketState.Open) {
        string? message = await ReceiveTextAsync(socket);
        if (message is null) {
          break;
        }
        Handle(message);
      }
    } catch (Exception e) {
      Log.Write($"session link: {e.Message}");
    } finally {
      lock (_gate) {
        _clients.Remove(socket);
      }
      Log.Write("session link: extension disconnected");
    }
  }

  private void Handle(string message) {
    using JsonDocument doc = JsonDocument.Parse(message);
    if (doc.RootElement.GetProperty("type").GetString() != WireName.Of(LinkMessageType.Cookies)) {
      return;
    }
    List<GoogleCookie> cookies = GoogleCookies.Parse(doc.RootElement.GetProperty("cookies"));
    Log.Write($"session link: {cookies.Count} auth cookies from the browser");
    CookiesReceived?.Invoke(cookies);
  }

  private async Task PingLoopAsync() {
    using var timer = new PeriodicTimer(_pingInterval);
    while (await timer.WaitForNextTickAsync()) {
      Send(LinkMessageType.Ping);
    }
  }

  private void Send(LinkMessageType type) {
    Broadcast(JsonSerializer.Serialize(new { type = WireName.Of(type) }));
  }

  private void Broadcast(string json) {
    WebSocket[] clients;
    lock (_gate) {
      clients = [.. _clients];
    }
    byte[] bytes = Encoding.UTF8.GetBytes(json);
    foreach (WebSocket client in clients) {
      _ = client.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None)
          .ContinueWith(
              t => Log.Write($"session link send: {t.Exception?.InnerException?.Message}"),
              TaskContinuationOptions.OnlyOnFaulted);
    }
  }

  private static async Task<string?> ReceiveTextAsync(WebSocket socket) {
    var buffer = new byte[_receiveBufferBytes];
    using var message = new MemoryStream();
    while (true) {
      WebSocketReceiveResult r = await socket.ReceiveAsync(buffer, CancellationToken.None);
      if (r.MessageType == WebSocketMessageType.Close) {
        return null;
      }
      message.Write(buffer, 0, r.Count);
      if (r.EndOfMessage) {
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
        .Select(l => l.Split(':', 2))
        .Where(p => p.Length == 2)
        .GroupBy(p => p[0].Trim().ToLowerInvariant())
        .ToDictionary(g => g.Key, g => g.First()[1].Trim());
  }

  private static bool EndsWithBlankLine(List<byte> bytes) {
    return bytes.Count >= 4 && bytes[^1] == '\n' && bytes[^2] == '\r'
        && bytes[^3] == '\n' && bytes[^4] == '\r';
  }
}
