using Windows.Graphics.Imaging;
using Windows.Media.Capture;
using Windows.Media.Capture.Frames;
using Windows.Media.MediaProperties;
using Windows.Storage.Streams;

namespace GeminiLive;

/// <summary>
/// One JPEG still of the default webcam, on demand - the camera equivalent of
/// <see cref="ScreenGrabber"/>. Gemini Live sees "video" as a frame pulled per viewport tick, so the
/// Google engine can hand it the camera the same way it hands it the screen: Glic never opens the
/// device itself (<c>glic_bridge.js</c> blocks its getUserMedia video); we capture here in-process
/// and return the frame it pulls.
///
/// Frames come off the video stream through a <see cref="MediaFrameReader"/> - headless, with no
/// preview element, and working on the webcams that have no independent photo stream (where the
/// low-lag photo API throws). The reader runs continuously into a single latest-JPEG slot, encoded
/// off the pull, so each pull is an instant read. Downscaled to match <see cref="ScreenGrabber"/>.
/// MediaCapture has thread affinity; created and disposed on the thread that owns it (the WPF UI
/// thread, where <see cref="Glic.GlicHost"/> lives).
/// </summary>
public sealed class WebcamSource : IAsyncDisposable {
  private const int _maxEdge = 1280;
  private static readonly TimeSpan _minGap = TimeSpan.FromMilliseconds(200);  // ~5 fps encode cap

  private MediaCapture? _capture;
  private MediaFrameReader? _reader;

  private readonly object _gate = new();
  private byte[]? _latestJpeg;
  private int _width;
  private int _height;
  private DateTime _lastEncoded;

  /// <summary>Opens the default camera and starts streaming. Throws if there is none.</summary>
  public async Task InitializeAsync() {
    (MediaFrameSourceGroup group, MediaFrameSourceInfo info) = await FindColorCameraAsync();
    var capture = new MediaCapture();
    await capture.InitializeAsync(new MediaCaptureInitializationSettings {
      SourceGroup = group,
      SharingMode = MediaCaptureSharingMode.ExclusiveControl,
      MemoryPreference = MediaCaptureMemoryPreference.Cpu,  // SoftwareBitmap backed by CPU memory
      StreamingCaptureMode = StreamingCaptureMode.Video,
    });

    MediaFrameSource source = capture.FrameSources[info.Id];
    MediaFrameReader reader =
        await capture.CreateFrameReaderAsync(source, MediaEncodingSubtypes.Bgra8);
    reader.FrameArrived += OnFrameArrived;
    MediaFrameReaderStartStatus status = await reader.StartAsync();
    if (status != MediaFrameReaderStartStatus.Success) {
      reader.FrameArrived -= OnFrameArrived;
      capture.Dispose();
      throw new InvalidOperationException($"camera reader start: {status}");
    }

    _capture = capture;
    _reader = reader;
  }

  /// <summary>The latest JPEG still, or null until the first frame has been encoded.</summary>
  public ScreenGrabber.Frame? Grab() {
    lock (_gate) {
      return _latestJpeg is { } jpeg ? new ScreenGrabber.Frame(jpeg, _width, _height) : null;
    }
  }

  public async ValueTask DisposeAsync() {
    if (_reader is not null) {
      _reader.FrameArrived -= OnFrameArrived;
      await _reader.StopAsync();
      _reader.Dispose();
      _reader = null;
    }

    _capture?.Dispose();
    _capture = null;
  }

  private static async Task<(MediaFrameSourceGroup, MediaFrameSourceInfo)> FindColorCameraAsync() {
    foreach (MediaFrameSourceGroup group in await MediaFrameSourceGroup.FindAllAsync()) {
      foreach (MediaFrameSourceInfo info in group.SourceInfos) {
        if (info.SourceKind == MediaFrameSourceKind.Color
            && info.MediaStreamType is MediaStreamType.VideoPreview or MediaStreamType.VideoRecord) {
          return (group, info);
        }
      }
    }
    throw new InvalidOperationException("no color camera found");
  }

  private void OnFrameArrived(MediaFrameReader sender, MediaFrameArrivedEventArgs e) {
    using MediaFrameReference? reference = sender.TryAcquireLatestFrame();
    SoftwareBitmap? bitmap = reference?.VideoMediaFrame?.SoftwareBitmap;
    if (bitmap is null) {
      return;
    }

    DateTime now = DateTime.UtcNow;
    if (now - _lastEncoded < _minGap) {
      return;  // cap the encode rate; the pull only needs about one a second
    }

    _lastEncoded = now;
    _ = EncodeAsync(SoftwareBitmap.Copy(bitmap));  // own a copy; the frame is released at scope exit
  }

  private async Task EncodeAsync(SoftwareBitmap frame) {
    SoftwareBitmap bgra = frame.BitmapPixelFormat == BitmapPixelFormat.Bgra8
        ? frame
        : SoftwareBitmap.Convert(frame, BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
    try {
      using var stream = new InMemoryRandomAccessStream();
      BitmapEncoder encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.JpegEncoderId, stream);
      encoder.SetSoftwareBitmap(bgra);
      double scale = Math.Min(1.0, (double)_maxEdge / Math.Max(bgra.PixelWidth, bgra.PixelHeight));
      int width = (int)(bgra.PixelWidth * scale);
      int height = (int)(bgra.PixelHeight * scale);
      if (scale < 1.0) {
        encoder.BitmapTransform.ScaledWidth = (uint)width;
        encoder.BitmapTransform.ScaledHeight = (uint)height;
      }

      await encoder.FlushAsync();

      var bytes = new byte[stream.Size];
      using (var reader = new DataReader(stream.GetInputStreamAt(0))) {
        await reader.LoadAsync((uint)stream.Size);
        reader.ReadBytes(bytes);
      }
      lock (_gate) {
        _latestJpeg = bytes;
        _width = width;
        _height = height;
      }
    } catch (Exception e) {
      Log.Write($"camera encode failed: {e.Message}");
    } finally {
      if (!ReferenceEquals(bgra, frame)) {
        bgra.Dispose();
      }

      frame.Dispose();
    }
  }
}
