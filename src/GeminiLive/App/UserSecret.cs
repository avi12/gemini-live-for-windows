using System.Security.Cryptography;

namespace GeminiLive;

/// <summary>
/// DPAPI scoped to this Windows user: anything secret we keep on disk (the API key, the Google
/// session) is sealed here, so only this account on this machine can read it back.
/// </summary>
public static class UserSecret {
  public static byte[] Seal(byte[] plain) {
    return ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
  }

  public static byte[] Unseal(byte[] secret) {
    return ProtectedData.Unprotect(secret, null, DataProtectionScope.CurrentUser);
  }
}
