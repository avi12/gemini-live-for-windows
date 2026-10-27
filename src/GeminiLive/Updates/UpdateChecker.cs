using System.Net.Http;
using System.Text.Json;
using Windows.ApplicationModel;

namespace GeminiLive;

/// <summary>How a look for a newer release ended.</summary>
public enum UpdateCheck {
  /// <summary>Not looked: unpackaged, or the user turned updates off.</summary>
  Skipped,
  UpToDate,
  /// <summary>A newer release is downloaded and checked, ready to install.</summary>
  Ready,
  /// <summary>GitHub couldn't be reached, or the download was damaged.</summary>
  Failed,
}

/// <summary>
/// Knows whether a newer release than the running package is on GitHub, and has it downloaded and
/// checked by the time it says so. It looks at start and every few hours after, unless the user
/// turned updates off, which also stops every connection it makes.
/// </summary>
public sealed class UpdateChecker {
  private static readonly TimeSpan _interval = TimeSpan.FromHours(6);

  private readonly Settings _settings;

  public UpdateChecker(Settings settings) {
    _settings = settings;
  }

  /// <summary>The running package's version, or null when run unpackaged (nothing to update).</summary>
  public static Version? Installed { get; } = ReadInstalled();

  /// <summary>The newer release, once it is downloaded and checked.</summary>
  public AppRelease? Ready { get; private set; }

  private string? _readyPath;

  /// <summary>Looks now, then again every few hours for as long as the app runs.</summary>
  public async Task WatchAsync() {
    using var timer = new PeriodicTimer(_interval);
    do {
      await CheckAsync(manual: false);
    } while (await timer.WaitForNextTickAsync());
  }

  public async Task<UpdateCheck> CheckAsync(bool manual) {
    if (Installed is not { } installed || !manual && !_settings.CheckForUpdates) {
      return UpdateCheck.Skipped;
    }

    try {
      AppRelease? latest = await ReleaseFeed.LatestAsync();
      Log.Write($"update check: installed {installed}, latest {latest?.Version.ToString() ?? "none"}");

      if (latest is null || latest.Version <= installed) {
        return UpdateCheck.UpToDate;
      }

      return await PrepareAsync(latest);
    } catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or IOException) {
      Log.Write($"update check failed: {e.Message}");
      return UpdateCheck.Failed;
    }
  }

  /// <summary>Opens the downloaded package in App Installer; false when none is ready.</summary>
  public bool Install() {
    if (_readyPath is not { } path) {
      return false;
    }

    UpdateInstaller.Open(path);
    return true;
  }

  private async Task<UpdateCheck> PrepareAsync(AppRelease latest) {
    _readyPath = await UpdateInstaller.DownloadAsync(latest);
    Ready = _readyPath is null ? null : latest;
    return Ready is null ? UpdateCheck.Failed : UpdateCheck.Ready;
  }

  private static Version? ReadInstalled() {
    try {
      PackageVersion version = Package.Current.Id.Version;
      return new Version(version.Major, version.Minor, version.Build, version.Revision);
    } catch (InvalidOperationException) {
      return null;  // no package identity: a dotnet run
    }
  }
}
