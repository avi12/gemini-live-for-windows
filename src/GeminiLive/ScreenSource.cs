using System.Security.Cryptography;

namespace GeminiLive;

/// <summary>
/// Pushes stills of one monitor about once a second - the shape of "video" Gemini Live uses on
/// every platform (stills, not a video stream). Unchanged frames are skipped, with a periodic
/// refresh so the model's context never goes stale. Used by the API-key engine; the Google-account
/// engine lets Gemini pull frames itself.
/// </summary>
public sealed class ScreenSource(MonitorInfo monitor) : IDisposable
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(1);
    static readonly TimeSpan Refresh = TimeSpan.FromSeconds(10);

    readonly CancellationTokenSource _cts = new();
    volatile MonitorInfo _monitor = monitor;
    byte[]? _lastHash;
    DateTime _lastSent;

    public event Action<byte[]>? Frame;

    public void Start() => _ = Task.Run(LoopAsync);

    public MonitorInfo Monitor
    {
        get => _monitor;
        set { _monitor = value; _lastHash = null; } // force an immediate frame of the new display
    }

    async Task LoopAsync()
    {
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try { CaptureOnce(); }
            catch (Exception e) { Log.Write($"screen capture failed: {e.Message}"); }
        } while (await timer.WaitForNextTickAsync(_cts.Token).ConfigureAwait(false));
    }

    void CaptureOnce()
    {
        var jpeg = ScreenGrabber.Grab(_monitor).Jpeg;
        var hash = MD5.HashData(jpeg);
        if (_lastHash is not null && hash.AsSpan().SequenceEqual(_lastHash) && DateTime.UtcNow - _lastSent < Refresh) return;
        _lastHash = hash;
        _lastSent = DateTime.UtcNow;
        Frame?.Invoke(jpeg);
    }

    public void Dispose() => _cts.Cancel();
}
