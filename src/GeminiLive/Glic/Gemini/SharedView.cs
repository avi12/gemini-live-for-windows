namespace GeminiLive.Glic;

/// <summary>
/// What Gemini sees through the glic page: the shared display, or the webcam in its place. The page
/// pulls a picture, and a text copy of the window, whenever it wants one (<see cref="GlicHost"/>
/// routes those pulls here); this only decides which source answers.
/// </summary>
public sealed class SharedView {
  private WebcamSource? _camera;
  private ScreenGrabber.Frame? _lastFrame;

  /// <summary>Which display the frames come from.</summary>
  public MonitorInfo Monitor { get; set; } = Monitors.All()[0];

  /// <summary>
  /// The circled part of <see cref="Monitor"/> Gemini sees instead of all of it; null for the
  /// whole display. See <see cref="ILiveEngine.Region"/>.
  /// </summary>
  public System.Drawing.Rectangle? Region { get; set; }

  /// <summary>True while the webcam is the frame source instead of the screen.</summary>
  public bool UseCamera => _camera is not null;

  /// <summary>
  /// Shares the webcam instead of the screen, or switches back. Opening the camera triggers
  /// Windows' one-time camera consent for the app. Returns false if the camera could not be opened,
  /// leaving the screen as the source.
  /// </summary>
  public async Task<bool> UseCameraAsync(bool on) {
    if (on == UseCamera) {
      return true;
    }

    _lastFrame = null;  // the other source's picture is no stand-in for this one

    if (on) {
      try {
        var camera = new WebcamSource();
        await camera.InitializeAsync();
        _camera = camera;
        Log.Write("glic: sharing the camera");
        return true;
      } catch (Exception e) {
        Log.Write($"camera unavailable: {e.Message}");
        return false;
      }
    }

    WebcamSource? old = _camera;
    _camera = null;

    if (old is not null) {
      await old.DisposeAsync();
    }

    Log.Write("glic: sharing the screen");
    return true;
  }

  /// <summary>
  /// A picture for the page's pull: the camera's, or a sharp grab of the shared display made off
  /// the UI thread. A failed grab keeps the last good picture rather than leaving Gemini blind for
  /// a frame.
  /// </summary>
  public async Task<Picture?> CaptureAsync() {
    ScreenGrabber.Frame? frame;
    if (_camera is { } camera) {
      frame = camera.Grab();
    } else {
      MonitorInfo monitor = Monitor;
      System.Drawing.Rectangle? region = Region;
      frame = await Task.Run(() => Log.Attempt("grab", () => ScreenGrabber.Grab(
          monitor, ScreenGrabber.Detail.Sharp, region)));
    }

    frame ??= _lastFrame;
    _lastFrame = frame;
    return frame is null ? null
                         : new Picture(frame.Jpeg, ScreenGrabber.MimeType, frame.Width, frame.Height);
  }

  /// <summary>
  /// An exact text copy of the window on the shared display, read off the UI thread, which the page
  /// hands Gemini as the tab's page content next to each picture. None while the camera is shared,
  /// or while Gemini sees only a circled region: the whole window's text would pull it off that.
  /// </summary>
  public async Task<ScreenText.View?> ReadAsync() {
    if (UseCamera || Region is not null) {
      return null;
    }

    MonitorInfo monitor = Monitor;
    return await Task.Run(() => Log.Attempt("screen text", () => ScreenText.Read(monitor)));
  }
}
