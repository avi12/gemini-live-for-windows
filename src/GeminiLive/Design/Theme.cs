using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;

namespace GeminiLive;

/// <summary>
/// The colour half of the design system (Googlebook's Material 3): every colour token, for both
/// Windows themes. Tokens are published as application resources, so XAML binds them with
/// DynamicResource and the whole UI re-themes live when the user flips light/dark. Shape,
/// spacing and type don't depend on the theme and live in App.xaml.
/// </summary>
public static class Theme {
  private const string _personalizeKey =
      @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

  // Every solid token as (key, dark ARGB, light ARGB).
  private static readonly (string Key, string Dark, string Light)[] _solids = [
    ("LiveSurfaceBrush", "#F2111318", "#F5F0F4F9"),
    ("LiveMenuSurfaceBrush", "#FF282A2C", "#FFF8FAFD"),
    ("LiveTextBrush", "#FFE3E3E3", "#FF1F1F1F"),
    ("LiveSecondaryTextBrush", "#FFA8ABAF", "#FF444746"),
    ("LiveOutlineVariantBrush", "#FF444746", "#FFC4C7C5"),
    // A text field's outline: Material's outline role; outline-variant is too faint to read as one.
    ("LiveOutlineBrush", "#FF8E918F", "#FF747775"),
    // A menu's chosen row: Material's secondary container and the text on it.
    ("LiveSelectedContainerBrush", "#FF004A77", "#FFC2E7FF"),
    ("LiveOnSelectedContainerBrush", "#FFC2E7FF", "#FF001D35"),
    ("LiveControlBrush", "#FF333537", "#FFDDE3EA"),
    ("LiveControlHoverBrush", "#FF44474A", "#FFD3DAE2"),
    ("LivePrimaryBrush", "#FFA8C7FA", "#FF0B57D0"),
    ("LiveShareBrush", "#FFA8C7FA", "#FFD3E3FD"),
    ("LiveOnShareBrush", "#FF062E6F", "#FF041E49"),
    ("LiveMutedBrush", "#FFF2B8B5", "#FFF9DEDC"),
    ("LiveOnMutedBrush", "#FF601410", "#FF410E0B"),
    ("LiveInverseSurfaceBrush", "#FFE3E3E3", "#FF303030"),
    ("LiveInverseTextBrush", "#FF303030", "#FFF2F2F2"),
  ];

  // The card/pill rim: a cool blue→light-blue→violet line, the crisp edge of Gemini's glow.
  private static readonly LinearGradientBrush _darkEdge = Gradient(
      new Point(0, 0), new Point(1, 1), ("#884285F4", 0), ("#558AB4F8", 0.5), ("#66B36BF0", 1));
  private static readonly LinearGradientBrush _lightEdge = Gradient(
      new Point(0, 0), new Point(1, 1), ("#404285F4", 0), ("#1A000000", 0.5), ("#338AB4F8", 1));

  // Gemini's glow keeps its colours in both themes; only its strength changes (LiveGlowOpacity).
  private static readonly LinearGradientBrush _glow = Gradient(
      new Point(0, 0), new Point(1, 0),
      ("#FF4285F4", 0), ("#FFB36BF0", 0.4), ("#FFF06292", 0.7), ("#FFFBBC04", 1));

  private static bool IsDark =>
      Registry.GetValue(_personalizeKey, "AppsUseLightTheme", 1) is int light && light == 0;

  /// <summary>Publishes the tokens now, and again whenever the user flips light/dark.</summary>
  public static void Follow() {
    Apply();
    SystemEvents.UserPreferenceChanged +=
        (_, _) => Application.Current.Dispatcher.BeginInvoke(Apply);
  }

  private static void Apply() {
    bool dark = IsDark;
    ResourceDictionary resources = Application.Current.Resources;
    foreach ((string key, string darkArgb, string lightArgb) in _solids) {
      resources[key] = Solid(Parse(dark ? darkArgb : lightArgb));
    }

    // Material's state layers: the text colour over the surface, at App.xaml's state-layer opacities.
    Color text = ((SolidColorBrush)resources["LiveTextBrush"]).Color;
    resources["LiveHoverLayerBrush"] = Layer(text, (double)resources["HoverLayerOpacity"]);
    resources["LivePressedLayerBrush"] = Layer(text, (double)resources["PressedLayerOpacity"]);
    resources["LiveEdgeBrush"] = dark ? _darkEdge : _lightEdge;
    // The caption card's soft halo colour (fed to a DropShadowEffect); near-black dark card wears
    // a blue bloom, the light card only a faint cool one. Alpha carries the strength.
    resources["LiveCardGlowColor"] = Parse(dark ? "#B38AB4F8" : "#3A5B8DEF");
    resources["LiveGlowBrush"] = _glow;
    // The glow's peak; it multiplies whatever the animations set, and sits quieter on light.
    resources["LiveGlowOpacity"] = dark ? 1.0 : 0.6;
  }

  private static Color Parse(string argb) {
    return (Color)ColorConverter.ConvertFromString(argb);
  }

  /// <summary><paramref name="color"/> at <paramref name="opacity"/>, as a state layer brush.</summary>
  private static SolidColorBrush Layer(Color color, double opacity) {
    byte alpha = (byte)Math.Round(opacity * byte.MaxValue);
    return Solid(Color.FromArgb(alpha, color.R, color.G, color.B));
  }

  private static SolidColorBrush Solid(Color color) {
    var brush = new SolidColorBrush(color);
    brush.Freeze();
    return brush;
  }

  private static LinearGradientBrush Gradient(Point start, Point end,
                                              params (string Argb, double Offset)[] stops) {
    var brush = new LinearGradientBrush { StartPoint = start, EndPoint = end };
    foreach ((string argb, double offset) in stops) {
      brush.GradientStops.Add(new GradientStop(Parse(argb), offset));
    }
    brush.Freeze();
    return brush;
  }
}
