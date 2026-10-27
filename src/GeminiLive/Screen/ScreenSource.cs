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

  /// <summary>
  /// What the loop captures, as one immutable snapshot swapped whole. It is set from the UI thread
  /// and read by the capture loop, so the loop never pairs one display with another's region (and
  /// a nullable Rectangle on its own is too wide to read atomically).
  /// </summary>
  private volatile Target _target = new(monitor, Region: null);
  private byte[]? _lastHash;
  private DateTime _lastSent;

  /// <summary>The display to send; setting it shares the new one whole, dropping any region.</summary>
  public MonitorInfo Monitor {
    get => _target.Monitor;
    set {
      _target = new Target(value, Region: null);
      _lastHash = null;  // force an immediate frame of the new display
    }
  }

  /// <summary>
  /// The circled part of the monitor to send instead of all of it; null for the whole display.
  /// </summary>
  public System.Drawing.Rectangle? Region {
    get => _target.Region;
    set => _target = _target with { Region = value };
  }

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
    Target target = _target;
    byte[] jpeg = ScreenGrabber.Grab(target.Monitor, region: target.Region).Jpeg;
    byte[] hash = SHA256.HashData(jpeg);
    bool unchanged = _lastHash is not null && hash.AsSpan().SequenceEqual(_lastHash);
    if (unchanged && DateTime.UtcNow - _lastSent < _refresh) {
      return;
    }

    _lastHash = hash;
    _lastSent = DateTime.UtcNow;
    Frame?.Invoke(jpeg);
  }

  /// <summary>A display and, optionally, the part of it (in its physical pixels) to send.</summary>
  private sealed record Target(MonitorInfo Monitor, System.Drawing.Rectangle? Region);
}
