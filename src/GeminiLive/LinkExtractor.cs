using System.Text.RegularExpressions;

namespace GeminiLive;

/// <summary>
/// A place Gemini pointed at, ready to click. IsSearch: we only know what to look for.
/// </summary>
public sealed record FoundLink(string Title, string Url, bool IsSearch);

/// <summary>
/// Finds what Gemini is trying to hand over in a spoken answer. Live speaks, so it can't show a
/// link - it says a URL or a site name, or quotes a headline and tells you to search for it. Each
/// of those becomes something clickable: markdown links and URLs as-is, bare domains as https,
/// quoted titles as a Google search.
/// </summary>
public static partial class LinkExtractor {
  private const int _minQuotedTitle = 12;
  private const string _searchUrl = "https://www.google.com/search?q=";

  public static IEnumerable<FoundLink> Find(string text) {
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    return Candidates(text).Where(link => seen.Add(link.Url));
  }

  /// <summary>Every link in the text, most explicit first; Find drops the duplicates.</summary>
  private static IEnumerable<FoundLink> Candidates(string text) {
    foreach (Match m in MarkdownLink().Matches(text)) {
      yield return new(m.Groups["title"].Value, m.Groups["url"].Value, false);
    }

    string withoutMarkdown = MarkdownLink().Replace(text, " ");
    foreach (Match m in Url().Matches(withoutMarkdown)) {
      string url = m.Value.TrimEnd('.', ',', ')', ';', ':', '!', '?');
      yield return new(ShortTitle(url), url, false);
    }

    foreach (Match m in BareDomain().Matches(Url().Replace(withoutMarkdown, " "))) {
      yield return new(m.Value, "https://" + m.Value, false);
    }

    foreach (Match m in Quoted().Matches(text)) {
      string title = m.Groups["q"].Value.Trim();
      if (title.Length >= _minQuotedTitle) {
        yield return new(title, _searchUrl + Uri.EscapeDataString(title), true);
      }
    }
  }

  /// <summary>"host/path" for a URL that parses, the URL itself otherwise.</summary>
  private static string ShortTitle(string url) {
    if (!Uri.TryCreate(url, UriKind.Absolute, out Uri? uri)) {
      return url;
    }
    return uri.Host + uri.AbsolutePath.TrimEnd('/');
  }

  [GeneratedRegex(@"\[(?<title>[^\]]+)\]\((?<url>https?://[^)\s]+)\)")]
  private static partial Regex MarkdownLink();

  [GeneratedRegex(@"https?://[^\s<>""']+", RegexOptions.IgnoreCase)]
  private static partial Regex Url();

  // "gbhackers.com", "theregister.co.uk/2026/..." - a word, a dot, a known-looking TLD,
  // optional path.
  [GeneratedRegex(
      @"\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|dev|app|co|uk|il|edu|gov|news|tv|me|info)"
      + @"(?:/[^\s<>""']*[^\s<>""'.,;:!?)])?\b",
      RegexOptions.IgnoreCase)]
  private static partial Regex BareDomain();

  // Straight or curly double quotes.
  [GeneratedRegex(@"[""“”](?<q>[^""“”]+)[""“”]")]
  private static partial Regex Quoted();
}
