namespace GeminiLive;

/// <summary>One physical display, in physical pixels (the app is per-monitor DPI aware).</summary>
public sealed record MonitorInfo(IntPtr Handle, string DeviceName, int Index, bool IsPrimary,
    int X, int Y, int Width, int Height)
{
    public string Label => $"{Index}";
    public string Description => $"Display {Index}{(IsPrimary ? " (primary)" : "")} · {Width}×{Height}";
}

public static class Monitors
{
    /// <summary>All displays, numbered left-to-right like Windows' own display settings roughly do.</summary>
    public static IReadOnlyList<MonitorInfo> All()
    {
        var raw = new List<(IntPtr h, Native.MONITORINFOEX info)>();
        Native.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (h, _, _, _) =>
        {
            var info = new Native.MONITORINFOEX { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<Native.MONITORINFOEX>() };
            if (Native.GetMonitorInfo(h, ref info)) raw.Add((h, info));
            return true;
        }, IntPtr.Zero);

        return raw
            .OrderBy(m => m.info.rcMonitor.Left).ThenBy(m => m.info.rcMonitor.Top)
            .Select((m, i) => new MonitorInfo(m.h, m.info.szDevice, i + 1,
                (m.info.dwFlags & Native.MONITORINFOF_PRIMARY) != 0,
                m.info.rcMonitor.Left, m.info.rcMonitor.Top,
                m.info.rcMonitor.Right - m.info.rcMonitor.Left,
                m.info.rcMonitor.Bottom - m.info.rcMonitor.Top))
            .ToList();
    }

    /// <summary>The display holding the window the user was working in when the key was pressed.</summary>
    public static MonitorInfo Active()
    {
        var all = All();
        var h = Native.MonitorFromWindow(Native.GetForegroundWindow(), Native.MONITOR_DEFAULTTONEAREST);
        return all.FirstOrDefault(m => m.Handle == h) ?? all.First(m => m.IsPrimary);
    }
}
