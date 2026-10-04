using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;
using Windows.UI.ViewManagement;

namespace GeminiLive;

/// <summary>
/// The flyout's look, taken from Windows itself the way TextInputHost (Win+H voice typing) does:
/// system light/dark, the user's accent colour, and DWM's acrylic + rounded corners. Brushes are
/// published as application resources so XAML binds with DynamicResource and re-themes live.
/// </summary>
public static class Theme
{
    static readonly UISettings Ui = new();

    public static bool IsDark =>
        Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "AppsUseLightTheme", 1) is int light && light == 0;

    public static void Apply()
    {
        var dark = IsDark;
        var accent = ToMedia(Ui.GetColorValue(dark ? UIColorType.AccentLight2 : UIColorType.AccentDark1));
        var r = Application.Current.Resources;
        r["TextBrush"] = Brush(dark ? "#FFFFFFFF" : "#E4000000");
        r["SecondaryTextBrush"] = Brush(dark ? "#C5FFFFFF" : "#9E000000");
        r["SubtleFillBrush"] = Brush(dark ? "#0FFFFFFF" : "#0A000000");
        r["SubtleHoverBrush"] = Brush(dark ? "#15FFFFFF" : "#12000000");
        r["StrokeBrush"] = Brush(dark ? "#18FFFFFF" : "#0F000000");
        r["AccentBrush"] = new SolidColorBrush(accent);
        r["OnAccentBrush"] = Brush(dark ? "#FF000000" : "#FFFFFFFF");
        r["DangerBrush"] = Brush("#FFC42B1C");
    }

    /// <summary>Re-applies when the user flips light/dark or changes accent.</summary>
    public static void Follow()
    {
        Apply();
        SystemEvents.UserPreferenceChanged += (_, _) => Application.Current.Dispatcher.BeginInvoke(Apply);
    }

    /// <summary>Acrylic backdrop, rounded corners and theme-matched frame, drawn by DWM.</summary>
    public static void Acrylic(IntPtr hwnd)
    {
        int dark = IsDark ? 1 : 0, round = DWMWCP_ROUND, backdrop = DWMSBT_TRANSIENTWINDOW;
        DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));
        DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref round, sizeof(int));
        DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, ref backdrop, sizeof(int));
    }

    static SolidColorBrush Brush(string argb)
    {
        var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(argb));
        b.Freeze();
        return b;
    }

    static Color ToMedia(Windows.UI.Color c) => Color.FromArgb(c.A, c.R, c.G, c.B);

    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20, DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWA_SYSTEMBACKDROP_TYPE = 38;
    const int DWMWCP_ROUND = 2, DWMSBT_TRANSIENTWINDOW = 3;

    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
