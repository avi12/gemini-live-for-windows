using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace GeminiLive;

/// <summary>
/// An exact text copy of the window the user is looking at, read through UI Automation. Gemini
/// reads screen frames at low resolution, so small text is a blur; this is the desktop take on
/// the browser's "annotated page content" Gemini can ask its host for.
/// </summary>
public static partial class ScreenText {
  /// <summary>What a block of text is (wire value: <see cref="WireName"/>).</summary>
  public enum BlockKind { Heading, Paragraph }

  public sealed record Block(BlockKind Kind, string Text);

  /// <summary>
  /// Title = the window's title; App = the process name ("Code", "msedge"); Version = a stable
  /// hash of Title and Blocks, so callers can tell when the text changed.
  /// </summary>
  public sealed record View(string Title, string App, IReadOnlyList<Block> Blocks, string Version);

  // Bounds, so a huge or busy window can never stall the caller.
  private static readonly TimeSpan _softDeadline = TimeSpan.FromMilliseconds(400);
  private static readonly TimeSpan _hardDeadline = TimeSpan.FromMilliseconds(1500);
  private const int _maxElements = 400;
  private const int _maxChars = 12_000;
  private const int _versionHexLength = 16;
  private const int _headingNone = 80050; // UIA_HeadingLevelPropertyId's "not a heading" value

  // Window chrome: its names are labels, not content, and nothing under it is either.
  private static readonly HashSet<ControlType> _chrome = [
    ControlType.Button, ControlType.SplitButton, ControlType.Menu, ControlType.MenuBar,
    ControlType.MenuItem, ControlType.ToolBar, ControlType.TitleBar, ControlType.ScrollBar,
    ControlType.StatusBar, ControlType.Tab, ControlType.TabItem, ControlType.Image,
  ];

  // One cross-process round trip per element instead of one per property.
  private static readonly CacheRequest _cache = BuildCache();

  /// <summary>
  /// The text of the foreground window if that window is on <paramref name="monitor"/>; null when
  /// there is none, it's on another monitor, it's our own process, or nothing readable was found.
  /// Call off the UI thread.
  /// </summary>
  public static View? Read(MonitorInfo monitor) {
    IntPtr hwnd = Native.GetForegroundWindow();
    if (hwnd == IntPtr.Zero
        || Native.MonitorFromWindow(hwnd, Native.MONITOR_DEFAULTTONEAREST) != monitor.Handle) {
      return null;
    }

    _ = Native.GetWindowThreadProcessId(hwnd, out uint pid);

    if (pid == Environment.ProcessId) {
      return null;
    }

    // A hung target app can block a single UIA call for seconds, past any soft deadline; the
    // walk runs on its own task so the caller gives up on it instead.
    Task<View?> work = Task.Run(() => Collect(hwnd, pid));
    return work.Wait(_hardDeadline) ? work.Result : null;
  }

  private static View? Collect(IntPtr hwnd, uint pid) {
    var blocks = new List<Block>();
    var seen = new HashSet<string>();
    int chars = 0;
    string title = "";

    void Add(BlockKind kind, string? raw) {
      string text = Whitespace().Replace(raw ?? "", " ").Trim();
      if (text.Length == 0 || chars >= _maxChars || !seen.Add(text)) {
        return;
      }

      text = text[..Math.Min(text.Length, _maxChars - chars)];
      chars += text.Length;
      blocks.Add(new Block(kind, text));
    }

    try {
      AutomationElement root = AutomationElement.FromHandle(hwnd).GetUpdatedCache(_cache);
      title = root.Cached.Name;
      var stopwatch = Stopwatch.StartNew();
      var queue = new Queue<AutomationElement>([root]);
      int visited = 0;
      while (queue.Count > 0 && visited < _maxElements && chars < _maxChars
             && stopwatch.Elapsed < _softDeadline) {
        visited++;
        VisitAndQueueChildren(queue.Dequeue(), queue, Add);
      }
    } catch (Exception e) when (IsGone(e)) {
      // The whole window went away; keep what was gathered.
    }

    if (blocks.Count == 0) {
      return null;
    }

    return new View(title, AppName(pid), blocks, Hash(title, blocks));
  }

  /// <summary>Takes <paramref name="element"/>'s text, and queues its children if they're worth a look.</summary>
  private static void VisitAndQueueChildren(AutomationElement element, Queue<AutomationElement> queue,
                                            Action<BlockKind, string?> add) {
    try {
      if (!Visit(element, add)) {
        return;
      }

      TreeWalker walker = TreeWalker.ControlViewWalker;
      for (AutomationElement? child = walker.GetFirstChild(element, _cache); child is not null;
           child = walker.GetNextSibling(child, _cache)) {
        queue.Enqueue(child);
      }
    } catch (Exception e) when (IsGone(e)) {
      // This element changed or went away mid-walk; its siblings may still be fine.
    }
  }

  /// <summary>
  /// Takes <paramref name="element"/>'s text; true when its children are still worth a look.
  /// </summary>
  private static bool Visit(AutomationElement element, Action<BlockKind, string?> add) {
    AutomationElement.AutomationElementInformation info = element.Cached;
    if (info.IsOffscreen || _chrome.Contains(info.ControlType)) {
      return false;
    }

    // Documents and edit controls (browsers, Word, Notepad, VS Code's editor) hand over their
    // text whole, which covers everything beneath them.
    if (element.GetCachedPropertyValue(AutomationElement.IsTextPatternAvailableProperty) is true
        && element.TryGetCurrentPattern(TextPattern.Pattern, out object pattern)) {
      var text = (TextPattern)pattern;
      TextPatternRange[] visible = text.GetVisibleRanges();
      IEnumerable<string> parts = visible.Length > 0
          ? visible.Select(range => range.GetText(_maxChars))
          : [text.DocumentRange.GetText(_maxChars)];
      foreach (string line in parts.SelectMany(part => part.Split('\n'))) {
        add(BlockKind.Paragraph, line);
      }
      return false;
    }

    if (IsHeading(element, info)) {
      add(BlockKind.Heading, info.Name);
    } else if (info.ControlType == ControlType.Edit
               && element.GetCachedPropertyValue(ValuePattern.ValueProperty) is string value) {
      add(BlockKind.Paragraph, value);
      return false;
    } else if (info.ControlType == ControlType.Text || info.ControlType == ControlType.ListItem) {
      add(BlockKind.Paragraph, info.Name);
    }

    return true;
  }

  private static bool IsHeading(AutomationElement element,
                                AutomationElement.AutomationElementInformation info) {
    if (info.ControlType == ControlType.Header || info.ControlType == ControlType.HeaderItem) {
      return true;
    }

    object level = element.GetCachedPropertyValue(AutomationElement.HeadingLevelProperty);
    int number = level switch {
      int i => i,
      Enum e => Convert.ToInt32(e, CultureInfo.InvariantCulture),
      _ => _headingNone,
    };
    return number > _headingNone;
  }

  private static bool IsGone(Exception e) {
    return e is ElementNotAvailableException or COMException or InvalidOperationException;
  }

  private static CacheRequest BuildCache() {
    var cache = new CacheRequest { TreeFilter = Automation.ControlViewCondition };
    cache.Add(AutomationElement.NameProperty);
    cache.Add(AutomationElement.ControlTypeProperty);
    cache.Add(AutomationElement.IsOffscreenProperty);
    cache.Add(AutomationElement.IsTextPatternAvailableProperty);
    cache.Add(AutomationElement.HeadingLevelProperty);
    cache.Add(ValuePattern.ValueProperty);
    return cache;
  }

  private static string AppName(uint pid) {
    try {
      using var process = Process.GetProcessById((int)pid);
      return process.ProcessName;
    } catch (ArgumentException) {
      return ""; // Exited since.
    }
  }

  private static string Hash(string title, List<Block> blocks) {
    var text = new StringBuilder(title);
    foreach (Block block in blocks) {
      text.Append('\n').Append(WireName.For(block.Kind)).Append(':').Append(block.Text);
    }
    byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(text.ToString()));
    return Convert.ToHexString(hash)[.._versionHexLength];
  }

  [GeneratedRegex(@"\s+")]
  private static partial Regex Whitespace();
}
