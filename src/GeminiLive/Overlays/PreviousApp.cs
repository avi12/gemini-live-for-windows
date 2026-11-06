namespace GeminiLive;

/// <summary>
/// Gives the keyboard back to the app the user was in when the pill opened. The pill never takes
/// focus itself, but Win+C passes the foreground through Windows' own Copilot focus frame and then
/// to the window we registered for the key; so the foreground is followed as it changes, and the
/// last real app is put back in front when Windows leaves it on one of those, the desktop or
/// nothing. An app the user switched to meanwhile is left alone.
/// </summary>
public sealed class PreviousApp : IDisposable {
  private const uint _eventSystemForeground = 3;
  private const uint _outOfContext = 0;
  private const int _classCapacity = 64;
  private const int _settleMilliseconds = 120;

  private static readonly HashSet<string> _ignoredClasses = [
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "CopilotKeyPressFocusFrame",
  ];

  private readonly Func<IntPtr> _pill;
  private readonly Native.WinEventProc _onForeground;
  private readonly IntPtr _hook;
  private IntPtr _lastApp;

  /// <param name="pill">The pill's own window, which belongs to its child process.</param>
  public PreviousApp(Func<IntPtr> pill) {
    _pill = pill;
    _onForeground = (_, _, window, _, _, _, _) => Note(window);
    _hook = Native.SetWinEventHook(_eventSystemForeground, _eventSystemForeground, IntPtr.Zero, _onForeground,
                                   0, 0, _outOfContext);
    Note(Native.GetForegroundWindow());
  }

  public void Dispose() {
    Native.UnhookWinEvent(_hook);
  }

  /// <summary>
  /// While the pill is up, brings the last real app back in front if Windows left the foreground
  /// on a window of ours or the desktop; waits a moment for Windows to finish handing it over.
  /// </summary>
  public async Task SettleAsync() {
    await Task.Delay(_settleMilliseconds);
    Restore();
  }

  /// <summary>Same, for when the pill is gone.</summary>
  public void Restore() {
    IntPtr previous = _lastApp;
    bool isGone = previous == IntPtr.Zero || !Native.IsWindow(previous);
    bool isRealAppInFront = IsReal(Native.GetForegroundWindow());
    if (isGone || isRealAppInFront) {
      return;
    }

    Overlay.BringToFront(previous);
    Log.Write("focus: back to the app that was in front");
  }

  private void Note(IntPtr window) {
    if (IsReal(window)) {
      _lastApp = window;
    }
  }

  private bool IsReal(IntPtr window) {
    if (window == IntPtr.Zero || window == _pill()) {
      return false;
    }

    _ = Native.GetWindowThreadProcessId(window, out uint processId);
    bool isOurs = processId == Environment.ProcessId;
    return !isOurs && !_ignoredClasses.Contains(ClassOf(window));
  }

  private static string ClassOf(IntPtr window) {
    var name = new char[_classCapacity];
    int length = Native.GetClassName(window, name, name.Length);
    return new string(name, 0, length);
  }
}
