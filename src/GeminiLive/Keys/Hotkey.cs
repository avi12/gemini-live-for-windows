using System.Windows.Interop;

namespace GeminiLive;

/// <summary>
/// One global hotkey on a window: registered and released on demand, so a key the app only needs
/// for a while (Esc, while Gemini sees a circled region) isn't taken from other apps the rest of
/// the time.
/// </summary>
public sealed class Hotkey {
  private readonly IntPtr _hwnd;
  private readonly int _id;
  private readonly uint _modifiers;
  private readonly uint _key;
  private readonly string _name;
  private bool _registered;

  /// <summary>
  /// <paramref name="name"/> is the combination as people say it, for the log. Presses reach
  /// <paramref name="onPressed"/> only while the hotkey is registered.
  /// </summary>
  public Hotkey(IntPtr hwnd, int id, uint modifiers, uint key, string name, Action onPressed) {
    _hwnd = hwnd;
    _id = id;
    _modifiers = modifiers | Native.MOD_NOREPEAT;
    _key = key;
    _name = name;
    HwndSource.FromHwnd(hwnd).AddHook(
        (IntPtr _, int msg, IntPtr wParam, IntPtr _, ref bool handled) => {
          if (msg == Native.WM_HOTKEY && wParam.ToInt64() == _id) {
            handled = true;
            onPressed();
          }

          return IntPtr.Zero;
        });
  }

  /// <summary>Takes the key; a combination another app already holds is only logged.</summary>
  public void Register() {
    if (_registered) {
      return;
    }

    _registered = Native.RegisterHotKey(_hwnd, _id, _modifiers, _key);

    if (!_registered) {
      Log.Write($"hotkey: {_name} is taken by another app");
    }
  }

  /// <summary>Gives the key back to other apps.</summary>
  public void Unregister() {
    if (_registered) {
      _registered = !Native.UnregisterHotKey(_hwnd, _id);
    }
  }
}
