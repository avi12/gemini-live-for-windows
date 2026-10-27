using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace GeminiLive;

/// <summary>
/// Shared chrome for our floating windows: never steal focus, never appear in the shared screen.
/// Positions are in physical pixels, which is what monitor bounds are in.
/// </summary>
public static class Overlay {
  /// <summary>
  /// Keeps the window out of the taskbar, Alt+Tab and screen captures. It never takes focus unless
  /// <paramref name="focusable"/>, for a surface that needs the keyboard from the start.
  /// </summary>
  public static IntPtr Prepare(Window window, bool clickThrough, bool focusable = false) {
    IntPtr hwnd = new WindowInteropHelper(window).EnsureHandle();
    int style = Native.WS_EX_TOOLWINDOW;
    if (!focusable) {
      style |= Native.WS_EX_NOACTIVATE;
    }

    if (clickThrough) {
      style |= Native.WS_EX_TRANSPARENT;
    }

    SetExStyle(hwnd, style, on: true);

    if (!Log.Debugging && !Native.SetWindowDisplayAffinity(hwnd, Native.WDA_EXCLUDEFROMCAPTURE)) {
      Log.Write("could not exclude overlay from capture");
    }

    return hwnd;
  }

  /// <summary>
  /// <see cref="Prepare"/> for a window built in code that floats over other apps: chromeless,
  /// see-through outside what it draws, topmost, and shown without taking focus. The one home for
  /// that setup, which must come before the handle exists (transparency can't change after).
  /// </summary>
  public static IntPtr PrepareFloating(Window window, bool clickThrough) {
    window.WindowStyle = WindowStyle.None;
    window.AllowsTransparency = true;
    window.Background = Brushes.Transparent;
    window.ShowInTaskbar = false;
    window.ShowActivated = false;
    window.Topmost = true;
    return Prepare(window, clickThrough);
  }

  /// <summary>Lets the window take focus (and come forward) only while it must, to type.</summary>
  public static void SetFocusable(IntPtr hwnd, bool focusable) {
    SetExStyle(hwnd, Native.WS_EX_NOACTIVATE, on: !focusable);

    if (focusable) {
      Native.SetForegroundWindow(hwnd);
    }
  }

  /// <summary>
  /// Makes the window the foreground one even where Windows' foreground lock would refuse. A
  /// hotkey's window shows only after the user lets go of the keys, and those releases went to the
  /// app in front, so it - not us - owns the last input and a plain SetForegroundWindow is ignored.
  /// Sharing that app's input state for the call lets the switch through.
  /// </summary>
  public static void BringToFront(IntPtr hwnd) {
    uint ours = Native.GetCurrentThreadId();
    uint theirs = Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out _);
    bool attached = theirs != 0 && theirs != ours && Native.AttachThreadInput(ours, theirs, attach: true);
    try {
      Native.BringWindowToTop(hwnd);
      Native.SetForegroundWindow(hwnd);
    } finally {
      if (attached) {
        Native.AttachThreadInput(ours, theirs, attach: false);
      }
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
