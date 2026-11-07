// A published release, as the repository's update manifest names it
export interface AppRelease {
  // Four-part, as the package's own version is
  readonly version: string;
  // Where the signed package downloads from
  readonly msixUrl: string;
  // The package's SHA-256, hex; a release without one is never offered
  readonly sha256: string;
}
