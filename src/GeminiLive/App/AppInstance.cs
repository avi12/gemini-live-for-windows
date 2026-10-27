namespace GeminiLive;

/// <summary>
/// The running app's single-instance mutex, which the first process holds for its lifetime (see
/// App). Also compiled into GeminiLiveHost, which asks it whether the app is running.
/// </summary>
public static class AppInstance {
  public const string MutexName = @"Local\GeminiLive.SingleInstance";

  /// <summary>Whether some process holds the app's mutex right now.</summary>
  public static bool IsRunning() {
    try {
      if (!Mutex.TryOpenExisting(MutexName, out Mutex? mutex)) {
        return false;
      }

      mutex.Dispose();
      return true;
    } catch (UnauthorizedAccessException) {
      return true;  // it exists; we just may not touch it
    }
  }
}
