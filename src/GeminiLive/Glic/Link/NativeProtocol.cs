namespace GeminiLive.Glic;

/// <summary>
/// Every message between the companion extension and the native messaging host (GeminiLiveHost),
/// which is how the extension finds the app wherever the browser installed it (NativeMessage in
/// extension/src/lib/native-protocol.ts; wire value: <see cref="WireName"/>).
/// </summary>
public enum NativeMessage { Link }

// Plain <c>, not a cref: GeminiLiveHost compiles this file without SessionLink.
/// <summary>Where this run of the app's <c>SessionLink</c> listens, and its Hello token.</summary>
public sealed record LinkInfo(int Port, string Token);

/// <summary>The native protocol map, as NativeProtocolMap in extension/src/lib/native-protocol.ts.</summary>
public static class NativeProtocol {
  /// <summary>The name the browser knows the host by (its manifest and registry key).</summary>
  public const string HostName = "com.avi12.gemini_live";

  /// <summary>The running app's link; null when the app isn't running.</summary>
  public static readonly Protocol<NativeMessage, None, LinkInfo?> Link = new(NativeMessage.Link);
}
