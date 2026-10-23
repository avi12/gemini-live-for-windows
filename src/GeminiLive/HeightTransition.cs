using System.Windows;
using System.Windows.Controls;

namespace GeminiLive;

/// <summary>
/// A container whose height glides to its content's height instead of jumping: the one place a
/// size is animated, because the caption card's growth is what the eye follows. It measures its
/// child at full height, reports an animated height to layout, and clips the rest. The window's
/// SizeToContent picks up every intermediate height, and docking keeps the bottom pinned.
/// </summary>
public sealed class HeightTransition : Decorator {
  public static readonly DependencyProperty ShownHeightProperty = DependencyProperty.Register(
      nameof(ShownHeight), typeof(double), typeof(HeightTransition),
      new FrameworkPropertyMetadata(0.0, FrameworkPropertyMetadataOptions.AffectsMeasure));

  public double ShownHeight {
    get => (double)GetValue(ShownHeightProperty);
    set => SetValue(ShownHeightProperty, value);
  }

  private double? _target;  // the content height last animated to; null until shown

  public HeightTransition() {
    ClipToBounds = true;
    // A card that was hidden comes back at its new size; its own entrance covers the change.
    IsVisibleChanged += (_, _) => _target = null;
  }

  protected override Size MeasureOverride(Size constraint) {
    if (Child is null) {
      return default;
    }

    Child.Measure(new Size(constraint.Width, double.PositiveInfinity));
    double target = Child.DesiredSize.Height;
    if (target != _target) {
      double from = _target is null ? target : ShownHeight;
      _target = target;
      Motion.To(this, ShownHeightProperty, target, Motion.StandardDuration, Motion.Standard,
                from: from);
    }

    return new Size(Child.DesiredSize.Width, ShownHeight);
  }

  protected override Size ArrangeOverride(Size arrangeSize) {
    Child?.Arrange(new Rect(0, 0, arrangeSize.Width, Child.DesiredSize.Height));
    return arrangeSize;
  }
}
