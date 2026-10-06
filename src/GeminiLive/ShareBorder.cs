using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace GeminiLive;

/// <summary>
/// A glowing frame around the display Gemini can see - the desktop equivalent of Android's
/// screen-share indicator, in the design system's primary colour. Click-through and excluded
/// from capture.
/// </summary>
public sealed class ShareBorder : Window {
  private const double _thickness = 3;

  private readonly IntPtr _hwnd;

  public ShareBorder() {
    WindowStyle = WindowStyle.None;
    AllowsTransparency = true;
    Background = Brushes.Transparent;
    ShowInTaskbar = false;
    ShowActivated = false;
    Topmost = true;
    var frame = new Border { BorderThickness = new Thickness(_thickness) };
    frame.SetResourceReference(Border.BorderBrushProperty, "LivePrimaryBrush");
    Content = frame;
    _hwnd = Overlay.Prepare(this, clickThrough: true);
  }

  public void Cover(MonitorInfo monitor) {
    Show();
    Overlay.Place(_hwnd, monitor.X, monitor.Y, monitor.Width, monitor.Height);
  }
}
