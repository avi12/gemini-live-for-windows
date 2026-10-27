using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace GeminiLive;

/// <summary>
/// The motion half of the design system: Material 3's durations and easing curves, and the few
/// moves every surface is built from (enter, exit, swap, bounce). Windows' "Animation effects"
/// switch is read here and nowhere else: when it is off, every move lands on its final value at
/// once and durations are zero, so XAML that binds them (x:Static) snaps too.
/// </summary>
public static class Motion {
  private const double _enterMs = 400;
  private const double _exitMs = 260;
  private const double _standardMs = 200;
  private const double _followMs = 90;
  private const double _bounceMs = 100;
  private const double _bounceScale = 0.9;
  private const double _travelMs = 350;
  private const double _springOvershoot = 0.15;

  /// <summary>Gap between items that arrive together (link chips).</summary>
  public static readonly TimeSpan Stagger = TimeSpan.FromMilliseconds(60);

  /// <summary>For things entering: fast start, long gentle settle.</summary>
  public static readonly IEasingFunction EmphasizedDecelerate =
      Frozen(new CubicBezierEase(0.05, 0.7, 0.1, 1));

  /// <summary>For things leaving: slow start, quick finish.</summary>
  public static readonly IEasingFunction EmphasizedAccelerate =
      Frozen(new CubicBezierEase(0.3, 0, 0.8, 0.15));

  /// <summary>For state changes on something that stays.</summary>
  public static readonly IEasingFunction Standard = Frozen(new CubicBezierEase(0.2, 0, 0, 1));

  /// <summary>Even progress, for a fade that must stay visible for its whole run.</summary>
  public static readonly IEasingFunction Linear = Frozen(new CubicBezierEase(0, 0, 1, 1));

  /// <summary>
  /// Material 3 Expressive's spatial spring: overshoots a little and settles, for something that
  /// travels to a new spot.
  /// </summary>
  public static readonly IEasingFunction Spring =
      Frozen(new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = _springOvershoot });

  /// <summary>Windows' "Animation effects" setting; the single reduced-motion switch.</summary>
  public static bool Enabled => SystemParameters.ClientAreaAnimation;

  public static Duration EnterDuration => Scaled(_enterMs);
  public static Duration ExitDuration => Scaled(_exitMs);
  public static Duration StandardDuration => Scaled(_standardMs);
  /// <summary>How quickly the glow follows the voice level.</summary>
  public static Duration FollowDuration => Scaled(_followMs);

  /// <summary>
  /// Animates one double property to <paramref name="to"/>. With motion off it sets the value
  /// and completes immediately.
  /// </summary>
  public static void Animate(DependencyObject target, DependencyProperty property, double to,
                             Duration duration, IEasingFunction easing, double? from = null,
                             TimeSpan delay = default, Action? completed = null) {
    var animatable = (IAnimatable)target;
    if (!Enabled) {
      animatable.BeginAnimation(property, null);
      target.SetValue(property, to);
      completed?.Invoke();
      return;
    }

    var animation = new DoubleAnimation(to, duration) {
      EasingFunction = easing,
      BeginTime = delay,
    };
    if (from is { } start) {
      animation.From = start;
    }

    if (completed is not null) {
      animation.Completed += (_, _) => completed();
    }

    animatable.BeginAnimation(property, animation);
  }

  private const double _menuRise = 8;

  /// <summary>Makes a menu rise into place every time it opens.</summary>
  public static void EnterOnOpen(System.Windows.Controls.ContextMenu menu) {
    menu.Opened += (_, _) => Enter(menu, rise: _menuRise);
  }

  /// <summary>
  /// Material enter: fades in while rising <paramref name="rise"/> px into place and growing from
  /// <paramref name="scaleFrom"/>, after <paramref name="delay"/>.
  /// </summary>
  public static void Enter(UIElement element, double rise, double scaleFrom = 1,
                           TimeSpan delay = default) {
    (ScaleTransform scale, TranslateTransform shift) = Transforms(element);
    bool staggered = delay != default;
    if (!Enabled) {
      element.Opacity = 1;
      shift.Y = 0;
      scale.ScaleX = 1;
      scale.ScaleY = 1;
      return;
    }

    // The resting state is the base value, so a dropped or unticked animation can never leave the
    // element stuck hidden - the pill showing at all depends on this. A staggered item alone
    // starts hidden as its base, so it doesn't flash before its turn; each property then animates
    // in from the entrance offset with From.
    if (staggered) {
      element.Opacity = 0;
      shift.Y = rise;
      scale.ScaleX = scaleFrom;
      scale.ScaleY = scaleFrom;
    } else {
      element.Opacity = 1;
      shift.Y = 0;
      scale.ScaleX = 1;
      scale.ScaleY = 1;
    }

    Animate(element, UIElement.OpacityProperty, 1, EnterDuration, EmphasizedDecelerate, from: 0,
            delay: delay);
    Animate(shift, TranslateTransform.YProperty, 0, EnterDuration, EmphasizedDecelerate, from: rise,
            delay: delay);
    Animate(scale, ScaleTransform.ScaleXProperty, 1, EnterDuration, EmphasizedDecelerate,
            from: scaleFrom, delay: delay);
    Animate(scale, ScaleTransform.ScaleYProperty, 1, EnterDuration, EmphasizedDecelerate,
            from: scaleFrom, delay: delay);
  }

  /// <summary>
  /// The reverse of <see cref="Enter"/>: the pill fades while it sinks back toward the taskbar and
  /// shrinks, then <paramref name="completed"/> hides it. The slide and shrink ride the accelerate
  /// curve (leaving speeds up), but the fade is linear so it's visible the whole way down. Neither
  /// eased curve works for the fade: accelerate holds it opaque then snaps it out, and standard
  /// front-loads it (half gone in ~35ms) - from a pill still fading in, that reads as no exit at all.
  /// </summary>
  public static void Exit(UIElement element, double drop, double scaleTo, Action completed) {
    (ScaleTransform scale, TranslateTransform shift) = Transforms(element);
    Animate(shift, TranslateTransform.YProperty, drop, ExitDuration, EmphasizedAccelerate);
    Animate(scale, ScaleTransform.ScaleXProperty, scaleTo, ExitDuration, EmphasizedAccelerate);
    Animate(scale, ScaleTransform.ScaleYProperty, scaleTo, ExitDuration, EmphasizedAccelerate);
    Animate(element, UIElement.OpacityProperty, 0, ExitDuration, Linear, completed: completed);
  }

  /// <summary>
  /// Crossfades an element through a change: fades out, runs <paramref name="apply"/>, fades back
  /// in. A swap that interrupts another may cancel the earlier fade-out, so
  /// <paramref name="apply"/> should apply the latest state rather than a captured one.
  /// </summary>
  public static void Swap(UIElement element, Action apply) {
    Animate(element, UIElement.OpacityProperty, 0, Scaled(_standardMs / 2), EmphasizedAccelerate,
            completed: () => {
              apply();
              Animate(element, UIElement.OpacityProperty, 1, StandardDuration, Standard);
            });
  }

  /// <summary>A quick press-like squeeze (1 → 0.9 → 1), to acknowledge a toggle.</summary>
  public static void Bounce(UIElement element) {
    if (!Enabled) {
      return;
    }

    (ScaleTransform scale, _) = Transforms(element);
    foreach (DependencyProperty axis in new[] { ScaleTransform.ScaleXProperty,
                                                ScaleTransform.ScaleYProperty }) {
      scale.BeginAnimation(axis, new DoubleAnimation(_bounceScale, Scaled(_bounceMs)) {
        AutoReverse = true,
        EasingFunction = Standard,
      });
    }
  }

  /// <summary>
  /// An element just placed <paramref name="jump"/> away from where it was springs over from its
  /// old spot to the new one. Starting from wherever it is drawn now keeps a travel that interrupts
  /// another one continuous.
  /// </summary>
  public static void Travel(UIElement element, Vector jump) {
    (_, TranslateTransform shift) = Transforms(element);
    Duration duration = Scaled(_travelMs);
    Animate(shift, TranslateTransform.XProperty, 0, duration, Spring, from: shift.X - jump.X);
    Animate(shift, TranslateTransform.YProperty, 0, duration, Spring, from: shift.Y - jump.Y);
  }

  private static Duration Scaled(double milliseconds) {
    return new Duration(TimeSpan.FromMilliseconds(Enabled ? milliseconds : 0));
  }

  /// <summary>
  /// The element's scale + translate pair, created on first use. Elements that don't say
  /// otherwise scale from their bottom centre: everything here rises from the taskbar.
  /// </summary>
  private static (ScaleTransform Scale, TranslateTransform Shift) Transforms(UIElement element) {
    if (element.RenderTransform is TransformGroup {
      Children: [ScaleTransform existingScale, TranslateTransform existingShift]
    }) {
      return (existingScale, existingShift);
    }

    var scale = new ScaleTransform();
    var shift = new TranslateTransform();
    element.RenderTransform = new TransformGroup { Children = { scale, shift } };

    if (element.RenderTransformOrigin == default) {
      element.RenderTransformOrigin = new Point(0.5, 1);
    }

    return (scale, shift);
  }

  private static TEase Frozen<TEase>(TEase ease) where TEase : Freezable {
    ease.Freeze();
    return ease;
  }
}
