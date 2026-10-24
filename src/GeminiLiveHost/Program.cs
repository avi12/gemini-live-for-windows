using System.Buffers.Binary;
using System.Text;
using GeminiLive.Glic;

namespace GeminiLive.Host;

/// <summary>
/// The native messaging host <see cref="NativeProtocol.HostName"/>: the browser starts it when the
/// companion extension connects (with the extension's origin as the first argument, which the
/// browser has already checked against the manifest), and it answers <see cref="NativeProtocol"/>
/// requests until the extension lets go. Messages are framed as the browser does: a 4-byte
/// little-endian length, then that much UTF-8 JSON. Stdout carries frames only, nothing else.
/// </summary>
internal static class Program {
  private const int _lengthBytes = 4;
  // The extension only ever sends small requests; anything bigger isn't one of ours.
  private const int _maxMessageBytes = 1024 * 1024;
  private static readonly TimeSpan _messageTimeout = TimeSpan.FromSeconds(10);

  public static async Task Main() {
    using Stream input = Console.OpenStandardInput();
    using Stream output = Console.OpenStandardOutput();
    var gate = new object();

    void Post(string json) {
      byte[] body = Encoding.UTF8.GetBytes(json);
      var header = new byte[_lengthBytes];
      BinaryPrimitives.WriteInt32LittleEndian(header, body.Length);
      lock (gate) {
        output.Write(header);
        output.Write(body);
        output.Flush();
      }
    }

    var messenger = new Messenger<NativeMessage>(Post, _messageTimeout);
    messenger.OnMessage(NativeProtocol.Link, _ => LinkFile.Read());
    try {
      while (await ReadFrameAsync(input) is { } json) {
        messenger.Receive(json);
      }
    } catch (Exception e) {
      Log.Write($"native host: {e.Message}");
    }
  }

  /// <summary>The next message from the browser; null once it closes our input.</summary>
  private static async Task<string?> ReadFrameAsync(Stream input) {
    var header = new byte[_lengthBytes];
    if (await input.ReadAtLeastAsync(header, _lengthBytes, throwOnEndOfStream: false) < _lengthBytes) {
      return null;
    }

    int length = BinaryPrimitives.ReadInt32LittleEndian(header);
    if (length is < 0 or > _maxMessageBytes) {
      throw new InvalidDataException($"message of {length} bytes");
    }

    var body = new byte[length];
    await input.ReadExactlyAsync(body);
    return Encoding.UTF8.GetString(body);
  }
}
