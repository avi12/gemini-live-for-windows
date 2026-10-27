namespace GeminiLive;

/// <summary>
/// Circle to Search's keys, as global hotkeys, since Windows' copilotkeyprovider extension only ever
/// delivers Win+C itself (<see cref="CopilotKey"/>). The ids are this app's own, one per key.
/// </summary>
public static class CircleKey {
  private enum HotkeyId {
    Circle = 1,
    Escape = 2,
    OverlayCancel = 3,
    OverlayAskGemini = 4,
    OverlayLens = 5,
    OverlaySelectText = 6,
    OverlayCopy = 7,
  }

  private const uint _noModifiers = 0;
  private const uint _keyC = 0x43;  // VK_C
  private const uint _keyEscape = 0x1B;  // VK_ESCAPE
  private const uint _keyEnter = 0x0D;  // VK_RETURN
  private const uint _keyL = 0x4C;  // VK_L
  private const uint _keyT = 0x54;  // VK_T

  /// <summary>
  /// Win+Alt+C, held for the app's lifetime. Not Win+Shift+C: PowerToys' Color Picker holds that
  /// one by default. The window's message hook keeps the hotkey alive, so nothing holds it.
  /// </summary>
  public static void Circle(IntPtr hwnd, Action onPressed) {
    new Hotkey(hwnd, (int)HotkeyId.Circle, Native.MOD_WIN | Native.MOD_ALT, _keyC, "Win+Alt+C", onPressed)
        .Register();
  }

  /// <summary>
  /// Esc, which hands Gemini back the whole display; registered only while it sees a circled
  /// region, so other apps keep their Esc the rest of the time.
  /// </summary>
  public static Hotkey Escape(IntPtr hwnd, Action onPressed) {
    return new Hotkey(hwnd, (int)HotkeyId.Escape, _noModifiers, _keyEscape, "Esc", onPressed);
  }

  /// <summary>
  /// The circle overlay's own keys - Esc backs out, Enter asks Gemini, L asks Lens, T selects text -
  /// as hotkeys on its window, so they work even when Windows' foreground lock leaves another app
  /// holding the keyboard. Returned unregistered: the overlay holds them only while it is open, and
  /// the main window lets go of <see cref="Escape"/> first, so the two never both want Esc.
  /// </summary>
  public static Hotkey[] Overlay(IntPtr hwnd, Action onEscape, Action<CircleAction> onFinish,
                                 Action onSelectText) {
    return [
      new Hotkey(hwnd, (int)HotkeyId.OverlayCancel, _noModifiers, _keyEscape, "Esc (circle)", onEscape),
      new Hotkey(hwnd, (int)HotkeyId.OverlayAskGemini, _noModifiers, _keyEnter, "Enter (circle)",
                 () => onFinish(CircleAction.AskGemini)),
      new Hotkey(hwnd, (int)HotkeyId.OverlayLens, _noModifiers, _keyL, "L (circle)",
                 () => onFinish(CircleAction.Lens)),
      new Hotkey(hwnd, (int)HotkeyId.OverlaySelectText, _noModifiers, _keyT, "T (circle)", onSelectText),
    ];
  }

  /// <summary>
  /// Ctrl+C for the overlay's text mode. Returned unregistered, and held only while words are
  /// selected, so other apps keep their copy shortcut the rest of the time.
  /// </summary>
  public static Hotkey Copy(IntPtr hwnd, Action onPressed) {
    return new Hotkey(hwnd, (int)HotkeyId.OverlayCopy, Native.MOD_CONTROL, _keyC, "Ctrl+C (circle)", onPressed);
  }
}
