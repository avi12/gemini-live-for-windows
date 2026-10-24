using System.Text.RegularExpressions;

namespace GeminiLive.Glic;

/// <summary>
/// Reads what a spoken line asks for, so <see cref="GlicConversation"/> can route the requests
/// Live can't serve: switching the PC lights, the Google apps only Gemini's text path reaches, and
/// web searches whose links Live can only say. Refusals and web requests are read in English and
/// Hebrew; Hebrew words carry prefixes ("לאתר", "הקישור"), so those match without word bounds.
/// </summary>
internal static partial class SpokenIntent {
  private static readonly (Regex Pattern, string Name)[] _appNames = [
    (new(@"\b(gmail|e-?mail|inbox|mail)\b", RegexOptions.IgnoreCase), "Gmail"),
    (new(@"\b(keep|note|notes)\b", RegexOptions.IgnoreCase), "Keep"),
    (new(@"\b(task|tasks|to-?dos?)\b", RegexOptions.IgnoreCase), "Tasks"),
    (new(@"\b(calendar|schedule|meeting|event|events)\b", RegexOptions.IgnoreCase), "Calendar"),
  ];

  /// <summary>
  /// A plain spoken command to switch the lights: it names the lights, with a switch verb and a
  /// clear direction. Questions ("are the lights on?") and Calendar/Keep/Tasks requests that merely
  /// mention lights ("remind me to turn off the lights") fall through to their own paths, so the
  /// light is never toggled by accident.
  /// </summary>
  public static bool TryLightsCommand(string text, out bool on) {
    on = false;

    if (Question().IsMatch(text) || AppTopic().IsMatch(text)
        || !LightsTopic().IsMatch(text) || !SwitchVerb().IsMatch(text)) {
      return false;
    }

    bool wantsOn = TurnOn().IsMatch(text);
    bool wantsOff = TurnOff().IsMatch(text);
    if (wantsOn == wantsOff) {
      return false;
    }

    on = wantsOn;
    return true;
  }

  /// <summary>Gemini refusing an app it can't reach in Live: a "can't / don't have" plus an app topic.</summary>
  public static bool NeedsApp(string text) {
    return Refusal().IsMatch(text) && AppTopic().IsMatch(text);
  }

  /// <summary>
  /// The user plainly asking an app to do or report something (app topic + an imperative or a
  /// question about it) - which Live can't, so it is handled on the text path up front.
  /// </summary>
  public static bool TargetsApp(string text) {
    return AppTopic().IsMatch(text) && Intent().IsMatch(text);
  }

  /// <summary>
  /// The user asking for a web search or a link outright - which Live answers by voice only, so it
  /// is handled on the text path up front, where the answer comes with its links.
  /// </summary>
  public static bool AsksWeb(string text) {
    return WebRequest().IsMatch(text);
  }

  /// <summary>
  /// Gemini not handing over a page: saying it can't search, browse or give a link (a refusal
  /// plus a web topic), or sending the user off to find it on a site themselves.
  /// </summary>
  public static bool WithholdsLink(string text) {
    return (Refusal().IsMatch(text) && WebTopic().IsMatch(text)) || PointsToSite().IsMatch(text);
  }

  /// <summary>The app a request names, for the status line while it runs; ambiguous words fall through.</summary>
  public static string AppName(string request) {
    foreach ((Regex pattern, string name) in _appNames) {
      if (pattern.IsMatch(request)) {
        return name;
      }
    }
    return "your Google apps";
  }

  [GeneratedRegex(
      @"\b(can'?t|cannot|don'?t|do not|unable|not able|no access)\b"
      + @"|(איני|אינני|אני לא|לא)\s+(יכול|יכולה|יכולים|מסוגל|מסוגלת)|אין לי (גישה|אפשרות)",
      RegexOptions.IgnoreCase)]
  private static partial Regex Refusal();

  // What a refusal to go on the web talks about.
  [GeneratedRegex(
      @"\b(links?|urls?|websites?|web ?pages?|browse|browsing|search(ing)?|internet|online|real-time)\b"
      + "|קישור|לינק|כתובת|אתר|לגלוש|גלישה|לחפש|חיפוש|אינטרנט",
      RegexOptions.IgnoreCase)]
  private static partial Regex WebTopic();

  // Plainly asking for a search or a link; a passing mention ("I linked it") isn't a request.
  // Hebrew asks with the verb as often as the noun: "תקשר אותי" (link me), "לקשר".
  [GeneratedRegex(
      @"\b(search (for|the web|online|google)|google (it|for|that)|look (it |that )?up"
      + @"|find (me )?(a |the )?(link|article|page|source)|(send|give|show) me (a |the )?links?"
      + @"|link me|link (it|that)|links? (to|for)|the link|urls? (for|of)|sources? (for|on))\b"
      + "|קישור|לינק|תקשר|תקשרי|לקשר|קשר אותי|קשרי אותי|תחפש|תחפשי|חפש לי|חפשי לי|לחפש"
      + "|תמצא לי|תמצאי לי",
      RegexOptions.IgnoreCase)]
  private static partial Regex WebRequest();

  // Gemini sending the user off to find a page themselves instead of giving it.
  [GeneratedRegex(
      @"\b(you (can|could|'ll|will) (find|read|see) (it|them|this) (on|at)"
      + @"|on (their|the|its) (official )?(site|website|blog)|visit (their|the) (official )?(site|website))\b"
      + "|באתר הרשמי|באתר שלהם|בכתובת|תוכל למצוא|תוכלי למצוא|יכול למצוא|יכולה למצוא",
      RegexOptions.IgnoreCase)]
  private static partial Regex PointsToSite();

  [GeneratedRegex(
      // Only apps Gemini's web text turns can reach (its Connected Apps page). Not Home, alarms or
      // timers: the web has no tool for them, so the detour only paused Live for a dead end.
      @"\b(calendar|schedule|meeting|event|remind|reminder|task|to-?do|note|keep|gmail|e-?mail|inbox|mail)\b",
      RegexOptions.IgnoreCase)]
  private static partial Regex AppTopic();

  [GeneratedRegex(
      @"\b(add|create|schedule|set|make|new|delete|remove|cancel|move|reschedule|turn on|turn off|switch on|switch off|dim|list|show|check|read|send|mark|star|archive|do i have|what'?s on|what is on|what'?s my|what are my|when'?s|when is)\b",
      RegexOptions.IgnoreCase)]
  private static partial Regex Intent();

  // The one Home device we control for now; "lights" is enough to name it in a spoken command.
  [GeneratedRegex(@"\blights?\b", RegexOptions.IgnoreCase)]
  private static partial Regex LightsTopic();

  // A command needs a switch verb so a mention isn't mistaken for an instruction.
  [GeneratedRegex(@"\b(turn|switch|put|flip|kill)\b", RegexOptions.IgnoreCase)]
  private static partial Regex SwitchVerb();

  [GeneratedRegex(@"\bon\b", RegexOptions.IgnoreCase)]
  private static partial Regex TurnOn();

  [GeneratedRegex(@"\b(off|out)\b", RegexOptions.IgnoreCase)]
  private static partial Regex TurnOff();

  // Leading interrogative: a question about the lights, not a command to switch them.
  [GeneratedRegex(@"^\s*(are|is|was|were|do|does|did|can|could|would|will|should|what|which|when|how|why|whose)\b",
                  RegexOptions.IgnoreCase)]
  private static partial Regex Question();
}
