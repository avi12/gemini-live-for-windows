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

  /// <summary>
  /// Puts the window in the topmost band, above a maximized app, without moving, sizing or
  /// activating it. For a window whose own process never set the topmost style.
  /// </summary>
  public static void KeepOnTop(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) {
      return;
    }

    Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, 0, 0, 0, 0,
                        Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
  }

  public static void Place(IntPtr hwnd, int x, int y, int? width = null, int? height = null) {
    uint flags = Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW;
    if (width is null) {
      flags |= Native.SWP_NOSIZE;
    }

    Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, x, y, width ?? 0, height ?? 0, flags);
  }

  private static void SetExStyle(IntPtr hwnd, int bits, bool on) {
    int style = Native.GetWindowLong(hwnd, Native.GWL_EXSTYLE);
    _ = Native.SetWindowLong(hwnd, Native.GWL_EXSTYLE, on ? style | bits : style & ~bits);
  }
}
