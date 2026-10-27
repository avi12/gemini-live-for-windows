namespace GeminiLive;

/// <summary>A published release, as the repository's update manifest names it.</summary>
/// <param name="Version">Four-part, as the package's own version is.</param>
/// <param name="MsixUrl">Where the signed package downloads from.</param>
/// <param name="Sha256">The package's SHA-256, hex; a release without one is never offered.</param>
public sealed record AppRelease(Version Version, string MsixUrl, string Sha256);
