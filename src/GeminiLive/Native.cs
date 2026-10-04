using System.Runtime.InteropServices;

namespace GeminiLive;

/// <summary>Win32 entry points used across the app. One home for every P/Invoke.</summary>
internal static unsafe partial class Native
{
    public const int WM_APP = 0x8000;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MONITORINFOEX
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
    }

    public const uint MONITORINFOF_PRIMARY = 1;
    public const uint MONITOR_DEFAULTTONEAREST = 2;

    public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, IntPtr lprc, IntPtr data);

    [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX info);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    public static readonly IntPtr HWND_TOPMOST = new(-1);
    public const uint SWP_NOSIZE = 0x1, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;

    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hwnd, int index, int value);

    // Excludes our own overlay from screen grabs, so Gemini never sees itself.
    public const uint WDA_EXCLUDEFROMCAPTURE = 0x11;
    [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);

    // ---- Copilot key fast path: a property on the window's IPropertyStore ----

    [StructLayout(LayoutKind.Sequential)]
    public struct PROPERTYKEY { public Guid fmtid; public uint pid; }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    public struct PROPVARIANT
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public uint uintVal;
    }

    public const ushort VT_UINT = 23;

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore
    {
        void GetCount(out uint count);
        void GetAt(uint index, out PROPERTYKEY key);
        void GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
        void SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
        void Commit();
    }

    [DllImport("shell32.dll")]
    public static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

    // ---- WinRT IMemoryBufferByteAccess, called through its vtable (slot 3 = GetBuffer) ----

    public static readonly Guid IID_IMemoryBufferByteAccess = new("5b0d3235-4dba-4d44-865e-8f1d0e4fd04d");

    public static (IntPtr data, uint capacity) GetBuffer(object memoryBufferReference)
    {
        var inspectable = ((WinRT.IWinRTObject)memoryBufferReference).NativeObject.ThisPtr;
        var iid = IID_IMemoryBufferByteAccess;
        Marshal.ThrowExceptionForHR(Marshal.QueryInterface(inspectable, in iid, out var access));
        try
        {
            byte* data; uint capacity;
            var getBuffer = (delegate* unmanaged[Stdcall]<IntPtr, byte**, uint*, int>)(*(void***)access)[3];
            Marshal.ThrowExceptionForHR(getBuffer(access, &data, &capacity));
            return ((IntPtr)data, capacity);
        }
        finally { Marshal.Release(access); }
    }
}
