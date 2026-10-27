using System.Runtime.InteropServices;

namespace GeminiLive;

/// <summary>
/// Win32 entry points used across the app. One home for every P/Invoke. Names deliberately mirror
/// the Windows SDK headers (not C# style) so each one can be looked up as-is.
/// </summary>
internal static unsafe class Native {
  public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, IntPtr lprc, IntPtr data);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    // x and y in the Win32 struct; only the layout matters to the marshaller.
    public int PosX;
    public int PosY;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
    public string szDevice;
  }

  // ---- Copilot key fast path: a property on the window's IPropertyStore ----

  [StructLayout(LayoutKind.Sequential)]
  public struct PROPERTYKEY {
    public Guid fmtid;
    public uint pid;
  }

  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PROPVARIANT {
    [FieldOffset(0)]
    public ushort variantType;  // vt in the Win32 struct
    [FieldOffset(8)]
    public uint uintVal;
  }

  // Every slot is declared, used or not: COM calls go through the vtable by position.
  [ComImport]
  [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    void GetCount(out uint count);
    void GetAt(uint index, out PROPERTYKEY key);
    void GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
    void SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
    void Commit();
  }

  public const int WM_APP = 0x8000;
  public const int WM_HOTKEY = 0x0312;
  public const uint MOD_ALT = 0x1;
  public const uint MOD_CONTROL = 0x2;
  public const uint MOD_WIN = 0x8;
  // Holding the keys down fires once, not on every auto-repeat.
  public const uint MOD_NOREPEAT = 0x4000;
  public const uint MONITORINFOF_PRIMARY = 1;
  public const uint MONITOR_DEFAULTTONEAREST = 2;
  public const uint SWP_NOSIZE = 0x1;
  public const uint SWP_NOACTIVATE = 0x10;
  public const uint SWP_SHOWWINDOW = 0x40;
  public const int GWL_EXSTYLE = -20;
  public const int WS_EX_TRANSPARENT = 0x20;
  public const int WS_EX_TOOLWINDOW = 0x80;
  public const int WS_EX_NOACTIVATE = 0x08000000;
  // Excludes our own overlay from screen grabs, so Gemini never sees itself.
  public const uint WDA_EXCLUDEFROMCAPTURE = 0x11;
  public const ushort VT_UINT = 23;
  // GetCurrentPackageFullName's answer for a process that isn't running from a package.
  public const int APPMODEL_ERROR_NO_PACKAGE = 15700;
  public static readonly IntPtr HWND_TOPMOST = new(-1);

  private static readonly Guid _memoryBufferByteAccessIid =
      new("5b0d3235-4dba-4d44-865e-8f1d0e4fd04d");

  [DllImport("user32.dll")]
  public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc,
                                                IntPtr data);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX info);

  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromPoint(POINT point, uint flags);

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT point);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hwnd);

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hwnd);

  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint attachThreadId, uint attachToThreadId, bool attach);

  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width,
                                         int height, uint flags);

  [DllImport("user32.dll")]
  public static extern int GetWindowLong(IntPtr hwnd, int index);

  [DllImport("user32.dll")]
  public static extern int SetWindowLong(IntPtr hwnd, int index, int value);

  [DllImport("user32.dll")]
  public static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);

  [DllImport("user32.dll")]
  public static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);

  [DllImport("user32.dll")]
  public static extern bool UnregisterHotKey(IntPtr hwnd, int id);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetCurrentPackageFullName(ref uint packageFullNameLength,
                                                     char* packageFullName);

  [DllImport("shell32.dll")]
  public static extern int SHGetPropertyStoreForWindow(
      IntPtr hwnd, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

  /// <summary>
  /// The raw bytes behind a WinRT IMemoryBufferReference, via IMemoryBufferByteAccess called
  /// through its vtable (slot 3 = GetBuffer).
  /// </summary>
  public static IntPtr GetBuffer(object memoryBufferReference) {
    IntPtr inspectable = ((WinRT.IWinRTObject)memoryBufferReference).NativeObject.ThisPtr;
    Guid iid = _memoryBufferByteAccessIid;
    Marshal.ThrowExceptionForHR(Marshal.QueryInterface(inspectable, in iid, out IntPtr access));
    try {
      byte* data;
      uint capacity;
      var getBuffer =
          (delegate* unmanaged[Stdcall]<IntPtr, byte**, uint*, int>)(*(void***)access)[3];
      Marshal.ThrowExceptionForHR(getBuffer(access, &data, &capacity));
      return (IntPtr)data;
    } finally {
      Marshal.Release(access);
    }
  }
}
