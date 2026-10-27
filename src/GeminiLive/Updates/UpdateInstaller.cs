using System.Security.Cryptography;

namespace GeminiLive;

/// <summary>
/// Gets a release's package onto disk, checked against its hash, and later hands it to Windows' App
/// Installer, which shuts the app down, updates it in place and offers to start it again. Windows
/// checks the package's signature and publisher itself.
/// </summary>
public static class UpdateInstaller {
  private static readonly string _folder = Path.Combine(Path.GetTempPath(), "GeminiLive-update");

  /// <summary>Downloads <paramref name="release"/>; the file's path, or null when it fails its hash.</summary>
  public static async Task<string?> DownloadAsync(AppRelease release) {
    Directory.CreateDirectory(_folder);
    string path = Path.Combine(_folder, $"GeminiLive-{release.Version}.msix");
    if (!File.Exists(path) || !await MatchesAsync(path, release)) {
      await FetchAsync(release, path);
    }

    if (await MatchesAsync(path, release)) {
      return path;
    }

    File.Delete(path);
    Log.Write("update: the download didn't match its hash");
    return null;
  }

  /// <summary>Opens the package in App Installer, where the user chooses Update.</summary>
  public static void Open(string path) {
    Shell.Open(path);
  }

  private static async Task FetchAsync(AppRelease release, string path) {
    await using Stream source = await ReleaseFeed.Http.GetStreamAsync(release.MsixUrl);
    await using FileStream target = File.Create(path);
    await source.CopyToAsync(target);
  }

  private static async Task<bool> MatchesAsync(string path, AppRelease release) {
    await using FileStream file = File.OpenRead(path);
    string actual = Convert.ToHexString(await SHA256.HashDataAsync(file));
    return actual.Equals(release.Sha256, StringComparison.OrdinalIgnoreCase);
  }
}
