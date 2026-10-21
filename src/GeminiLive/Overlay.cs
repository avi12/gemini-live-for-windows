using System.Windows;
using System.Windows.Interop;

namespace GeminiLive;

/// <summary>
/// Shared chrome for our floating windows: never steal focus, never appear in the shared screen.
/// Positions are in physical pixels, which is what monitor bounds are in.
/// </summary>
public static class Overlay {
  public static IntPtr Prepare(Window window, bool clickThrough) {
    IntPtr hwnd = new WindowInteropHelper(window).EnsureHandle();
    int style = Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW;
    if (clickThrough) {
      style |= Native.WS_EX_TRANSPARENT;
    }
    SetExStyle(hwnd, style, on: true);
    if (!Log.Debugging && !Native.SetWindowDisplayAffinity(hwnd, Native.WDA_EXCLUDEFROMCAPTURE)) {
      Log.Write("could not exclude overlay from capture");
    }
    return hwnd;
  }

  /// <summary>Lets the window take focus (and come forward) only while it must, to type.</summary>
  public static void SetFocusable(IntPtr hwnd, bool focusable) {
    SetExStyle(hwnd, Native.WS_EX_NOACTIVATE, on: !focusable);
    if (focusable) {
      Native.SetForegroundWindow(hwnd);
    }
  }

  public static void Place(IntPtr hwnd, int x, int y, int? width = null, int? height = null) {
    uint flags = Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW;
    if (width is null) {
      flags |= Native.SWP_NOSIZE;
    }
    Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, x, y, width ?? 0, height ?? 0, flags);
  }

  /// <summary>
  /// Places a window of the given (physical) size with its bottom-right corner here. The caller
  /// passes the size it is about to have: mid-resize the HWND rect still holds the old one.
  /// </summary>
  public static void PlaceBottomRight(IntPtr hwnd, int right, int bottom, int width, int height) {
    Place(hwnd, right - width, bottom - height);
  }

  private static void SetExStyle(IntPtr hwnd, int bits, bool on) {
    int style = Native.GetWindowLong(hwnd, Native.GWL_EXSTYLE);
    _ = Native.SetWindowLong(hwnd, Native.GWL_EXSTYLE, on ? style | bits : style & ~bits);
  }
}
