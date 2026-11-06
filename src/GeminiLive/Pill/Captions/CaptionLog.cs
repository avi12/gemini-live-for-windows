namespace GeminiLive;

/// <summary>
/// What the caption card says: the last few lines of "You: / Gemini:" transcript, and every link
/// Gemini mentioned. The window decides how it looks and when the card shows; this owns what is in
/// it. Each line has an id that stays with it, so the window can fade a new one in while the current
/// one keeps updating.
/// </summary>
public sealed class CaptionLog {
  /// <summary>Raised after every change, so the pill can publish it.</summary>
  public event Action? Changed;

  private const int _maxLines = 6;
  private const string _lineIdPrefix = "line-";
  private const string _linkIdPrefix = "link-";

  private readonly List<PillLine> _lines = [];
  private readonly List<PillLink> _links = [];
  private readonly HashSet<string> _urls = new(StringComparer.OrdinalIgnoreCase);
  private int _nextId;

  public IReadOnlyList<PillLine> Lines => _lines;

  public IReadOnlyList<PillLink> Links => _links;

  public void Clear() {
    _lines.Clear();
    _links.Clear();
    _urls.Clear();
    Changed?.Invoke();
  }

  /// <summary>
  /// The engine sends the current utterance's full text; a new one starts when the speaker
  /// changes (a note is never continued).
  /// </summary>
  public void Show(string text, bool isUser) {
    if (_lines is [.., { IsNote: false } last] && last.IsUser == isUser) {
      _lines[^1] = last with { Text = text };
    } else {
      AppendLine(text, isUser, isNote: false);
    }

    if (!isUser) {
      AddLinks(LinkExtractor.Find(text));
    }

    Changed?.Invoke();
  }

  /// <summary>Links that came with an answer rather than in its words.</summary>
  public void ShowLinks(IEnumerable<FoundLink> links) {
    AddLinks(links);
    Changed?.Invoke();
  }

  /// <summary>A line of our own, like why the session ended, shown on Gemini's side.</summary>
  public void AddNote(string text) {
    AppendLine(text, isUser: false, isNote: true);
    Changed?.Invoke();
  }

  private void AppendLine(string text, bool isUser, bool isNote) {
    _lines.Add(new PillLine(NextId(_lineIdPrefix), text, isUser, isNote));

    if (_lines.Count > _maxLines) {
      _lines.RemoveRange(0, _lines.Count - _maxLines);
    }
  }

  private void AddLinks(IEnumerable<FoundLink> links) {
    foreach (FoundLink link in links) {
      // The window rejects a view with a malformed address, so one never gets that far.
      if (!Uri.TryCreate(link.Url, UriKind.Absolute, out _) || !_urls.Add(link.Url)) {
        continue;
      }

      _links.Add(new PillLink(
          NextId(_linkIdPrefix), link.Title, link.Url, LinkExtractor.ShortTitle(link.Url), link.IsSearch));
      Log.Write($"link: {link.Url}");
    }
  }

  private string NextId(string prefix) {
    return prefix + _nextId++;
  }
}
