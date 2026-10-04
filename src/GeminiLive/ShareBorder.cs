using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace GeminiLive;

/// <summary>
/// A glowing frame around the display Gemini can see - the desktop equivalent of Android's
/// screen-share indicator. Click-through and excluded from capture.
/// </summary>
public sealed class ShareBorder : Window
{
    readonly IntPtr _hwnd;

    public ShareBorder()
    {
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        var frame = new Border { BorderThickness = new Thickness(3) };
        frame.SetResourceReference(Border.BorderBrushProperty, "AccentBrush");
        Content = frame;
        _hwnd = Overlay.Prepare(this, clickThrough: true);
    }

    public void Cover(MonitorInfo m)
    {
        Show();
        Overlay.Place(_hwnd, m.X, m.Y, m.Width, m.Height);
    }
}
