using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Drawing = System.Drawing;

namespace GeminiLive;

/// <summary>What the user asked to do with the part of the screen they circled.</summary>
public enum CircleAction {
  /// <summary>Hand the crop to Gemini, to ask about it.</summary>
  AskGemini,
  /// <summary>Look the crop up with Google Lens.</summary>
  Lens,
}

/// <summary>
/// The circled part of the screen: as a sharp JPEG (for Lens), where it is on the monitor in
/// physical pixels (for Gemini to keep watching it live), and what to do with it.
/// </summary>
public sealed record CircleSelection(ScreenGrabber.Frame Crop, Drawing.Rectangle Region, CircleAction Action);

/// <summary>
/// Circle to Search's freeze-and-draw surface: one monitor, frozen as a full-resolution still the
/// moment it opens. The user loops around something with the mouse, and the loop becomes a
/// selection they can redraw, resize or drag; the action pill riding along with it (or Enter / L)
/// sends the crop to Gemini or Lens. This window owns the lifetime, the keys and the gesture state
/// machine; <see cref="CircleChrome"/> draws it all and <see cref="CircleGeometry"/> does the maths.
/// Unlike our other overlays it takes focus (it needs the keyboard), but like them it stays out of
/// screen captures, the taskbar and Alt+Tab.
/// </summary>
public sealed class CircleOverlay : Window {
  /// <summary>What the mouse is doing between press and release.</summary>
  private enum Gesture {
    /// <summary>Nothing held: moving the mouse only updates the cursor.</summary>
    None,
    /// <summary>Drawing a freehand loop.</summary>
    Stroke,
    /// <summary>Dragging a corner of the selection.</summary>
    Resize,
    /// <summary>Dragging the whole selection by its interior.</summary>
    Move,
    /// <summary>In text mode: dragging across words (or empty space, for a rubber band) to select them.</summary>
    TextSelect,
  }

  private const string _readingHint = "Reading text…";
  private const string _noTextHint = "No text found";
  private const string _textHint = "Drag across the text to select it  ·  Esc to go back";
  private const string _copiedHint = "Copied";
  private const string _copyFailedHint = "Couldn't copy";

  // How long after opening a deactivation is still just Windows settling, not the user leaving.
  private static readonly TimeSpan _settleTime = TimeSpan.FromMilliseconds(800);

  private readonly MonitorInfo _monitor;
  private readonly Drawing.Bitmap _frozen;
  private readonly IntPtr _hwnd;
  private readonly TaskCompletionSource<CircleSelection?> _result = new();
  private readonly CircleChrome _chrome;
  private readonly bool _askOnRelease;  // see SelectAsync
  private readonly Stopwatch _openedAt = Stopwatch.StartNew();
  private Rect _selection = Rect.Empty;
  private Gesture _gesture = Gesture.None;
  private CircleGeometry.CornerGrip _resizeGrip;
  // Where in the selection the move grabbed it, so the selection doesn't jump to the pointer.
  private Vector _moveGrip;
  private bool _finished;
  private CircleSelection? _answer;  // set by Finish; null when cancelled

  // Text mode: the words OCR found (in DIPs, reading order) and which of them are selected.
  private CircleGeometry.TextWord[] _words = [];
  private int[] _picked = [];
  private bool _reading;  // OCR is running
  private bool _textMode;
  // Where a text drag began, and the word under it (-1: empty space, so the drag is a rubber band).
  private Point _textOrigin;
  private int _textAnchor;

  /// <summary>
  /// Esc, Enter, L and T as global hotkeys while open (<see cref="CircleKey.Overlay"/>): the window
  /// may never win the foreground, and then key presses go to the app beneath it.
  /// </summary>
  private Hotkey[] _keys = [];

  /// <summary>
  /// Ctrl+C, held only while text mode has words selected (<see cref="Pick"/>), so the rest of the
  /// time other apps keep it.
  /// </summary>
  private Hotkey? _copyKey;

  /// <summary>Builds the surface over an already frozen still; <see cref="SelectAsync"/> opens it.</summary>
  private CircleOverlay(MonitorInfo monitor, Drawing.Bitmap frozen, bool askOnRelease) {
    _monitor = monitor;
    _frozen = frozen;
    _askOnRelease = askOnRelease;
    WindowStyle = WindowStyle.None;
    ResizeMode = ResizeMode.NoResize;
    ShowInTaskbar = false;
    Topmost = true;
    // Transparent until the frozen screenshot paints: the window is shown at WPF's default size a
    // moment before Place() stretches it over the display, and a solid background flashed there as
    // a black rectangle. The screenshot covers every pixel, so nothing underneath ever shows.
    AllowsTransparency = true;
    Background = Brushes.Transparent;
    Cursor = Cursors.Cross;
    UseLayoutRounding = true;
    SetResourceReference(FontFamilyProperty, "LiveFont");
    _chrome = new CircleChrome(frozen, askOnRelease, new CircleChrome.Actions(Finish, SelectText, Copy, LeaveText));
    Content = _chrome.Root;
    _hwnd = Overlay.Prepare(this, clickThrough: false, focusable: true);
    // Moving onto a monitor of another DPI makes WPF apply Windows' suggested (rescaled) bounds
    // after this event; placing again once it has keeps the window exactly on the monitor.
    DpiChanged += (_, _) => Dispatcher.BeginInvoke(Place);
  }

  /// <summary>
  /// Freezes <paramref name="monitor"/> and lets the user circle part of it; the crop and the
  /// chosen action, or null when they cancel. Call on the UI thread. The overlay is closed before
  /// the task completes, so whatever runs next sees the real screen again. With
  /// <paramref name="askOnRelease"/> (Gemini Live is already running) there are no buttons: the
  /// first loop the user finishes is the answer, as <see cref="CircleAction.AskGemini"/>.
  /// </summary>
  public static Task<CircleSelection?> SelectAsync(MonitorInfo monitor, bool askOnRelease) {
    // Captured before the window exists, so the still is the screen as the user last saw it.
    Drawing.Bitmap frozen = ScreenGrabber.Capture(monitor);
    try {
      var overlay = new CircleOverlay(monitor, frozen, askOnRelease);
      overlay.Open();
      return overlay._result.Task;
    } catch {
      frozen.Dispose();
      throw;
    }
  }

  /// <summary>
  /// Esc backs out, Enter asks Gemini, L asks Lens, T selects text, Ctrl+C copies the selected
  /// text - at any point, without the mouse.
  /// </summary>
  protected override void OnPreviewKeyDown(KeyEventArgs e) {
    base.OnPreviewKeyDown(e);
    switch (e.Key) {
      case Key.Escape:
        Escape();
        break;
      case Key.T:
        SelectText();
        break;
      case Key.C when Keyboard.Modifiers == ModifierKeys.Control:
        Copy();
        break;
      case Key.Enter:
        Finish(CircleAction.AskGemini);
        break;
      case Key.L:
        Finish(CircleAction.Lens);
        break;
      default:
        return;
    }

    e.Handled = true;
  }

  /// <summary>
  /// A press near a corner resizes the selection; inside it drags the whole selection, so a stray
  /// click can't throw it away; anywhere outside it starts a new loop. In text mode a press starts
  /// selecting words instead, and while the text is being read it does nothing.
  /// </summary>
  protected override void OnMouseLeftButtonDown(MouseButtonEventArgs e) {
    base.OnMouseLeftButtonDown(e);
    Point point = e.GetPosition(_chrome.Root);
    if (_reading) {
      e.Handled = true;
      return;
    }

    if (_textMode) {
      BeginTextSelect(point, e.ClickCount);
    } else if (CircleGeometry.NearestCorner(_selection, point) is { } corner) {
      BeginResize(corner);
    } else if (_selection.Contains(point)) {
      BeginMove(point);
    } else {
      BeginStroke(point);
    }

    CaptureMouse();
    e.Handled = true;
  }

  /// <summary>
  /// Extends the loop, the resize or the move while held; otherwise shows what a press would do.
  /// </summary>
  protected override void OnMouseMove(MouseEventArgs e) {
    base.OnMouseMove(e);
    Point point = e.GetPosition(_chrome.Root);
    switch (_gesture) {
      case Gesture.Stroke:
        _chrome.ExtendStroke(point);
        break;
      case Gesture.Resize:
        Select(_resizeGrip.Follow(point, _chrome.Screen));
        break;
      case Gesture.Move:
        Select(CircleGeometry.Moved(_selection, _moveGrip, point, _chrome.Screen));
        break;
      case Gesture.TextSelect:
        ExtendTextSelect(point);
        break;
      default:
        Cursor = HoverCursor(point);
        break;
    }
  }

  /// <summary>Releasing ends the gesture through <see cref="OnLostMouseCapture"/>.</summary>
  protected override void OnMouseLeftButtonUp(MouseButtonEventArgs e) {
    base.OnMouseLeftButtonUp(e);

    if (IsMouseCaptured) {
      ReleaseMouseCapture();
    }
  }

  /// <summary>
  /// Ends the gesture however capture was lost - a release, or Windows taking it mid-drag - so a
  /// loop is never left half-drawn.
  /// </summary>
  protected override void OnLostMouseCapture(MouseEventArgs e) {
    base.OnLostMouseCapture(e);
    Gesture ended = _gesture;
    _gesture = Gesture.None;

    if (ended == Gesture.Stroke) {
      EndStroke();
    } else if (ended == Gesture.TextSelect) {
      _chrome.ShowBand(null);
    }
  }

  /// <summary>Right-click is the mouse's Esc.</summary>
  protected override void OnMouseRightButtonDown(MouseButtonEventArgs e) {
    base.OnMouseRightButtonDown(e);
    Escape();
    e.Handled = true;
  }

  /// <summary>
  /// Switching away cancels: a frozen, topmost screen the user can no longer reach would
  /// otherwise sit over everything. Not in the first moments, though: the hotkey's own key
  /// releases and our grab of the foreground make Windows shuffle activation as the overlay
  /// opens, and cancelling on that closed it before it could be used.
  /// </summary>
  protected override void OnDeactivated(EventArgs e) {
    base.OnDeactivated(e);

    if (_openedAt.Elapsed < _settleTime) {
      Log.Write("circle: ignored a deactivation while opening");
      return;
    }

    Log.Write("circle: cancelled by switching away");
    Cancel();
  }

  /// <summary>Any close (Alt+F4 included) counts as finished, so nothing closes it twice.</summary>
  protected override void OnClosing(CancelEventArgs e) {
    base.OnClosing(e);
    _finished = true;
  }

  /// <summary>
  /// Frees the still and answers: the chosen action, or "cancelled". Answering only here, once
  /// the window is gone, keeps the promise that the overlay is closed before the task completes.
  /// </summary>
  protected override void OnClosed(EventArgs e) {
    base.OnClosed(e);

    // Before answering: the caller takes Esc back for itself as soon as the task completes.
    foreach (Hotkey key in _keys) {
      key.Unregister();
    }

    _copyKey?.Unregister();
    _frozen.Dispose();
    _result.TrySetResult(_answer);
  }

  /// <summary>
  /// Shows the overlay over exactly its monitor, takes its keys, hands it the keyboard, and brings
  /// in the chrome.
  /// </summary>
  private void Open() {
    // Shown at WPF's default size first, then stretched by Place(): invisible until that has been
    // laid out and painted, or a smaller copy of the screenshot flashes at the start.
    Opacity = 0;
    Show();
    Place();
    Dispatcher.BeginInvoke(DispatcherPriority.ContextIdle, () => Opacity = 1);
    _keys = CircleKey.Overlay(_hwnd, Escape, Finish, SelectText);
    _copyKey = CircleKey.Copy(_hwnd, Copy);
    foreach (Hotkey key in _keys) {
      key.Register();
    }

    Overlay.BringToFront(_hwnd);
    Activate();
    Keyboard.Focus(this);
    _chrome.Enter();
  }

  /// <summary>Covers the monitor's physical bounds.</summary>
  private void Place() {
    Overlay.Place(_hwnd, _monitor.X, _monitor.Y, _monitor.Width, _monitor.Height);
  }

  /// <summary>Starts a fresh loop, dropping any earlier selection.</summary>
  private void BeginStroke(Point point) {
    _gesture = Gesture.Stroke;
    ClearSelection();
    _chrome.BeginStroke(point);
  }

  /// <summary>
  /// The loop fades either way; one big enough becomes the selection, a smaller one is ignored and
  /// drawing simply carries on. With <see cref="_askOnRelease"/> the loop itself is the request.
  /// </summary>
  private void EndStroke() {
    IEnumerable<Point> loop = _chrome.EndStroke();
    if (CircleGeometry.LoopSelection(loop, _chrome.Screen) is not { } drawn) {
      return;
    }

    if (_askOnRelease) {
      _selection = drawn;
      Finish(CircleAction.AskGemini);
      return;
    }

    Select(drawn);
    _chrome.SnapIn(drawn);
  }

  /// <summary>Grabs <paramref name="corner"/>; the opposite corner stays put while it moves.</summary>
  private void BeginResize(Point corner) {
    _gesture = Gesture.Resize;
    _resizeGrip = CircleGeometry.CornerGrip.Grab(_selection, corner);
  }

  /// <summary>Grabs the selection at <paramref name="point"/>, to drag it whole.</summary>
  private void BeginMove(Point point) {
    _gesture = Gesture.Move;
    _moveGrip = point - _selection.TopLeft;
  }

  /// <summary>
  /// A diagonal resize arrow over a corner, the four-way move arrow over the rest of the selection,
  /// the drawing cross everywhere else.
  /// </summary>
  private Cursor HoverCursor(Point point) {
    if (_textMode) {
      return CircleGeometry.WordAt(_words, point) >= 0 ? Cursors.IBeam : Cursors.Arrow;
    }

    if (CircleGeometry.NearestCorner(_selection, point) is not { } corner) {
      return _selection.Contains(point) ? Cursors.SizeAll : Cursors.Cross;
    }

    return CircleGeometry.IsFallingCorner(_selection, corner) ? Cursors.SizeNWSE : Cursors.SizeNESW;
  }

  /// <summary>Makes <paramref name="area"/> the selection, and shows it.</summary>
  private void Select(Rect area) {
    bool fresh = _selection.IsEmpty;
    _selection = area;
    _chrome.ShowSelection(area, fresh);
  }

  /// <summary>Back to no selection.</summary>
  private void ClearSelection() {
    if (_selection.IsEmpty) {
      return;
    }

    _selection = Rect.Empty;
    _chrome.ClearSelection();
  }

  /// <summary>
  /// Answers with the crop. The overlay hides first, so the screen unfreezes at once, and closes
  /// before the task completes.
  /// </summary>
  private void Finish(CircleAction action) {
    if (_finished || _selection.IsEmpty) {
      return;
    }

    _finished = true;
    Hide();
    Drawing.Rectangle region = CircleGeometry.PixelRegion(_selection, _chrome.Screen, _frozen.Size);
    ScreenGrabber.Frame? crop = Log.Attempt("circle crop", () =>
        ScreenGrabber.Encode(_frozen, region, ScreenGrabber.Detail.Sharp));
    _answer = crop is null ? null : new CircleSelection(crop, region, action);
    Close();
  }

  /// <summary>
  /// Esc, one step at a time: in text mode first clears the selected words, then leaves text mode;
  /// anywhere else it cancels.
  /// </summary>
  private void Escape() {
    if (!_textMode) {
      Cancel();
      return;
    }

    if (_picked.Length > 0) {
      Pick([]);
      return;
    }

    LeaveText();
  }

  /// <summary>
  /// Reads the text off the still - inside the selection when there is one, else the whole screen -
  /// and, if there is any, enters text mode over it. Ignored where there are no buttons
  /// (<see cref="_askOnRelease"/>) and while a read or text mode is already under way.
  /// </summary>
  private async void SelectText() {
    if (_askOnRelease || _finished || _reading || _textMode) {
      return;
    }

    _reading = true;
    _chrome.SetReading(true, _readingHint);
    Drawing.Size still = _frozen.Size;
    Drawing.Rectangle? region = _selection.IsEmpty
        ? null
        : CircleGeometry.PixelRegion(_selection, _chrome.Screen, still);
    IReadOnlyList<OcrLine> lines = await ScreenOcr.ReadAsync(_frozen, region);
    _reading = false;

    if (_finished) {
      return;
    }

    _words = CircleGeometry.TextWords(lines, still, _chrome.Screen);
    _chrome.SetReading(false, _readingHint);

    if (_words.Length == 0) {
      _chrome.Say(_noTextHint);
      return;
    }

    _textMode = true;
    _chrome.ShowWords(_words.Select(word => word.Bounds));
    _chrome.Say(_textHint);
  }

  /// <summary>Back from text mode to circling: the words and their selection go, the buttons return.</summary>
  private void LeaveText() {
    if (!_textMode) {
      return;
    }

    _textMode = false;
    Pick([]);
    _words = [];
    _chrome.HideWords();
  }

  /// <summary>
  /// A press in text mode: on a word it selects that word (a triple click, its whole line) and a
  /// drag extends from it; on empty space the drag becomes a rubber band (<see cref="ExtendTextSelect"/>).
  /// </summary>
  private void BeginTextSelect(Point point, int clicks) {
    _gesture = Gesture.TextSelect;
    _textOrigin = point;
    _textAnchor = CircleGeometry.WordAt(_words, point);

    if (_textAnchor < 0) {
      Pick([]);
    } else if (clicks >= 3) {
      Pick(CircleGeometry.WordsOnLine(_words, _textAnchor));
    } else {
      Pick(CircleGeometry.WordsBetween(_textAnchor, _textAnchor));
    }
  }

  /// <summary>
  /// Selects the words from where the drag began to the one under <paramref name="point"/>; a drag
  /// that began on empty space selects whatever its rectangle touches instead.
  /// </summary>
  private void ExtendTextSelect(Point point) {
    if (_textAnchor < 0) {
      var band = new Rect(_textOrigin, point);
      _chrome.ShowBand(band);
      Pick(CircleGeometry.WordsIn(_words, band));
      return;
    }

    int current = CircleGeometry.WordAt(_words, point);
    if (current >= 0) {
      Pick(CircleGeometry.WordsBetween(_textAnchor, current));
    }
  }

  /// <summary>
  /// Makes <paramref name="picked"/> the selected words, and holds Ctrl+C only while there are some.
  /// </summary>
  private void Pick(int[] picked) {
    _picked = picked;
    _chrome.SetPicked(picked.Select(index => _words[index].Bounds).ToArray());

    if (picked.Length > 0) {
      _copyKey?.Register();
    } else {
      _copyKey?.Unregister();
    }
  }

  /// <summary>
  /// Puts the selected words on the clipboard and says so; text mode stays open for more. The
  /// clipboard can be locked by another app, so a failure is told, not thrown.
  /// </summary>
  private void Copy() {
    if (!_textMode || _picked.Length == 0) {
      return;
    }

    try {
      Clipboard.SetText(CircleGeometry.Join(_words, _picked));
      _chrome.Say(_copiedHint);
    } catch (ExternalException e) {
      Log.Write($"circle: copy failed: {e.Message}");
      _chrome.Say(_copyFailedHint);
    }
  }

  /// <summary>Closes with no answer; <see cref="OnClosed"/> reports the cancel.</summary>
  private void Cancel() {
    if (_finished) {
      return;
    }

    _finished = true;
    Close();
  }
}
