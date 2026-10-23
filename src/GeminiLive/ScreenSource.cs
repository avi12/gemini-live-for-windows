using System.Security.Cryptography;

namespace GeminiLive;

/// <summary>
/// Pushes stills of one monitor about once a second - the shape of "video" Gemini Live uses on
/// every platform (stills, not a video stream). Unchanged frames are skipped, with a periodic
/// refresh so the model's context never goes stale. Used by the API-key engine; the Google-account
/// engine lets Gemini pull frames itself.
/// </summary>
public sealed class ScreenSource(MonitorInfo monitor) : IDisposable {
  public event Action<byte[]>? Frame;

  private static readonly TimeSpan _interval = TimeSpan.FromSeconds(1);
  private static readonly TimeSpan _refresh = TimeSpan.FromSeconds(10);

  private readonly CancellationTokenSource _cts = new();

  public MonitorInfo Monitor {
    get => _monitor;
    set {
      _monitor = value;
      _lastHash = null;  // force an immediate frame of the new display
    }
  }

  private volatile MonitorInfo _monitor = monitor;
  private byte[]? _lastHash;
  private DateTime _lastSent;

  public void Start() {
    _ = Task.Run(LoopAsync);
  }

  public void Dispose() {
    _cts.Cancel();
  }

  private async Task LoopAsync() {
    using var timer = new PeriodicTimer(_interval);
    do {
      try {
        CaptureOnce();
      } catch (Exception e) {
        Log.Write($"screen capture failed: {e.Message}");
      }
    } while (await timer.WaitForNextTickAsync(_cts.Token).ConfigureAwait(false));
  }

  private void CaptureOnce() {
    byte[] jpeg = ScreenGrabber.Grab(_monitor).Jpeg;
    byte[] hash = SHA256.HashData(jpeg);
    bool unchanged = _lastHash is not null && hash.AsSpan().SequenceEqual(_lastHash);
    if (unchanged && DateTime.UtcNow - _lastSent < _refresh) {
      return;
    }

    _lastHash = hash;
    _lastSent = DateTime.UtcNow;
    Frame?.Invoke(jpeg);
  }
}
