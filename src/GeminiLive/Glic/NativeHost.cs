using System.Text.Json;
using Microsoft.Win32;

namespace GeminiLive.Glic;

/// <summary>
/// How the companion extension finds <see cref="SessionLink"/> wherever the browser installed it:
/// we publish this run's <see cref="LinkInfo"/> in <see cref="LinkFile"/> and register
/// GeminiLiveHost as the browsers' native messaging host <see cref="NativeProtocol.HostName"/>,
/// which the extension asks for it (<see cref="NativeProtocol.Link"/>).
/// </summary>
public static class NativeHost {
  private const string _hostExe = "GeminiLiveHost.exe";  // = AssemblyName in GeminiLiveHost.csproj

  // Not under AppData, so an MSIX install doesn't virtualize it away from the browser.
  private static readonly string _manifestFile =
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                   ".gemini-live", $"{NativeProtocol.HostName}.json");

  // Each Chromium browser looks for its hosts under its own key; the default value names the manifest.
  private static readonly string[] _browserKeys = [
    @"Software\Google\Chrome",
    @"Software\Microsoft\Edge",
    @"Software\BraveSoftware\Brave-Browser",
    @"Software\Chromium",
  ];

  private static readonly JsonSerializerOptions _json = new() {
    WriteIndented = true,
  };

  /// <summary>Publishes where this run listens and (re)registers the host that hands it out.</summary>
  public static void Publish(LinkInfo link) {
    try {
      LinkFile.Write(link);
    } catch (Exception e) {
      Log.Write($"native host: link file: {e.Message}");
    }

    try {
      Register();
    } catch (Exception e) {
      Log.Write($"native host: register: {e.Message}");
    }
  }

  /// <summary>
  /// Writes the host manifest and points every browser at it. Redone on each start, so the path
  /// follows wherever this build of the app lives.
  /// </summary>
  private static void Register() {
    var manifest = new {
      name = NativeProtocol.HostName,
      description = "Tells the Gemini Live extension where the running app listens",
      path = HostPath(),
      type = "stdio",
      // Chrome matches the origin with its trailing slash.
      allowed_origins = new[] { SessionLink.ExtensionOrigin + "/" },
    };
    Directory.CreateDirectory(Path.GetDirectoryName(_manifestFile)!);
    File.WriteAllText(_manifestFile, JsonSerializer.Serialize(manifest, _json));

    foreach (string browser in _browserKeys) {
      string key = $@"HKEY_CURRENT_USER\{browser}\NativeMessagingHosts\{NativeProtocol.HostName}";
      Registry.SetValue(key, "", _manifestFile);
    }
    Log.Write($"native host: registered {manifest.path}");
  }

  /// <summary>
  /// Packaged, the host's own files can't be started by the browser, so it goes through the
  /// package's app execution alias; unpackaged (dotnet run), it is built next to the app.
  /// </summary>
  private static string HostPath() {
    if (!IsPackaged()) {
      return Path.Combine(AppContext.BaseDirectory, _hostExe);
    }

    return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "Microsoft", "WindowsApps", _hostExe);
  }

  private static unsafe bool IsPackaged() {
    uint length = 0;
    return Native.GetCurrentPackageFullName(ref length, null) != Native.APPMODEL_ERROR_NO_PACKAGE;
  }
}
