using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GeminiLive.Glic;

/// <summary>
/// The loopback WebSocket the companion browser extension (extension/ in this repo) keeps open.
/// It pushes the browser's Google cookies on connect and on every rotation; we can also ask for
/// them on demand. Only the extension's pinned ID may connect.
/// </summary>
public sealed class SessionLink
{
    public const int Port = 8479;                                   // = LINK_URL in extension/background.js
    const string ExtensionOrigin = "chrome-extension://logpjalpegggobmjjimpacngnnhaakmd"; // from the manifest "key"
    static readonly TimeSpan PingInterval = TimeSpan.FromSeconds(20);

    readonly List<WebSocket> _clients = [];
    readonly object _gate = new();

    public event Action<IReadOnlyList<GoogleCookie>>? CookiesReceived;

    public bool IsExtensionConnected { get { lock (_gate) return _clients.Count > 0; } }

    public void Start() => _ = Task.Run(AcceptLoopAsync);

    /// <summary>Ask the extension for the current session right now.</summary>
    public void RequestCookies() => Broadcast("""{"type":"query"}""");

    async Task AcceptLoopAsync()
    {
        TcpListener listener;
        try
        {
            listener = new TcpListener(IPAddress.Loopback, Port);
            listener.Start();
        }
        catch (Exception e) { Log.Write($"session link: cannot listen on {Port}: {e.Message}"); return; }

        _ = Task.Run(PingLoopAsync);
        while (true)
        {
            var client = await listener.AcceptTcpClientAsync();
            _ = Task.Run(() => ServeAsync(client));
        }
    }

    async Task ServeAsync(TcpClient client)
    {
        using var _ = client;
        var stream = client.GetStream();
        var headers = await ReadHandshakeAsync(stream);
        if (headers is null) return;

        if (!headers.TryGetValue("origin", out var origin) || origin != ExtensionOrigin
            || !headers.TryGetValue("sec-websocket-key", out var key))
        {
            await stream.WriteAsync("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"u8.ToArray());
            Log.Write($"session link: refused origin {origin ?? "(none)"}");
            return;
        }

        var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
        await stream.WriteAsync(Encoding.ASCII.GetBytes(
            $"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"));

        using var socket = WebSocket.CreateFromStream(stream, isServer: true, subProtocol: null, keepAliveInterval: TimeSpan.Zero);
        lock (_gate) _clients.Add(socket);
        Log.Write("session link: extension connected");
        try
        {
            while (socket.State == WebSocketState.Open)
            {
                var message = await ReceiveTextAsync(socket);
                if (message is null) break;
                Handle(message);
            }
        }
        catch (Exception e) { Log.Write($"session link: {e.Message}"); }
        finally
        {
            lock (_gate) _clients.Remove(socket);
            Log.Write("session link: extension disconnected");
        }
    }

    void Handle(string message)
    {
        using var doc = JsonDocument.Parse(message);
        if (doc.RootElement.GetProperty("type").GetString() != "cookies") return;
        var cookies = GoogleCookies.Parse(doc.RootElement.GetProperty("cookies"));
        Log.Write($"session link: {cookies.Count} auth cookies from the browser");
        CookiesReceived?.Invoke(cookies);
    }

    async Task PingLoopAsync()
    {
        using var timer = new PeriodicTimer(PingInterval);
        while (await timer.WaitForNextTickAsync()) Broadcast("""{"type":"ping"}""");
    }

    void Broadcast(string json)
    {
        WebSocket[] clients;
        lock (_gate) clients = [.. _clients];
        var bytes = Encoding.UTF8.GetBytes(json);
        foreach (var c in clients)
            _ = c.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None)
                 .ContinueWith(t => Log.Write($"session link send: {t.Exception?.InnerException?.Message}"), TaskContinuationOptions.OnlyOnFaulted);
    }

    static async Task<string?> ReceiveTextAsync(WebSocket socket)
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        while (true)
        {
            var r = await socket.ReceiveAsync(buffer, CancellationToken.None);
            if (r.MessageType == WebSocketMessageType.Close) return null;
            message.Write(buffer, 0, r.Count);
            if (r.EndOfMessage) return Encoding.UTF8.GetString(message.ToArray());
        }
    }

    /// <summary>Reads the HTTP upgrade request; header names lower-cased.</summary>
    static async Task<Dictionary<string, string>?> ReadHandshakeAsync(NetworkStream stream)
    {
        var bytes = new List<byte>();
        var one = new byte[1];
        while (bytes.Count < 16 * 1024)
        {
            if (await stream.ReadAsync(one) == 0) return null;
            bytes.Add(one[0]);
            if (bytes.Count >= 4 && bytes[^1] == '\n' && bytes[^2] == '\r' && bytes[^3] == '\n' && bytes[^4] == '\r') break;
        }
        var lines = Encoding.ASCII.GetString(bytes.ToArray()).Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        return lines.Skip(1)
            .Select(l => l.Split(':', 2))
            .Where(p => p.Length == 2)
            .GroupBy(p => p[0].Trim().ToLowerInvariant())
            .ToDictionary(g => g.Key, g => g.First()[1].Trim());
    }
}
