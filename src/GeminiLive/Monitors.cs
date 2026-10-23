namespace GeminiLive;

/// <summary>
/// One physical display, in physical pixels (the app is per-monitor DPI aware). WorkRight and
/// WorkBottom are the edges of the area the taskbar leaves free, where the pill docks.
/// </summary>
public sealed record MonitorInfo(IntPtr Handle, string DeviceName, int Index, bool IsPrimary,
                                 int X, int Y, int Width, int Height,
                                 int WorkRight, int WorkBottom) {
  public string Name => $"Display {Index}";

  public string Description =>
      $"{Name}{(IsPrimary ? " (primary)" : "")} · {Width}×{Height}";

  /// <summary>Same physical display, even if its bounds or numbering changed since.</summary>
  public bool IsSameDisplay(MonitorInfo? other) {
    return other?.DeviceName == DeviceName;
  }
}

public static class Monitors {
  /// <summary>
  /// All displays, numbered left-to-right like Windows' own display settings roughly do.
  /// </summary>
  public static IReadOnlyList<MonitorInfo> All() {
    var raw = new List<(IntPtr Handle, Native.MONITORINFOEX Info)>();
    Native.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (handle, _, _, _) => {
      var info = new Native.MONITORINFOEX {
        cbSize = System.Runtime.InteropServices.Marshal.SizeOf<Native.MONITORINFOEX>(),
      };
      if (Native.GetMonitorInfo(handle, ref info)) {
        raw.Add((handle, info));
      }

      return true;
    }, IntPtr.Zero);

    return raw
        .OrderBy(m => m.Info.rcMonitor.Left)
        .ThenBy(m => m.Info.rcMonitor.Top)
        .Select((m, i) => ToMonitorInfo(m.Handle, m.Info, i + 1))
        .ToList();
  }

  /// <summary>
  /// The display holding the window the user was working in when the key was pressed.
  /// </summary>
  public static MonitorInfo Active() {
    IReadOnlyList<MonitorInfo> all = All();
    IntPtr handle =
        Native.MonitorFromWindow(Native.GetForegroundWindow(), Native.MONITOR_DEFAULTTONEAREST);
    return all.FirstOrDefault(m => m.Handle == handle) ?? all.First(m => m.IsPrimary);
  }

  /// <summary>
  /// After displays changed: the current version of <paramref name="display"/> in
  /// <paramref name="all"/>, or the active display if it was unplugged.
  /// </summary>
  public static MonitorInfo Reconcile(IReadOnlyList<MonitorInfo> all, MonitorInfo display) {
    return all.FirstOrDefault(display.IsSameDisplay) ?? Active();
  }

  private static MonitorInfo ToMonitorInfo(IntPtr handle, Native.MONITORINFOEX info, int index) {
    Native.RECT bounds = info.rcMonitor;
    return new MonitorInfo(handle, info.szDevice, index,
                           (info.dwFlags & Native.MONITORINFOF_PRIMARY) != 0,
                           bounds.Left, bounds.Top,
                           bounds.Right - bounds.Left, bounds.Bottom - bounds.Top,
                           info.rcWork.Right, info.rcWork.Bottom);
  }
}
