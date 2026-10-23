namespace GeminiLive.Glic;

/// <summary>
/// Every message from <see cref="HomeHost"/> to the Home page's bridge (HomeMessage in
/// bridge/home_protocol.ts; wire value: <see cref="WireName"/>).
/// </summary>
public enum HomeMessage { Ready, PcLights }

/// <summary>
/// The PC Lights tile as the page reads it; the rest is unset when <see cref="Found"/> is false.
/// </summary>
/// <param name="On">Null while the tile shows no state word yet.</param>
/// <param name="X">The tile's centre in page pixels, where a trusted click lands.</param>
public sealed record PcLights(bool Found, string? Name, bool? On, string? Text, int X, int Y);

/// <summary>The Home protocol map, as HomeProtocolMap in bridge/home_protocol.ts declares it.</summary>
public static class HomeProtocol {
  /// <summary>Whether the device grid has loaded the lights' state.</summary>
  public static readonly Protocol<HomeMessage, None, bool> Ready = new(HomeMessage.Ready);
  public static readonly Protocol<HomeMessage, None, PcLights> PcLights = new(HomeMessage.PcLights);
}
