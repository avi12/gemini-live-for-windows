using System.Windows;
using System.Windows.Interop;

namespace GeminiLive;

/// <summary>Shared chrome for our floating windows: never steal focus, never appear in the shared screen.</summary>
public static class Overlay
{
    public static IntPtr Prepare(Window window, bool clickThrough)
    {
        var hwnd = new WindowInteropHelper(window).EnsureHandle();
        var ex = Native.GetWindowLong(hwnd, Native.GWL_EXSTYLE) | Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW;
        if (clickThrough) ex |= Native.WS_EX_TRANSPARENT;
        Native.SetWindowLong(hwnd, Native.GWL_EXSTYLE, ex);
        if (!Log.Debugging && !Native.SetWindowDisplayAffinity(hwnd, Native.WDA_EXCLUDEFROMCAPTURE))
            Log.Write("could not exclude overlay from capture");
        return hwnd;
    }

    /// <summary>Positions in physical pixels, which is what monitor bounds are in.</summary>
    public static void Place(IntPtr hwnd, int x, int y, int? width = null, int? height = null)
    {
        var flags = Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | (width is null ? Native.SWP_NOSIZE : 0);
        Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, x, y, width ?? 0, height ?? 0, flags);
    }
}
