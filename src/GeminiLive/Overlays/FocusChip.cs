using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace GeminiLive;

/// <summary>
/// The label on a circled region Gemini is watching: says so, its ✕ hands Gemini back the whole
/// display (as Esc does), and dragging it moves the region. Sits just above the region's frame, or
/// below it when the region touches the top of the display. Never takes focus, and stays out of
/// what Gemini sees.
/// </summary>
public sealed class FocusChip : Window {
  private const string _label = "Gemini sees this area";
  private const string _closeTip = "Show Gemini the whole screen (Esc)";
  private const double _closeSize = 32;
  private const double _closeIconSize = 20;
  // Physical pixels between the chip and the region's frame.
  private const int _gap = 10;
  // The label sits 16 in from the pill's round end and 8 from the ✕; the ✕ is inset 4 all round.
  private static readonly Thickness _labelMargin = new(16, 0, 8, 0);
  private static readonly Thickness _chipPadding = new(0, 4, 4, 4);

  private readonly IntPtr _hwnd;
  private Vector _dragOrigin;  // where the pointer was, in screen pixels, when the drag began

  /// <summary>The ✕ was clicked.</summary>
  public event Action? Dismissed;

  /// <summary>The user grabbed the chip to move the region it labels.</summary>
  public event Action? DragStarted;

  /// <summary>
  /// The chip is being dragged: how far the pointer has moved since <see cref="DragStarted"/>, in
  /// physical screen pixels. Read from the cursor rather than the chip, which moves along.
  /// </summary>
  public event Action<Vector>? Dragged;

  public FocusChip() {
    SizeToContent = SizeToContent.WidthAndHeight;
    Cursor = Cursors.SizeAll;  // the chip is the region's handle
    SetResourceReference(FontFamilyProperty, "LiveFont");
    Content = Build();
    _hwnd = Overlay.PrepareFloating(this, clickThrough: false);
  }

  /// <summary>A press on the label or the chip's edge (the ✕ handles its own) starts a drag.</summary>
  protected override void OnMouseLeftButtonDown(MouseButtonEventArgs e) {
    base.OnMouseLeftButtonDown(e);
    _dragOrigin = CursorPosition();
    CaptureMouse();
    DragStarted?.Invoke();
    e.Handled = true;
  }

  protected override void OnMouseMove(MouseEventArgs e) {
    base.OnMouseMove(e);

    if (IsMouseCaptured) {
      Dragged?.Invoke(CursorPosition() - _dragOrigin);
    }
  }

  protected override void OnMouseLeftButtonUp(MouseButtonEventArgs e) {
    base.OnMouseLeftButtonUp(e);
    ReleaseMouseCapture();
  }

  private static Vector CursorPosition() {
    Native.GetCursorPos(out Native.POINT cursor);
    return new Vector(cursor.PosX, cursor.PosY);
  }

  /// <summary>Shows the chip by <paramref name="region"/> (physical pixels of the monitor).</summary>
  public void Attach(MonitorInfo monitor, System.Drawing.Rectangle region) {
    Show();
    UpdateLayout();
    DpiScale dpi = VisualTreeHelper.GetDpi(this);
    int height = (int)Math.Ceiling(ActualHeight * dpi.DpiScaleY);
    int top = region.Top - _gap - height;
    if (top < 0) {
      top = region.Bottom + _gap;  // no room above: below the region instead
    }

    Overlay.Place(_hwnd, monitor.X + region.Left, monitor.Y + top);
  }

  /// <summary>The pill: the label, then a round ✕ that raises <see cref="Dismissed"/>.</summary>
  private Border Build() {
    var label = new TextBlock {
      Text = _label,
      Margin = _labelMargin,
      VerticalAlignment = VerticalAlignment.Center,
    };
    label.SetResourceReference(StyleProperty, "LiveLabelText");
    label.SetResourceReference(TextBlock.ForegroundProperty, "LiveTextBrush");
    var icon = new TextBlock { Text = Glyphs.Close, FontSize = _closeIconSize };
    icon.SetResourceReference(StyleProperty, "LiveIcon");
    var close = new Button {
      Content = icon,
      Width = _closeSize,
      Height = _closeSize,
      ToolTip = _closeTip,
    };
    close.Cursor = Cursors.Arrow;  // a button, not part of the drag handle
    close.SetResourceReference(StyleProperty, "LiveRoundButton");
    close.Click += (_, _) => Dismissed?.Invoke();
    var chip = new Border {
      Padding = _chipPadding,
      Child = new StackPanel { Orientation = Orientation.Horizontal, Children = { label, close } },
    };
    chip.SetResourceReference(StyleProperty, "LivePill");
    return chip;
  }
}
