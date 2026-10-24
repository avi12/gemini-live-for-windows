using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;

namespace GeminiLive;

/// <summary>
/// What the caption card says: the last few lines of "You: / Gemini:" transcript, and a chip for
/// every link Gemini mentioned. The window decides when the card shows; this owns what is in it.
/// Each line is its own TextBlock so a new one can fade in while the current one keeps updating.
/// </summary>
public sealed class CaptionPresenter {
  /// <summary>Raised after every change, so the window can show or hide the card.</summary>
  public event Action? Changed;

  private const int _maxLines = 6;
  private const double _chipTitleMaxWidth = 340;
  private const double _lineRise = 8;
  private const double _chipScaleFrom = 0.9;

  private readonly Panel _transcript;
  private readonly ScrollViewer _scroll;
  private readonly WrapPanel _linkTray;
  // One entry per child of _transcript: the run holding the line's text, and who said it.
  private readonly List<(Run Text, bool IsUser)> _lines = [];
  private readonly HashSet<string> _links = new(StringComparer.OrdinalIgnoreCase);

  public bool HasContent => _lines.Count > 0 || _linkTray.Children.Count > 0;

  public CaptionPresenter(Panel transcript, ScrollViewer scroll, WrapPanel linkTray) {
    _transcript = transcript;
    _scroll = scroll;
    _linkTray = linkTray;
  }

  public void Clear() {
    _lines.Clear();
    _transcript.Children.Clear();
    _links.Clear();
    _linkTray.Children.Clear();
    Refresh();
  }

  /// <summary>
  /// The engine sends the current utterance's full text; a new one starts when the speaker
  /// changes.
  /// </summary>
  public void Show(string text, bool isUser) {
    if (_lines.Count > 0 && _lines[^1].IsUser == isUser) {
      _lines[^1].Text.Text = text;
    } else {
      AppendLine(text, isUser);
    }

    if (!isUser) {
      AddLinks(LinkExtractor.Find(text));
    }

    Refresh();
  }

  /// <summary>Links that came with an answer rather than in its words, as chips.</summary>
  public void ShowLinks(IEnumerable<FoundLink> links) {
    AddLinks(links);
    Refresh();
  }

  /// <summary>A line of our own, like why the session ended, shown on Gemini's side.</summary>
  public void AddNote(string text) {
    AppendLine(text, false);
    Refresh();
  }

  private void AppendLine(string text, bool isUser) {
    var words = new Run(text);
    var line = new TextBlock();
    line.SetResourceReference(FrameworkElement.StyleProperty, "LiveBodyText");
    line.Inlines.Add(new Run(isUser ? "You: " : "Gemini: ") { FontWeight = FontWeights.SemiBold });
    line.Inlines.Add(words);
    _lines.Add((words, isUser));
    _transcript.Children.Add(line);
    Motion.Enter(line, rise: _lineRise);

    int extra = _lines.Count - _maxLines;
    if (extra > 0) {
      _lines.RemoveRange(0, extra);
      _transcript.Children.RemoveRange(0, extra);
    }
  }

  private void Refresh() {
    _scroll.ScrollToEnd();
    _linkTray.Visibility =
        _linkTray.Children.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    _linkTray.Margin = new Thickness(0, _lines.Count > 0 ? 10 : 0, 0, -8);
    Changed?.Invoke();
  }

  private void AddLinks(IEnumerable<FoundLink> links) {
    int arrived = 0;
    foreach (FoundLink link in links) {
      if (!_links.Add(link.Url)) {
        continue;
      }

      Button chip = ChipFor(link);
      _linkTray.Children.Add(chip);
      Motion.Enter(chip, rise: 0, scaleFrom: _chipScaleFrom, delay: Motion.Stagger * arrived++);
      Log.Write($"link: {link.Url}");
    }
  }

  private static Button ChipFor(FoundLink link) {
    var icon = new TextBlock {
      Text = link.IsSearch ? Glyphs.Search : Glyphs.Link,
      Margin = new Thickness(0, 0, 8, 0),
    };
    icon.SetResourceReference(FrameworkElement.StyleProperty, "LiveIcon");
    var title = new TextBlock {
      Text = link.Title,
      MaxWidth = _chipTitleMaxWidth,
      TextTrimming = TextTrimming.CharacterEllipsis,
      VerticalAlignment = VerticalAlignment.Center,
    };
    var chip = new Button {
      ToolTip = link.Url,
      RenderTransformOrigin = new Point(0.5, 0.5),  // pops from its centre
      Content = new StackPanel { Orientation = Orientation.Horizontal, Children = { icon, title } },
    };
    chip.SetResourceReference(FrameworkElement.StyleProperty, "LiveLinkChip");
    chip.Click += (_, _) => Shell.Open(link.Url);
    return chip;
  }
}
