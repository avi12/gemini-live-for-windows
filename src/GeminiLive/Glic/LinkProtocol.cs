namespace GeminiLive.Glic;

/// <summary>
/// Every message between <see cref="SessionLink"/> and the companion extension, both directions
/// (LinkMessage in extension/src/lib/link-protocol.ts; wire value: <see cref="WireName"/>).
/// </summary>
public enum LinkMessage {
  // app → extension
  Hello,
  Query,
  Refresh,
  Ping,
  // extension → app
  Cookies,
}

/// <summary>The link protocol map, as LinkProtocolMap in extension/src/lib/link-protocol.ts.</summary>
public static class LinkProtocol {
  /// <summary>
  /// First on every connection: this run's token, proving it is the app that published the link
  /// the native host handed out (<see cref="NativeHost"/>). The extension answers nothing else
  /// until it matches.
  /// </summary>
  public static readonly Protocol<LinkMessage, string, None> Hello = new(LinkMessage.Hello);
  /// <summary>The browser's current Google cookies.</summary>
  public static readonly Protocol<LinkMessage, None, IReadOnlyList<GoogleCookie>> Query =
      new(LinkMessage.Query);
  /// <summary>Ours stopped working: have the browser refresh the session; it arrives as Cookies.</summary>
  public static readonly Protocol<LinkMessage, None, None> Refresh = new(LinkMessage.Refresh);
  /// <summary>Keepalive; answering it keeps the extension's worker awake.</summary>
  public static readonly Protocol<LinkMessage, None, None> Ping = new(LinkMessage.Ping);
  /// <summary>The cookies after a sign-in or a rotation.</summary>
  public static readonly Protocol<LinkMessage, IReadOnlyList<GoogleCookie>, None> Cookies =
      new(LinkMessage.Cookies);
}
