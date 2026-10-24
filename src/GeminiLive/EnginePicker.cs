using System.Windows.Controls;

namespace GeminiLive;

/// <summary>
/// The settings menu's engine entries: what carries the conversation, the current one checked,
/// and (on the API key) a way to replace the key.
/// </summary>
public static class EnginePicker {
  private static readonly IReadOnlyList<(EngineKind Kind, string Name, string Detail)> _choices = [
    (EngineKind.Google, "Your Gemini subscription",
     "Your Gemini subscription, through Google's own web client and the browser extension. " +
     "Unofficial: Google may suspend an account that uses it."),
    (EngineKind.ApiKey, "Your API key",
     "The public Gemini Live API, billed to your key. No extension, and your Google account " +
     "isn't involved."),
  ];

  public static void Fill(ContextMenu menu, EngineKind current, Action<EngineKind> onPick,
                          Action onChangeKey) {
    foreach ((EngineKind kind, string name, string detail) in _choices) {
      var item = new MenuItem {
        Header = name,
        ToolTip = detail,
        IsCheckable = true,
        IsChecked = kind == current,
      };
      item.Click += (_, _) => onPick(kind);
      menu.Items.Add(item);
    }

    if (current != EngineKind.ApiKey) {
      return;
    }

    var changeKey = new MenuItem { Header = "Change API key…" };
    changeKey.Click += (_, _) => onChangeKey();
    menu.Items.Add(changeKey);
  }
}
