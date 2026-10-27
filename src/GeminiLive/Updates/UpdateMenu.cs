using System.Windows.Controls;

namespace GeminiLive;

/// <summary>The settings menu's update entries: restart into a ready update, or look again.</summary>
public static class UpdateMenu {
  /// <summary>
  /// Adds "Restart to update to x" when a release is downloaded and checked, else "Check for
  /// updates", and a switch for looking on its own; what happens next is told through
  /// <paramref name="say"/>.
  /// </summary>
  public static void Add(ContextMenu menu, UpdateChecker updates, Settings settings, Action<string> say) {
    if (UpdateChecker.Installed is null) {
      return;  // unpackaged: nothing to replace
    }

    menu.Items.Add(updates.Ready is { } release ? Install(updates, release, say) : Check(updates, say));
    menu.Items.Add(AutoSwitch(updates, settings));
  }

  private static MenuItem Install(UpdateChecker updates, AppRelease release, Action<string> say) {
    var item = new MenuItem { Header = $"Restart to update to {release.Version}" };
    item.Click += (_, _) => {
      updates.Install();
      say("Choose Update in the installer window. Gemini Live restarts when it's done.");
    };
    return item;
  }

  private static MenuItem Check(UpdateChecker updates, Action<string> say) {
    var item = new MenuItem { Header = "Check for updates" };
    item.Click += async (_, _) => say(await CheckAsync(updates));
    return item;
  }

  private static MenuItem AutoSwitch(UpdateChecker updates, Settings settings) {
    var item = new MenuItem {
      Header = "Check for updates automatically",
      IsCheckable = true,
      IsChecked = settings.CheckForUpdates,
    };
    item.Click += (_, _) => {
      settings.CheckForUpdates = item.IsChecked;
      settings.Save();

      if (item.IsChecked) {
        _ = updates.CheckAsync(manual: false);
      }
    };
    return item;
  }

  private static async Task<string> CheckAsync(UpdateChecker updates) {
    UpdateCheck result = await updates.CheckAsync(manual: true);
    return result switch {
      UpdateCheck.Ready => $"Version {updates.Ready?.Version} is ready. Open the gear menu to restart into it.",
      UpdateCheck.Failed => "Couldn't get the update from GitHub.",
      _ => $"Gemini Live {UpdateChecker.Installed} is the latest version.",
    };
  }
}
