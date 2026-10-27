namespace GeminiLive.Glic;

/// <summary>
/// Where we put the files a browser reads (the companion extension, the native host's manifest).
/// Not under AppData, so an MSIX install doesn't virtualize it away from the browser.
/// </summary>
internal static class BrowserFolder {
  public static readonly string Dir = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gemini-live");
}
