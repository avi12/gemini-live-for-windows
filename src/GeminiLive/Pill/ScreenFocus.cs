using System.Windows;

namespace GeminiLive;

/// <summary>
/// What shows Gemini's view on screen: the frame around the shared display, and, for a circled
/// region, the chip that labels it (✕ and Esc hand back the whole display; dragging moves the
/// region). It acts on whichever engine <c>engine</c> returns.
/// </summary>
public sealed class ScreenFocus {
  /// <summary>Raised when what Gemini sees changed, so the pill can publish it.</summary>
  public event Action? Changed;

  private readonly ShareBorder _border = new();
  private readonly FocusChip _chip = new();
  private readonly Hotkey _escape;
  private readonly Func<ILiveEngine?> _engine;
  private System.Drawing.Rectangle? _dragStartRegion;  // the watched region when its chip was grabbed
  private bool _circling;  // the Circle to Search overlay is up

  public ScreenFocus(IntPtr hwnd, Func<ILiveEngine?> engine) {
    _engine = engine;
    _escape = CircleKey.Escape(hwnd, Unfocus);
    _chip.Dismissed += Unfocus;
    _chip.DragStarted += OnDragStarted;
    _chip.Dragged += OnDragged;
  }

  public bool IsCircling {
    get => _circling;
    set {
      _circling = value;
      UpdateEscape();
    }
  }

  public void Cover(MonitorInfo monitor) {
    _border.Cover(monitor);
  }

  public void HideBorder() {
    _border.Hide();
  }

  /// <summary>Has Gemini watch only <paramref name="region"/> of <paramref name="monitor"/>, live.</summary>
  public void FocusOn(MonitorInfo monitor, System.Drawing.Rectangle region) {
    if (_engine() is not { } engine) {
      return;  // it didn't start (no API key yet, or it failed)
    }

    if (!monitor.IsSameDisplay(engine.Monitor)) {
      engine.Share(monitor);
    }

    engine.Region = region;
    Show(monitor, region);
    Changed?.Invoke();
    Log.Write($"focused on {region.Width}×{region.Height} of {monitor.Description}");
  }

  /// <summary>Hands Gemini back the whole shared display.</summary>
  public void Unfocus() {
    if (_engine() is { Region: not null } engine) {
      engine.Region = null;
      _border.Cover(engine.Monitor);
      Log.Write("focus: whole display again");
    }

    _chip.Hide();
    UpdateEscape();
    Changed?.Invoke();
  }

  private void Show(MonitorInfo monitor, System.Drawing.Rectangle region) {
    _border.Cover(monitor, region);
    _chip.Attach(monitor, region);
  }

  private void OnDragStarted() {
    _dragStartRegion = _engine()?.Region;
  }

  /// <summary>
  /// Moves the watched region with the chip, by how far the pointer has travelled, never off the
  /// display. Gemini follows live, as the engine reads the region on every frame.
  /// </summary>
  private void OnDragged(Vector travelled) {
    if (_engine() is not { } engine || _dragStartRegion is not { } start) {
      return;
    }

    MonitorInfo monitor = engine.Monitor;
    var origin = new Rect(start.X, start.Y, start.Width, start.Height);
    Rect moved = CircleGeometry.Moved(origin, grip: default, pointer: origin.TopLeft + travelled,
                                      new Size(monitor.Width, monitor.Height));
    var region = new System.Drawing.Rectangle((int)moved.X, (int)moved.Y, start.Width, start.Height);
    engine.Region = region;
    Show(monitor, region);
  }

  /// <summary>
  /// Holds Esc only while Gemini sees a circled region - and not while the circle overlay is up,
  /// which needs Esc for its own cancel.
  /// </summary>
  private void UpdateEscape() {
    if (_engine()?.Region is not null && !_circling) {
      _escape.Register();
    } else {
      _escape.Unregister();
    }
  }
}
