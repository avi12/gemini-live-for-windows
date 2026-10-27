using System.Windows;
using System.Windows.Media;
using Drawing = System.Drawing;

namespace GeminiLive;

/// <summary>
/// Circle to Search's pure geometry, in the overlay's DIPs: how a loop becomes a selection, how a
/// corner or the whole selection follows the pointer, the brackets' shape, where the action bar
/// goes, and how the selection maps onto the frozen still's pixels. It holds no WPF element state,
/// so every rule here is a plain function of its inputs (and testable as one);
/// <see cref="CircleOverlay"/> owns the state and <see cref="CircleChrome"/> draws the result.
/// </summary>
internal static class CircleGeometry {
  /// <summary>Where the action bar sits relative to the selection, in the order it is tried.</summary>
  public enum BarSide {
    /// <summary>Centred just under the selection: the natural spot, like Google's own.</summary>
    Below,
    /// <summary>Beside the selection, toward the screen's wider half, when there's no room below.</summary>
    Right,
    /// <summary>The mirror of <see cref="Right"/>, for a selection on the screen's right half.</summary>
    Left,
    /// <summary>Over the selection's top edge, when neither side has room.</summary>
    Above,
    /// <summary>Inside the selection's bottom edge: the selection fills the screen, nowhere else fits.</summary>
    Inside,
  }

  /// <summary>
  /// A grabbed corner: the opposite corner (<see cref="Anchor"/>) stays put, and
  /// <see cref="Direction"/> (±1 per axis) says which way from it the grabbed one lies.
  /// </summary>
  public readonly record struct CornerGrip(Point Anchor, Vector Direction) {
    /// <summary>Grabs <paramref name="corner"/> of <paramref name="selection"/>.</summary>
    public static CornerGrip Grab(Rect selection, Point corner) {
      var anchor = new Point(selection.Left + selection.Right - corner.X,
                             selection.Top + selection.Bottom - corner.Y);
      var direction = new Vector(Math.Sign(corner.X - anchor.X), Math.Sign(corner.Y - anchor.Y));
      return new CornerGrip(anchor, direction);
    }

    /// <summary>
    /// The selection with the grabbed corner at <paramref name="pointer"/>, never past the minimum
    /// size and never off <paramref name="screen"/>.
    /// </summary>
    public Rect Follow(Point pointer, Size screen) {
      double left = Reach(Anchor.X, pointer.X, Direction.X, screen.Width);
      double top = Reach(Anchor.Y, pointer.Y, Direction.Y, screen.Height);
      return new Rect(Anchor, new Point(left, top));
    }
  }

  /// <summary>
  /// One word OCR found, placed in the overlay's DIPs. <see cref="Line"/> is its line's position
  /// from the top, so a run of words can be told apart into lines again when copied.
  /// </summary>
  public readonly record struct TextWord(string Text, Rect Bounds, int Line);

  // A pointer this close to a word still counts as on it, so the gaps in a line don't drop a drag.
  private const double _wordSlop = 3;
  // A loop's bounding box grows by this, so the loop's own line doesn't clip what it circled.
  private const double _selectionPadding = 16;
  // A stroke narrower or shorter than this was a click or a slip, not a circle.
  private const double _minStroke = 10;
  private const double _minSelection = 20;
  // How close to a corner a press grabs it for resizing.
  private const double _cornerReach = 28;
  // The selection's rounded corners: the cutout and the brackets share this radius, so the white
  // brackets hug the clear hole exactly.
  private const double _selectionRadius = 24;
  private const double _bracketArm = 44;
  // The action bar sits this far off the selection, and never closer than the margin to the
  // screen's edge.
  private const double _barGap = 12;
  private const double _barScreenMargin = 16;

  /// <summary>
  /// The selection a finished loop makes: its padded bounding box, kept on
  /// <paramref name="screen"/>; null when the loop was too small to be a circle.
  /// </summary>
  public static Rect? LoopSelection(IEnumerable<Point> loop, Size screen) {
    Rect drawn = Bounds(loop);
    if (drawn.Width < _minStroke || drawn.Height < _minStroke) {
      return null;
    }

    drawn.Inflate(_selectionPadding, _selectionPadding);
    drawn.Intersect(new Rect(screen));
    return drawn;
  }

  /// <summary>
  /// <paramref name="selection"/> dragged so <paramref name="grip"/> (where in it the drag took
  /// hold) sits under <paramref name="pointer"/>, its size unchanged and never past the screen's edge.
  /// </summary>
  public static Rect Moved(Rect selection, Vector grip, Point pointer, Size screen) {
    Point target = pointer - grip;
    double left = Math.Clamp(target.X, 0, Math.Max(0, screen.Width - selection.Width));
    double top = Math.Clamp(target.Y, 0, Math.Max(0, screen.Height - selection.Height));
    return new Rect(new Point(left, top), selection.Size);
  }

  /// <summary>The corner of <paramref name="selection"/> within reach of <paramref name="point"/>, if any.</summary>
  public static Point? NearestCorner(Rect selection, Point point) {
    if (selection.IsEmpty) {
      return null;
    }

    Point[] corners = [selection.TopLeft, selection.TopRight, selection.BottomRight, selection.BottomLeft];
    Point nearest = corners.MinBy(corner => (corner - point).Length);
    return (nearest - point).Length <= _cornerReach ? nearest : null;
  }

  /// <summary>
  /// Whether <paramref name="corner"/> resizes along the falling diagonal (top-left and
  /// bottom-right) rather than the rising one, for the cursor to match.
  /// </summary>
  public static bool IsFallingCorner(Rect selection, Point corner) {
    return corner.X.Equals(selection.Left) == corner.Y.Equals(selection.Top);
  }

  /// <summary>
  /// The corner radius of <paramref name="area"/>'s cutout, flash and brackets, shrunk on a small
  /// one so the arcs never overrun the bracket arms.
  /// </summary>
  public static double CornerRadius(Rect area) {
    return Math.Min(_selectionRadius, BracketArm(area));
  }

  /// <summary>
  /// A rounded L at each corner of <paramref name="area"/>: along one edge, round the corner on the
  /// cutout's own radius, and down the other. Frozen, so it can be handed straight to a path.
  /// </summary>
  public static StreamGeometry Brackets(Rect area) {
    double arm = BracketArm(area);
    double radius = CornerRadius(area);
    (Point Corner, Vector Across, Vector Down)[] corners = [
      (area.TopLeft, new Vector(1, 0), new Vector(0, 1)),
      (area.TopRight, new Vector(-1, 0), new Vector(0, 1)),
      (area.BottomRight, new Vector(-1, 0), new Vector(0, -1)),
      (area.BottomLeft, new Vector(1, 0), new Vector(0, -1)),
    ];
    var geometry = new StreamGeometry();
    using (StreamGeometryContext context = geometry.Open()) {
      foreach ((Point corner, Vector across, Vector down) in corners) {
        // Turning from "across" to "down" bends one way at two corners and the other way at two;
        // the sign of their cross product says which, in screen (y-down) coordinates.
        SweepDirection sweep = Vector.CrossProduct(across, down) > 0
            ? SweepDirection.Counterclockwise
            : SweepDirection.Clockwise;
        context.BeginFigure(corner + across * arm, isFilled: false, isClosed: false);
        context.LineTo(corner + across * radius, isStroked: true, isSmoothJoin: true);
        context.ArcTo(corner + down * radius, new Size(radius, radius), 0, isLargeArc: false, sweep,
                      isStroked: true, isSmoothJoin: true);
        context.LineTo(corner + down * arm, isStroked: true, isSmoothJoin: true);
      }
    }

    geometry.Freeze();
    return geometry;
  }

  /// <summary>
  /// Where a <paramref name="bar"/>-sized action bar goes for <paramref name="selection"/>, as its
  /// top-left corner. Tried in order: centred just below the selection; beside it, vertically
  /// centred - on the right when the selection's centre is in the screen's left half, else on the
  /// left, then the other side; above it; and finally inside its bottom edge. Whatever wins is
  /// clamped fully on screen.
  /// </summary>
  public static (BarSide Side, Point Origin) BarPlacement(Rect selection, Size bar, Size screen) {
    (BarSide side, Point origin) = UnclampedBarPlacement(selection, bar, screen);
    double left = OnScreen(origin.X, bar.Width, screen.Width);
    double top = OnScreen(origin.Y, bar.Height, screen.Height);
    return (side, new Point(left, top));
  }

  /// <summary>
  /// <paramref name="selection"/> in the still's physical pixels, kept inside the still. The window
  /// spans the monitor in DIPs and the still in pixels, so their ratio is the monitor's DPI scale.
  /// </summary>
  public static Drawing.Rectangle PixelRegion(Rect selection, Size window, Drawing.Size still) {
    double scaleX = still.Width / window.Width;
    double scaleY = still.Height / window.Height;
    var region = Drawing.Rectangle.FromLTRB(
        (int)Math.Floor(selection.Left * scaleX), (int)Math.Floor(selection.Top * scaleY),
        (int)Math.Ceiling(selection.Right * scaleX), (int)Math.Ceiling(selection.Bottom * scaleY));
    region.Intersect(new Drawing.Rectangle(Drawing.Point.Empty, still));
    return region;
  }

  /// <summary>
  /// Every word of <paramref name="lines"/> in reading order (line by line), mapped from the
  /// still's pixels to the window's DIPs - the inverse of <see cref="PixelRegion"/>'s scale.
  /// </summary>
  public static TextWord[] TextWords(IReadOnlyList<OcrLine> lines, Drawing.Size still, Size window) {
    double scaleX = window.Width / still.Width;
    double scaleY = window.Height / still.Height;
    return lines
        .SelectMany((line, index) => line.Words.Select(word => new TextWord(
            word.Text,
            new Rect(word.Bounds.X * scaleX, word.Bounds.Y * scaleY,
                     word.Bounds.Width * scaleX, word.Bounds.Height * scaleY),
            index)))
        .ToArray();
  }

  /// <summary>The index of the word under <paramref name="point"/>, or -1 when it is over none.</summary>
  public static int WordAt(IReadOnlyList<TextWord> words, Point point) {
    for (int index = 0; index < words.Count; index++) {
      Rect bounds = words[index].Bounds;
      bounds.Inflate(_wordSlop, _wordSlop);

      if (bounds.Contains(point)) {
        return index;
      }
    }

    return -1;
  }

  /// <summary>
  /// The words from <paramref name="first"/> to <paramref name="second"/> inclusive, whichever
  /// comes first in reading order: what dragging from one word to another selects.
  /// </summary>
  public static int[] WordsBetween(int first, int second) {
    int start = Math.Min(first, second);
    return Enumerable.Range(start, Math.Abs(second - first) + 1).ToArray();
  }

  /// <summary>Every word touching <paramref name="area"/>: what a rubber band selects.</summary>
  public static int[] WordsIn(IReadOnlyList<TextWord> words, Rect area) {
    return Enumerable.Range(0, words.Count).Where(index => words[index].Bounds.IntersectsWith(area)).ToArray();
  }

  /// <summary>All the words on the same line as the word at <paramref name="index"/>.</summary>
  public static int[] WordsOnLine(IReadOnlyList<TextWord> words, int index) {
    int line = words[index].Line;
    return Enumerable.Range(0, words.Count).Where(other => words[other].Line == line).ToArray();
  }

  /// <summary>
  /// The words at <paramref name="picked"/> as text: spaces between words, a newline wherever the
  /// line changes. The words are already in reading order, right-to-left lines included.
  /// </summary>
  public static string Join(IReadOnlyList<TextWord> words, IEnumerable<int> picked) {
    return string.Join('\n', picked
        .GroupBy(index => words[index].Line)
        .Select(line => string.Join(' ', line.Select(index => words[index].Text))));
  }

  /// <summary>The first spot <see cref="BarPlacement"/> tries that has room, before clamping.</summary>
  private static (BarSide Side, Point Origin) UnclampedBarPlacement(Rect selection, Size bar, Size screen) {
    double centredX = selection.Left + (selection.Width - bar.Width) / 2;
    double centredY = selection.Top + (selection.Height - bar.Height) / 2;
    double belowY = selection.Bottom + _barGap;
    if (belowY + bar.Height <= screen.Height - _barScreenMargin) {
      return (BarSide.Below, new Point(centredX, belowY));
    }

    double rightX = selection.Right + _barGap;
    double leftX = selection.Left - _barGap - bar.Width;
    bool rightFits = rightX + bar.Width <= screen.Width - _barScreenMargin;
    bool leftFits = leftX >= _barScreenMargin;
    bool preferRight = selection.Left + selection.Width / 2 < screen.Width / 2;
    if (rightFits && (preferRight || !leftFits)) {
      return (BarSide.Right, new Point(rightX, centredY));
    }

    if (leftFits) {
      return (BarSide.Left, new Point(leftX, centredY));
    }

    double aboveY = selection.Top - _barGap - bar.Height;
    if (aboveY >= _barScreenMargin) {
      return (BarSide.Above, new Point(centredX, aboveY));
    }

    return (BarSide.Inside, new Point(centredX, selection.Bottom - _barGap - bar.Height));
  }

  /// <summary>
  /// Keeps a span of <paramref name="length"/> starting at <paramref name="start"/> inside the
  /// screen's margin on one axis; one too long to fit hugs the near margin.
  /// </summary>
  private static double OnScreen(double start, double length, double limit) {
    double farthest = limit - _barScreenMargin - length;
    return Math.Max(_barScreenMargin, Math.Min(start, farthest));
  }

  /// <summary>
  /// Where the grabbed edge lands on one axis: at least the minimum size away from the anchor on
  /// its own side, and on screen.
  /// </summary>
  private static double Reach(double anchor, double pointer, double direction, double limit) {
    double extent = Math.Max(_minSelection, (pointer - anchor) * direction);
    return Math.Clamp(anchor + extent * direction, 0, limit);
  }

  /// <summary>How long each bracket arm runs along an edge, shortened on a small selection.</summary>
  private static double BracketArm(Rect area) {
    return Math.Min(_bracketArm, Math.Min(area.Width, area.Height) / 2);
  }

  /// <summary>The smallest rectangle holding every point.</summary>
  private static Rect Bounds(IEnumerable<Point> points) {
    Rect bounds = Rect.Empty;
    foreach (Point point in points) {
      bounds.Union(point);
    }

    return bounds;
  }
}
