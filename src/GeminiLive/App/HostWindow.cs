using System.Windows;
using System.Windows.Interop;
using Microsoft.Win32;

namespace GeminiLive;

/// <summary>
/// The app's one WPF window, never shown: it gives the hotkeys and Windows' key message an HWND, tells
/// us when the displays change, and is the UI thread's dispatcher. The pill itself is the Svelte
/// window (<see cref="PillHost"/>).
/// </summary>
public sealed class HostWindow : Window {
  public IntPtr Handle { get; }

  /// <summary>Displays plugged in or out, or their layout changed; raised on the UI thread.</summary>
  public event Action? DisplaysChanged;

  public HostWindow() {
    WindowStyle = WindowStyle.None;
    ShowInTaskbar = false;
    Handle = new WindowInteropHelper(this).EnsureHandle();
    SystemEvents.DisplaySettingsChanged += (_, _) => Dispatcher.BeginInvoke(() => DisplaysChanged?.Invoke());
  }
}
