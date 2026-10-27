using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Drawing = System.Drawing;
using Shapes = System.Windows.Shapes;

namespace GeminiLive;

/// <summary>
/// Everything <see cref="CircleOverlay"/> shows, dressed as Google's own Circle to Search (Material 3
/// Expressive): the frozen still, the barely-there scrim with the selection cut out of it, the
/// four-colour glow around the screen's edge, the live stroke, the selection's brackets and landing
/// flash, the how-to hint and the action pill. It owns those elements and their motion, and knows
/// nothing of gestures: the overlay says what happened and <see cref="CircleGeometry"/> says where.
/// </summary>
internal sealed class CircleChrome {
  /// <summary>What the chrome's buttons do, handed over by the window that owns the state.</summary>
  public sealed record Actions(Action<CircleAction> Finish, Action SelectText, Action Copy, Action LeaveText);

  // The live stroke: a wide soft glow in Google's four colours under a thick white core.
  private const double _glowThickness = 20;
  private const double _glowOpacity = 0.85;
  private const double _glowBlur = 12;
  private const double _coreThickness = 6;
  // Pointer moves shorter than this add no point, so a slow hand doesn't pile up thousands.
  private const double _minPointStep = 1.5;
  private const double _bracketThickness = 5;
  // A faint dark halo under the white brackets, so they still read over a white page.
  private const double _bracketShadowBlur = 10;
  private const double _bracketShadowOpacity = 0.35;
  // The brackets land from slightly larger, so the selection reads as snapping into place.
  private const double _bracketScaleFrom = 1.06;
  // The white flash that sweeps the selection the moment it lands.
  private const double _flashOpacity = 0.45;
  // The scrim: barely there while drawing, deeper outside a selection so the selection pops.
  private const double _idleDim = 0.08;
  private const double _selectedDim = 0.4;
  // Alpha of the faint Google-colour wash over the scrim.
  private const byte _tintAlpha = 0x1A;
  // The screen-edge glow: a crisp gradient line over a wide blurred one.
  private const double _edgeThickness = 3;
  private const double _edgeGlowThickness = 14;
  private const double _edgeGlowBlur = 28;
  private const double _edgeGlowOpacity = 0.7;
  // The search-bar pill and its two actions.
  private const double _pillPadding = 8;
  private const double _pillShadowBlur = 28;
  private const double _pillShadowDepth = 6;
  private const double _pillShadowOpacity = 0.28;
  // Straight down, so the pill floats above the page.
  private const double _pillShadowDirection = 270;
  private const double _pillRise = 24;
  private const double _pillScaleFrom = 0.94;
  private const double _actionHeight = 48;
  private const double _actionGap = 8;
  private const double _actionIconSize = 18;
  private const double _actionIconGap = 10;
  // The how-to at top centre drops in from slightly above.
  private const double _hintTop = 28;
  private const double _hintDrop = -12;
  private const double _hintPaddingX = 20;
  private const double _hintPaddingY = 12;
  // The frozen still is drawn stretched to the window, so its own resolution tag is moot.
  private const double _bitmapDpi = 96;
  // How long a notice ("Copied") stays in the hint chip before it fades.
  private static readonly TimeSpan _noticeTime = TimeSpan.FromMilliseconds(1600);
  // Text mode: the faint tint on every word, the stronger one on the picked ones, and the corner
  // radius that keeps both from looking like bare rectangles.
  private const double _wordOpacity = 0.14;
  private const double _pickedOpacity = 0.45;
  private const double _wordRadius = 3;
  private const double _bandOpacity = 0.7;
  private const double _bandThickness = 1.5;
  private const string _hintText = "Circle anything to search  ·  Esc to cancel";
  private const string _askHintText = "Circle what Gemini should look at  ·  Esc to cancel";

  /// <summary>
  /// Google's four brand colours (blue, red, yellow, green): the edge glow, the stroke's glow and
  /// the scrim's wash. Not a Theme token because they are the brand, identical in both themes.
  /// </summary>
  private static readonly Color[] _googleColours = [
    Color.FromRgb(0x42, 0x85, 0xF4),
    Color.FromRgb(0xEA, 0x43, 0x35),
    Color.FromRgb(0xFB, 0xBC, 0x04),
    Color.FromRgb(0x34, 0xA8, 0x53),
  ];

  /// <summary>The four colours diagonally across the screen, for the edge glow.</summary>
  private static readonly LinearGradientBrush _edgeBrush =
      GoogleGradient(new Point(0, 0), new Point(1, 1), byte.MaxValue);

  /// <summary>The four colours along the loop's bounds, for the stroke's glow and the Lens icon.</summary>
  private static readonly LinearGradientBrush _strokeBrush =
      GoogleGradient(new Point(0, 0), new Point(1, 0), byte.MaxValue);

  /// <summary>The four colours top to bottom at a whisper, the scrim's faint wash.</summary>
  private static readonly LinearGradientBrush _tintBrush =
      GoogleGradient(new Point(0, 0), new Point(0, 1), _tintAlpha);

  /// <summary>Gemini's four-point sparkle, in a 24-unit box; drawn, since the icon font has none.</summary>
  private static readonly Geometry _sparkle = FrozenGeometry(
      "M12,0 C12,6.6 17.4,12 24,12 C17.4,12 12,17.4 12,24 C12,17.4 6.6,12 0,12 C6.6,12 12,6.6 12,0 Z");

  private readonly Grid _root = new();
  private readonly Canvas _stroke = new() { IsHitTestVisible = false };
  private readonly PointCollection _points = new();
  private readonly RectangleGeometry _screenArea = new(new Rect(0, 0, 0, 0));
  private readonly RectangleGeometry _cutout = new(new Rect(0, 0, 0, 0));
  private readonly ScaleTransform _bracketScale = new();
  private readonly Shapes.Path _dim;
  private readonly Shapes.Path _brackets;
  private readonly Shapes.Rectangle _flash = new() { Fill = Brushes.White, Opacity = 0, IsHitTestVisible = false };
  private readonly Grid _edge = Edge();
  private readonly TextBlock _hintLabel = new();
  private readonly Border _hint;
  private readonly DispatcherTimer _noticeTimer = new() { Interval = _noticeTime };
  private readonly Border _pill;
  private readonly Button _selectTextButton;
  private readonly Border _textBar;
  private readonly Button _copyButton;
  private readonly Shapes.Path _words = TextLayer(_wordOpacity);
  private readonly Shapes.Path _picked = TextLayer(_pickedOpacity);
  private readonly Shapes.Rectangle _band = Band();
  // Whether the pill already made its entrance for the current selection.
  private bool _pillShown;
  // The side the pill is on, so a jump to another one can bounce over instead of teleporting.
  private CircleGeometry.BarSide _pillSide;
  private bool _hintVisible = true;
  // The selection both bars attach to, so text mode can place its bar beside it.
  private Rect _selection;

  /// <summary>
  /// Builds the chrome over <paramref name="still"/>. <paramref name="askOnRelease"/> picks the
  /// hint for a loop that is itself the request; <paramref name="actions"/> run when a button is
  /// clicked.
  /// </summary>
  public CircleChrome(Drawing.Bitmap still, bool askOnRelease, Actions actions) {
    BuildStroke();
    _dim = Scrim(Brushes.Black, _idleDim);
    _brackets = Brackets(_bracketScale);
    _hint = Hint(askOnRelease ? _askHintText : _hintText);
    (_pill, _selectTextButton) = Pill(actions);
    (_textBar, _copyButton) = TextBar(actions);
    Compose(still);
    _root.SizeChanged += (_, _) => _screenArea.Rect = new Rect(_root.RenderSize);
    _noticeTimer.Tick += (_, _) => {
      _noticeTimer.Stop();
      HideHint();
    };
  }

  /// <summary>The window's content, and the surface pointer positions are read against.</summary>
  public FrameworkElement Root => _root;

  /// <summary>The surface's size in DIPs: the whole monitor.</summary>
  public Size Screen => _root.RenderSize;

  /// <summary>
  /// The chrome's entrance once the window shows: the edge glow fades up and the hint drops in (the
  /// action pill arrives with the first selection).
  /// </summary>
  public void Enter() {
    Motion.Animate(_edge, UIElement.OpacityProperty, 1, Motion.EnterDuration, Motion.EmphasizedDecelerate,
                   from: 0);
    Motion.Enter(_hint, _hintDrop);
  }

  /// <summary>Starts a fresh stroke at <paramref name="point"/>; the hint goes for good.</summary>
  public void BeginStroke(Point point) {
    HideHint();
    _stroke.BeginAnimation(UIElement.OpacityProperty, null);
    _stroke.Opacity = 1;
    _points.Clear();
    _points.Add(point);
  }

  /// <summary>Adds the pointer to the stroke once it has moved far enough to matter.</summary>
  public void ExtendStroke(Point point) {
    if ((point - _points[^1]).Length < _minPointStep) {
      return;
    }

    _points.Add(point);
  }

  /// <summary>Fades the stroke out, whatever becomes of it; the loop it drew, to judge.</summary>
  public IEnumerable<Point> EndStroke() {
    Motion.Animate(_stroke, UIElement.OpacityProperty, 0, Motion.ExitDuration, Motion.Linear);
    return _points;
  }

  /// <summary>
  /// Shows <paramref name="area"/> as the selection: a rounded hole in the scrim (which deepens
  /// when the selection is <paramref name="fresh"/>), bracketed, with the action pill attached.
  /// </summary>
  public void ShowSelection(Rect area, bool fresh) {
    double radius = CircleGeometry.CornerRadius(area);
    _selection = area;
    _cutout.Rect = area;
    _cutout.RadiusX = radius;
    _cutout.RadiusY = radius;
    _brackets.Data = CircleGeometry.Brackets(area);
    _brackets.Visibility = Visibility.Visible;

    if (fresh) {
      Dim(_selectedDim);
    }

    PlaceBar(area);
  }

  /// <summary>
  /// The new selection lands: a white sheen flashes across it and fades, and the brackets settle
  /// in from slightly larger.
  /// </summary>
  public void SnapIn(Rect area) {
    double radius = CircleGeometry.CornerRadius(area);
    _flash.Width = area.Width;
    _flash.Height = area.Height;
    _flash.RadiusX = radius;
    _flash.RadiusY = radius;
    Canvas.SetLeft(_flash, area.X);
    Canvas.SetTop(_flash, area.Y);
    Motion.Animate(_flash, UIElement.OpacityProperty, 0, Motion.EnterDuration, Motion.Standard,
                   from: _flashOpacity);
    _bracketScale.CenterX = area.X + area.Width / 2;
    _bracketScale.CenterY = area.Y + area.Height / 2;
    Duration duration = Motion.EnterDuration;
    IEasingFunction easing = Motion.EmphasizedDecelerate;
    Motion.Animate(_brackets, UIElement.OpacityProperty, 1, duration, easing, from: 0);
    Motion.Animate(_bracketScale, ScaleTransform.ScaleXProperty, 1, duration, easing,
                   from: _bracketScaleFrom);
    Motion.Animate(_bracketScale, ScaleTransform.ScaleYProperty, 1, duration, easing,
                   from: _bracketScaleFrom);
  }

  /// <summary>
  /// Back to no selection: the hole closes, the scrim lightens to its drawing level, the brackets
  /// and the action pill go.
  /// </summary>
  public void ClearSelection() {
    _cutout.Rect = new Rect(0, 0, 0, 0);
    _brackets.Visibility = Visibility.Collapsed;
    _flash.BeginAnimation(UIElement.OpacityProperty, null);
    _flash.Opacity = 0;
    Dim(_idleDim);
    _pill.Visibility = Visibility.Collapsed;
    _pillShown = false;
  }

  /// <summary>
  /// Shows <paramref name="message"/> in the hint chip: for a moment, or with
  /// <paramref name="lasting"/> until something else replaces or hides it.
  /// </summary>
  public void Say(string message, bool lasting = false) {
    _noticeTimer.Stop();
    _hintLabel.Text = message;
    _hintVisible = true;
    Motion.Animate(_hint, UIElement.OpacityProperty, 1, Motion.EnterDuration, Motion.EmphasizedDecelerate);

    if (!lasting) {
      _noticeTimer.Start();
    }
  }

  /// <summary>
  /// Marks the text search as running: "Select text" can't be pressed again, and the chip says why
  /// until the search ends.
  /// </summary>
  public void SetReading(bool reading, string message) {
    _selectTextButton.IsEnabled = !reading;

    if (reading) {
      Say(message, lasting: true);
    } else {
      HideHint();
    }
  }

  /// <summary>
  /// Enters text mode: tints every word of <paramref name="words"/> as selectable, and swaps the
  /// action pill for the text bar. The dim and the selection's brackets stay as they were.
  /// </summary>
  public void ShowWords(IEnumerable<Rect> words) {
    _words.Data = WordGeometry(words);
    _words.Visibility = Visibility.Visible;
    _pill.Visibility = Visibility.Collapsed;
    SetPicked([]);
    (CircleGeometry.BarSide side, _) = Attach(_textBar, _selection);
    Motion.Enter(_textBar, PillRise(side), _pillScaleFrom);
  }

  /// <summary>Leaves text mode: the tints and the text bar go, and the action pill returns if it was up.</summary>
  public void HideWords() {
    _words.Visibility = Visibility.Collapsed;
    _picked.Visibility = Visibility.Collapsed;
    _textBar.Visibility = Visibility.Collapsed;
    ShowBand(null);
    HideHint();

    if (_pillShown) {
      _pill.Visibility = Visibility.Visible;
    }
  }

  /// <summary>Marks the words at <paramref name="words"/> as selected; "Copy" needs at least one.</summary>
  public void SetPicked(IReadOnlyCollection<Rect> words) {
    _picked.Data = WordGeometry(words);
    _picked.Visibility = Visibility.Visible;
    _copyButton.IsEnabled = words.Count > 0;
  }

  /// <summary>Draws the rubber band over <paramref name="area"/>; null puts it away.</summary>
  public void ShowBand(Rect? area) {
    if (area is not { } band) {
      _band.Visibility = Visibility.Collapsed;
      return;
    }

    _band.Width = band.Width;
    _band.Height = band.Height;
    Canvas.SetLeft(_band, band.X);
    Canvas.SetTop(_band, band.Y);
    _band.Visibility = Visibility.Visible;
  }

  /// <summary>Eases the black scrim to <paramref name="opacity"/>.</summary>
  private void Dim(double opacity) {
    Motion.Animate(_dim, UIElement.OpacityProperty, opacity, Motion.StandardDuration, Motion.Standard);
  }

  /// <summary>
  /// Shows the pill attached to <paramref name="selection"/>. It enters with Material's motion only
  /// the first time it appears for a selection; after that it simply follows, so a move or resize
  /// doesn't replay the entrance on every frame - except when it has to switch sides, which springs
  /// it over to the new spot.
  /// </summary>
  private void PlaceBar(Rect selection) {
    var previous = new Point(Canvas.GetLeft(_pill), Canvas.GetTop(_pill));
    (CircleGeometry.BarSide side, Point origin) = Attach(_pill, selection);
    CircleGeometry.BarSide previousSide = _pillSide;
    _pillSide = side;

    if (!_pillShown) {
      _pillShown = true;
      Motion.Enter(_pill, PillRise(side), _pillScaleFrom);
      return;
    }

    if (side != previousSide) {
      Motion.Travel(_pill, origin - previous);  // a jump to another side bounces over
    }
  }

  /// <summary>Shows <paramref name="bar"/> at the spot beside <paramref name="selection"/> that has room.</summary>
  private (CircleGeometry.BarSide Side, Point Origin) Attach(Border bar, Rect selection) {
    bar.Visibility = Visibility.Visible;
    bar.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
    (CircleGeometry.BarSide side, Point origin) =
        CircleGeometry.BarPlacement(selection, bar.DesiredSize, Screen);
    Canvas.SetLeft(bar, origin.X);
    Canvas.SetTop(bar, origin.Y);
    return (side, origin);
  }

  /// <summary>Fades the how-to out the first time drawing starts.</summary>
  private void HideHint() {
    if (!_hintVisible) {
      return;
    }

    _hintVisible = false;
    Motion.Animate(_hint, UIElement.OpacityProperty, 0, Motion.ExitDuration, Motion.Linear);
  }

  /// <summary>
  /// Stacks the still, the tinted scrim with its cutout, the edge glow, the drawing layer (stroke,
  /// flash, brackets), and the hint and search pill on top.
  /// </summary>
  private void Compose(Drawing.Bitmap still) {
    var layer = new Canvas { Children = { _stroke, _flash, _brackets, _words, _picked, _band } };
    // Hosts the pill at an exact spot beside the selection; a Canvas measures it at its own size.
    var pillLayer = new Canvas { Children = { _pill, _textBar } };
    _root.Children.Add(new Image { Source = ToImageSource(still), Stretch = Stretch.Fill });
    _root.Children.Add(Scrim(_tintBrush, 1));
    _root.Children.Add(_dim);
    _root.Children.Add(_edge);
    _root.Children.Add(layer);
    _root.Children.Add(_hint);
    _root.Children.Add(pillLayer);
  }

  /// <summary>
  /// One layer of the scrim: the whole screen with the selection cut out of it (even-odd), so the
  /// selection always stays clear. The black dim and the colour wash share the same shape.
  /// </summary>
  private Shapes.Path Scrim(Brush fill, double opacity) {
    return new Shapes.Path {
      Fill = fill,
      Opacity = opacity,
      IsHitTestVisible = false,
      Data = new GeometryGroup { FillRule = FillRule.EvenOdd, Children = { _screenArea, _cutout } },
    };
  }

  /// <summary>The two passes of the live stroke, both reading the same points.</summary>
  private void BuildStroke() {
    var glow = new Shapes.Polyline {
      Points = _points,
      Stroke = _strokeBrush,
      StrokeThickness = _glowThickness,
      Opacity = _glowOpacity,
      Effect = new BlurEffect { Radius = _glowBlur },
    };
    var core = new Shapes.Polyline { Points = _points, Stroke = Brushes.White, StrokeThickness = _coreThickness };
    _stroke.Children.Add(Rounded(glow));
    _stroke.Children.Add(Rounded(core));
  }

  /// <summary>
  /// The four-colour line around the whole screen, over a blurred copy of itself so it glows
  /// inward; hidden until <see cref="Enter"/> fades it up.
  /// </summary>
  private static Grid Edge() {
    var glow = new Border {
      BorderBrush = _edgeBrush,
      BorderThickness = new Thickness(_edgeGlowThickness),
      Opacity = _edgeGlowOpacity,
      Effect = new BlurEffect { Radius = _edgeGlowBlur },
    };
    var line = new Border { BorderBrush = _edgeBrush, BorderThickness = new Thickness(_edgeThickness) };
    return new Grid { Children = { glow, line }, IsHitTestVisible = false, Opacity = 0 };
  }

  /// <summary>
  /// The selection's four white, rounded corner brackets with a faint halo, scaled by
  /// <paramref name="scale"/> as they land; hidden until there is a selection.
  /// </summary>
  private static Shapes.Path Brackets(ScaleTransform scale) {
    return Rounded(new Shapes.Path {
      Stroke = Brushes.White,
      StrokeThickness = _bracketThickness,
      RenderTransform = scale,
      IsHitTestVisible = false,
      Visibility = Visibility.Collapsed,
      Effect = Shadow(_bracketShadowBlur, _bracketShadowOpacity),
    });
  }

  /// <summary>Round caps and joins, so a stroke reads as a pen line rather than segments.</summary>
  private static TShape Rounded<TShape>(TShape shape) where TShape : Shapes.Shape {
    shape.StrokeStartLineCap = PenLineCap.Round;
    shape.StrokeEndLineCap = PenLineCap.Round;
    shape.StrokeLineJoin = PenLineJoin.Round;
    return shape;
  }

  /// <summary>A soft black shadow cast straight down by <paramref name="depth"/> (0: a halo).</summary>
  private static DropShadowEffect Shadow(double blur, double opacity, double depth = 0) {
    return new DropShadowEffect {
      Color = Colors.Black,
      ShadowDepth = depth,
      Direction = _pillShadowDirection,
      BlurRadius = blur,
      Opacity = opacity,
    };
  }

  /// <summary>
  /// The search bar: a Material 3 surface pill holding "Ask Gemini" (filled, the primary action),
  /// "Google Lens" and "Select text" (tonal), each handing its action to <paramref name="actions"/>.
  /// Hidden until there is a selection to act on; <see cref="PlaceBar"/> then shows it beside the
  /// selection. Also returns "Select text", which is disabled while the text is being read.
  /// </summary>
  private static (Border Pill, Button SelectText) Pill(Actions actions) {
    Button gemini = ActionButton("Ask Gemini", Sparkle(), "Enter", primary: true);
    Button lens = ActionButton("Google Lens", GlyphIcon(Glyphs.Search, _strokeBrush), "L", primary: false);
    Button text = ActionButton("Select text", GlyphIcon(Glyphs.TextSelect), "T", primary: false);
    lens.Margin = new Thickness(_actionGap, 0, 0, 0);
    text.Margin = new Thickness(_actionGap, 0, 0, 0);
    gemini.Click += (_, _) => actions.Finish(CircleAction.AskGemini);
    lens.Click += (_, _) => actions.Finish(CircleAction.Lens);
    text.Click += (_, _) => actions.SelectText();
    return (FloatingBar(gemini, lens, text), text);
  }

  /// <summary>
  /// Text mode's bar, attached to the selection like the action pill: "Copy" (filled; disabled until a word is
  /// selected, and returned for that) and "Done". Hidden until text mode.
  /// </summary>
  private static (Border Bar, Button Copy) TextBar(Actions actions) {
    Button copy = ActionButton("Copy", GlyphIcon(Glyphs.Copy), "Ctrl+C", primary: true);
    Button done = ActionButton("Done", GlyphIcon(Glyphs.Close), "Esc", primary: false);
    done.Margin = new Thickness(_actionGap, 0, 0, 0);
    copy.Click += (_, _) => actions.Copy();
    done.Click += (_, _) => actions.LeaveText();
    return (FloatingBar(copy, done), copy);
  }

  /// <summary>A hidden, floating Material 3 pill around <paramref name="buttons"/>, side by side.</summary>
  private static Border FloatingBar(params Button[] buttons) {
    var row = new StackPanel { Orientation = Orientation.Horizontal };
    foreach (Button button in buttons) {
      row.Children.Add(button);
    }

    var bar = new Border {
      Child = row,
      Padding = new Thickness(_pillPadding),
      Visibility = Visibility.Collapsed,
      Cursor = Cursors.Arrow,
      Effect = Shadow(_pillShadowBlur, _pillShadowOpacity, _pillShadowDepth),
    };
    bar.SetResourceReference(FrameworkElement.StyleProperty, "LivePill");
    bar.SetResourceReference(Border.BackgroundProperty, "LiveMenuSurfaceBrush");
    // A press on the bar's own surface (between buttons) must not start a new loop under it.
    bar.MouseLeftButtonDown += (_, e) => e.Handled = true;
    return bar;
  }

  /// <summary>
  /// A faint, click-through tint over a set of word boxes, in the app's primary colour at
  /// <paramref name="opacity"/>; hidden until text mode has words to show.
  /// </summary>
  private static Shapes.Path TextLayer(double opacity) {
    var layer = new Shapes.Path { Opacity = opacity, IsHitTestVisible = false, Visibility = Visibility.Collapsed };
    layer.SetResourceReference(Shapes.Shape.FillProperty, "LivePrimaryBrush");
    return layer;
  }

  /// <summary>The rubber band a drag from empty space draws, hidden until one starts.</summary>
  private static Shapes.Rectangle Band() {
    var band = new Shapes.Rectangle {
      StrokeThickness = _bandThickness,
      Opacity = _bandOpacity,
      IsHitTestVisible = false,
      Visibility = Visibility.Collapsed,
    };
    band.SetResourceReference(Shapes.Shape.StrokeProperty, "LivePrimaryBrush");
    return band;
  }

  /// <summary>Rounded boxes for <paramref name="boxes"/>, frozen, as one shape to fill.</summary>
  private static GeometryGroup WordGeometry(IEnumerable<Rect> boxes) {
    var group = new GeometryGroup { FillRule = FillRule.Nonzero };
    foreach (Rect box in boxes) {
      group.Children.Add(new RectangleGeometry(box, _wordRadius, _wordRadius));
    }

    group.Freeze();
    return group;
  }

  /// <summary>
  /// One action as a tall, fully rounded Material 3 button: the primary one filled in the app's
  /// accent, the other tonal. The buttons never take focus, so the keys keep reaching the window.
  /// </summary>
  private static Button ActionButton(string label, FrameworkElement icon, string shortcut, bool primary) {
    icon.Margin = new Thickness(0, 0, _actionIconGap, 0);
    icon.VerticalAlignment = VerticalAlignment.Center;
    var content = new StackPanel {
      Orientation = Orientation.Horizontal,
      Children = { icon, new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center } },
    };
    var button = new Button { Content = content, ToolTip = shortcut, Height = _actionHeight };
    button.SetResourceReference(FrameworkElement.StyleProperty, "LiveAccentButton");
    button.SetResourceReference(Control.FontSizeProperty, "BodySize");

    if (!primary) {
      button.SetResourceReference(Control.BackgroundProperty, "LiveControlBrush");
      button.SetResourceReference(Control.ForegroundProperty, "LiveTextBrush");
    }

    return button;
  }

  /// <summary>Gemini's sparkle in Gemini's own gradient, for "Ask Gemini".</summary>
  private static Shapes.Path Sparkle() {
    var sparkle = new Shapes.Path {
      Data = _sparkle,
      Stretch = Stretch.Uniform,
      Width = _actionIconSize,
      Height = _actionIconSize,
    };
    sparkle.SetResourceReference(Shapes.Shape.FillProperty, "LiveGlowBrush");
    return sparkle;
  }

  /// <summary>
  /// An icon-font glyph for a button, in <paramref name="colour"/> when given (Lens's four colours)
  /// and otherwise the button's own text colour.
  /// </summary>
  private static TextBlock GlyphIcon(string glyph, Brush? colour = null) {
    var icon = new TextBlock { Text = glyph, FontSize = _actionIconSize };
    icon.SetResourceReference(FrameworkElement.StyleProperty, "LiveIcon");

    if (colour is not null) {
      icon.Foreground = colour;
    }

    return icon;
  }

  /// <summary>
  /// Which way the pill's entrance travels: up into place below or inside the selection, down into
  /// place above it, and no slide beside it (a vertical rise there would read as drifting).
  /// </summary>
  private static double PillRise(CircleGeometry.BarSide side) {
    return side switch {
      CircleGeometry.BarSide.Below or CircleGeometry.BarSide.Inside => _pillRise,
      CircleGeometry.BarSide.Above => -_pillRise,
      _ => 0,
    };
  }

  /// <summary>The how-to at top centre, an inverse-surface chip, until the first loop starts.</summary>
  private Border Hint(string hintText) {
    _hintLabel.Text = hintText;
    _hintLabel.SetResourceReference(FrameworkElement.StyleProperty, "LiveLabelText");
    _hintLabel.SetResourceReference(TextBlock.ForegroundProperty, "LiveInverseTextBrush");
    var hint = new Border {
      Child = _hintLabel,
      Padding = new Thickness(_hintPaddingX, _hintPaddingY, _hintPaddingX, _hintPaddingY),
      Margin = new Thickness(0, _hintTop, 0, 0),
      HorizontalAlignment = HorizontalAlignment.Center,
      VerticalAlignment = VerticalAlignment.Top,
      IsHitTestVisible = false,
      // It drops in from above, so it scales from its top edge rather than Motion's bottom default.
      RenderTransformOrigin = new Point(0.5, 0),
    };
    hint.SetResourceReference(Border.BackgroundProperty, "LiveInverseSurfaceBrush");
    hint.SetResourceReference(Border.CornerRadiusProperty, "PillRadius");
    return hint;
  }

  /// <summary>
  /// Google's four colours spread evenly from <paramref name="start"/> to <paramref name="end"/>
  /// at <paramref name="alpha"/>, frozen so every overlay can share it.
  /// </summary>
  private static LinearGradientBrush GoogleGradient(Point start, Point end, byte alpha) {
    var brush = new LinearGradientBrush { StartPoint = start, EndPoint = end };
    for (int index = 0; index < _googleColours.Length; index++) {
      Color colour = _googleColours[index];
      double offset = (double)index / (_googleColours.Length - 1);
      brush.GradientStops.Add(new GradientStop(Color.FromArgb(alpha, colour.R, colour.G, colour.B), offset));
    }

    brush.Freeze();
    return brush;
  }

  /// <summary>Parses path markup once, frozen so it can be shared.</summary>
  private static Geometry FrozenGeometry(string markup) {
    Geometry geometry = Geometry.Parse(markup);
    geometry.Freeze();
    return geometry;
  }

  /// <summary>A frozen WPF copy of the still, to show; the bitmap itself stays for cropping.</summary>
  private static BitmapSource ToImageSource(Drawing.Bitmap bitmap) {
    var bounds = new Drawing.Rectangle(0, 0, bitmap.Width, bitmap.Height);
    Drawing.Imaging.BitmapData data = bitmap.LockBits(bounds, Drawing.Imaging.ImageLockMode.ReadOnly,
                                                      Drawing.Imaging.PixelFormat.Format24bppRgb);
    try {
      var source = BitmapSource.Create(bitmap.Width, bitmap.Height, _bitmapDpi, _bitmapDpi,
                                       PixelFormats.Bgr24, null, data.Scan0,
                                       data.Stride * bitmap.Height, data.Stride);
      source.Freeze();
      return source;
    } finally {
      bitmap.UnlockBits(data);
    }
  }
}
