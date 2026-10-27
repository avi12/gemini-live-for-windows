using System.Windows;
using System.Windows.Controls;

namespace GeminiLive;

/// <summary>
/// A glowing frame around what Gemini can see - the desktop equivalent of Android's screen-share
/// indicator, in the design system's primary colour: the whole display, or just the part the user
/// circled. Click-through and excluded from capture.
/// </summary>
public sealed class ShareBorder : Window {
  private const double _thickness = 3;
  // Around a circled region the frame sits just outside it, so it never covers what Gemini sees.
  private const int _regionGap = 4;

  private readonly IntPtr _hwnd;
  private readonly Border _frame;

  public ShareBorder() {
    _frame = new Border { BorderThickness = new Thickness(_thickness) };
    _frame.SetResourceReference(Border.BorderBrushProperty, "LivePrimaryBrush");
    Content = _frame;
    _hwnd = Overlay.PrepareFloating(this, clickThrough: true);
  }

  /// <summary>
  /// Frames <paramref name="monitor"/>, or <paramref name="region"/> of it (in its physical
  /// pixels), rounded like Circle to Search's selection.
  /// </summary>
  public void Cover(MonitorInfo monitor, System.Drawing.Rectangle? region = null) {
    Show();

    if (region is not { } area) {
      _frame.CornerRadius = new CornerRadius(0);
      Overlay.Place(_hwnd, monitor.X, monitor.Y, monitor.Width, monitor.Height);
      return;
    }

    _frame.SetResourceReference(Border.CornerRadiusProperty, "MediumRadius");
    area.Inflate(_regionGap, _regionGap);
    Overlay.Place(_hwnd, monitor.X + area.X, monitor.Y + area.Y, area.Width, area.Height);
  }
}
