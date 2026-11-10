namespace GeminiLive;

/// <summary>The gear menu's update entry as data: restart into a ready update, or look again.</summary>
public static class UpdateMenu {
  /// <summary>What the pill says after the installer window opens.</summary>
  public const string InstallerNote = "Choose Update in the installer window. Gemini Live restarts when it's done.";

  /// <summary>
  /// The version downloaded and checked, if any, with whether the app looks on its own; null when
  /// unpackaged, with nothing to replace. The window words the entry.
  /// </summary>
  public static PillUpdate? Describe(UpdateChecker updates, Settings settings) {
    if (UpdateChecker.Installed is null) {
      return null;
    }

    return new PillUpdate(updates.Ready?.Version, settings.CheckForUpdates);
  }

  /// <summary>Turns looking on its own on or off; turning it on looks right away.</summary>
  public static void SetAutoCheck(UpdateChecker updates, Settings settings, bool isOn) {
    settings.CheckForUpdates = isOn;
    settings.Save();

    if (isOn) {
      _ = updates.CheckAsync(manual: false);
    }
  }

  /// <summary>Looks now, and says what it found.</summary>
  public static async Task<string> CheckAsync(UpdateChecker updates) {
    UpdateCheck result = await updates.CheckAsync(manual: true);
    return result switch {
      UpdateCheck.Ready => $"Version {updates.Ready?.Version} is ready. Open the gear menu to restart into it.",
      UpdateCheck.Failed => "Couldn't get the update from GitHub.",
      _ => $"Gemini Live {UpdateChecker.Installed} is the latest version.",
    };
  }
}
