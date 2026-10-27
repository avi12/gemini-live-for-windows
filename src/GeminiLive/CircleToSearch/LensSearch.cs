using System.Text;

namespace GeminiLive;

/// <summary>
/// Circle to Search's "search with Google Lens": the cropped picture goes straight to Google Lens and
/// the results open in the default browser. Never through an image host: no third party sees it.
/// </summary>
/// <remarks>
/// The browser itself has to make the upload. Lens binds the results to the cookies of whoever
/// uploaded (verified 2026-10-26): a results URL from our own HTTP upload, opened in a browser with
/// different cookies, shows "About 0 results", or the "unusual traffic" page in a fresh profile. So
/// we write a one-shot local page that posts the JPEG as a form, the way lens.google.com's own
/// upload does, and open that; Google answers with a 303 to the results, in the user's own session.
/// </remarks>
public static class LensSearch {
  /// <summary>
  /// Lens' direct upload. Query: <c>ep=gsbubb</c> the entry point (results come back tagged
  /// <c>source=lns.web.gsbubb</c>), <c>re=df</c> the result mode, <c>stcs</c> the client clock in
  /// Unix ms, <c>vpw</c>/<c>vph</c> the viewport (the page adds those). Verified 2026-10-26 with
  /// curl and headless Chrome: a 303 to www.google.com/search?vsrid=...&amp;udm=26.
  /// </summary>
  private const string _uploadUrl = "https://lens.google.com/v3/upload?re=df&ep=gsbubb";

  /// <summary>The multipart field Lens reads the picture from (verified as above).</summary>
  private const string _imageField = "encoded_image";

  /// <summary>
  /// Optional multipart field, "width,height" of the picture; Lens echoes it as <c>vsdim</c>.
  /// </summary>
  private const string _dimensionsField = "processed_image_dimensions";

  /// <summary>Where the one-shot upload pages go, so stale ones can be swept.</summary>
  private static readonly string _pageDir = Path.Combine(Path.GetTempPath(), "GeminiLive-lens");

  /// <summary>
  /// How long an upload page is kept: the browser reads it once on open, so anything older is done.
  /// </summary>
  private static readonly TimeSpan _pageLifetime = TimeSpan.FromMinutes(5);

  /// <summary>
  /// Opens Google Lens results for <paramref name="crop"/> in the default browser. A page that
  /// can't be written or opened is only logged; never throws, since a search is best-effort.
  /// </summary>
  public static async Task SearchAsync(ScreenGrabber.Frame crop) {
    try {
      SweepOldPages();
      Directory.CreateDirectory(_pageDir);
      string page = Path.Combine(_pageDir, $"{Guid.NewGuid():N}.html");
      await File.WriteAllTextAsync(page, UploadPage(crop), Encoding.UTF8);
      Shell.Open(page);
    } catch (Exception e) {
      Log.Write($"Lens search failed: {e.Message}");
    }
  }

  /// <summary>
  /// A page that rebuilds the JPEG as a file input and submits it to Lens on load. A top-level form
  /// post needs no CORS, and the 303 it gets lands the tab on the results.
  /// </summary>
  private static string UploadPage(ScreenGrabber.Frame crop) {
    string jpeg = Convert.ToBase64String(crop.Jpeg);
    long sentAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    return $$"""
        <!doctype html>
        <meta charset="utf-8">
        <title>Google Lens</title>
        <form id="lens" method="post" enctype="multipart/form-data"
              action="{{_uploadUrl}}&stcs={{sentAt}}">
          <input type="file" name="{{_imageField}}" id="image" hidden>
          <input type="hidden" name="{{_dimensionsField}}" value="{{crop.Width}},{{crop.Height}}">
        </form>
        <p>Sending the picture to Google Lens...</p>
        <script>
          const bytes = Uint8Array.from(atob("{{jpeg}}"), (glyph) => glyph.charCodeAt(0));
          const files = new DataTransfer();
          files.items.add(new File([bytes], "image.jpg", { type: "{{ScreenGrabber.MimeType}}" }));
          document.getElementById("image").files = files.files;
          const form = document.getElementById("lens");
          form.action += `&vpw=${innerWidth}&vph=${innerHeight}`;
          form.submit();
        </script>
        """;
  }

  /// <summary>Deletes upload pages from earlier searches, which each hold a screenshot.</summary>
  private static void SweepOldPages() {
    if (!Directory.Exists(_pageDir)) {
      return;
    }

    foreach (string page in Directory.EnumerateFiles(_pageDir, "*.html")) {
      if (DateTime.UtcNow - File.GetLastWriteTimeUtc(page) <= _pageLifetime) {
        continue;  // still being read
      }

      try {
        File.Delete(page);
      } catch (Exception e) {
        Log.Write($"sweep Lens page failed: {e.Message}");  // one stuck page mustn't stop the search
      }
    }
  }
}
