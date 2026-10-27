using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GeminiLive;

/// <summary>
/// Reads the update manifest the repository hosts (docs/updates.json, written by
/// scripts\Write-UpdateManifest.ps1 once a release's package is attached): the latest version, where
/// its package is and the package's SHA-256. Like a browser extension's update URL, the app polls a
/// small file, and nothing is offered until that file names a release, so it never points at a
/// package that isn't up yet.
/// </summary>
public static class ReleaseFeed {
  private const string _defaultUrl =
      "https://raw.githubusercontent.com/avi12/gemini-live-for-windows/main/docs/updates.json";
  /// <summary>Points the check somewhere else, such as a local stand-in for GitHub, to test it.</summary>
  private const string _urlVariable = "GEMINILIVE_UPDATE_FEED";
  private const int _sha256HexLength = 64;
  private static readonly TimeSpan _lookupTimeout = TimeSpan.FromSeconds(20);

  /// <summary>
  /// One client for the feed and the download. It has no timeout of its own, since a package
  /// takes as long as the connection does; the lookup bounds itself.
  /// </summary>
  public static HttpClient Http { get; } = CreateClient();

  /// <summary>The release the manifest names, or null when there is none, or it can't be trusted.</summary>
  public static async Task<AppRelease?> LatestAsync() {
    string url = Environment.GetEnvironmentVariable(_urlVariable) is { Length: > 0 } custom
        ? custom
        : _defaultUrl;
    using var timeout = new CancellationTokenSource(_lookupTimeout);
    using HttpResponseMessage response = await Http.GetAsync(url, timeout.Token);
    if (response.StatusCode == HttpStatusCode.NotFound) {
      return null;  // no release has published a manifest yet
    }

    response.EnsureSuccessStatusCode();
    await using Stream body = await response.Content.ReadAsStreamAsync(timeout.Token);
    Manifest? manifest = await JsonSerializer.DeserializeAsync<Manifest>(body, cancellationToken: timeout.Token);
    return Trusted(manifest);
  }

  private static AppRelease? Trusted(Manifest? manifest) {
    if (manifest is not { Version: { } text, Url: { } url, Sha256: { } hash }
        || !Version.TryParse(text, out Version? version)
        || hash.Length != _sha256HexLength
        || !Uri.TryCreate(url, UriKind.Absolute, out Uri? address)
        || address.Scheme != Uri.UriSchemeHttps && address.Host != "localhost") {
      return null;
    }

    return new AppRelease(version, url, hash);
  }

  private static HttpClient CreateClient() {
    var client = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
    client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("GeminiLive", "1"));
    return client;
  }

  private sealed record Manifest(
      [property: JsonPropertyName("version")] string? Version,
      [property: JsonPropertyName("url")] string? Url,
      [property: JsonPropertyName("sha256")] string? Sha256);
}
