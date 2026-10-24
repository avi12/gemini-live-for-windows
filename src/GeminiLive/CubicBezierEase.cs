using System.Windows;
using System.Windows.Media.Animation;

namespace GeminiLive;

/// <summary>
/// CSS-style cubic-bezier(x1, y1, x2, y2) easing, which WPF lacks. Material 3 defines its motion
/// curves this way, so this is how <see cref="Motion"/> spells them.
/// </summary>
public sealed class CubicBezierEase : EasingFunctionBase {
  private const int _newtonSteps = 8;
  private const int _bisectSteps = 30;
  private const double _epsilon = 1e-6;

  private readonly double _x1;
  private readonly double _y1;
  private readonly double _x2;
  private readonly double _y2;

  /// <summary>The curve through control points (firstX, firstY) and (secondX, secondY).</summary>
  public CubicBezierEase(double firstX, double firstY, double secondX, double secondY) {
    _x1 = firstX;
    _y1 = firstY;
    _x2 = secondX;
    _y2 = secondY;
    // EaseInCore is the curve exactly as written; the default (EaseOut) would mirror it.
    EasingMode = EasingMode.EaseIn;
  }

  protected override double EaseInCore(double normalizedTime) {
    if (normalizedTime <= 0) {
      return 0;
    }

    if (normalizedTime >= 1) {
      return 1;
    }

    return Bezier(ParameterAt(normalizedTime), _y1, _y2);
  }

  protected override Freezable CreateInstanceCore() {
    return new CubicBezierEase(_x1, _y1, _x2, _y2);
  }

  /// <summary>One coordinate of the curve, with end points fixed at 0 and 1.</summary>
  private static double Bezier(double t, double first, double second) {
    double rest = 1 - t;
    return 3 * rest * rest * t * first + 3 * rest * t * t * second + t * t * t;
  }

  private static double Slope(double t, double first, double second) {
    double rest = 1 - t;
    return 3 * rest * rest * first + 6 * rest * t * (second - first) + 3 * t * t * (1 - second);
  }

  /// <summary>The curve parameter whose x is <paramref name="x"/>.</summary>
  private double ParameterAt(double x) {
    double t = x;
    for (int i = 0; i < _newtonSteps; i++) {
      double error = Bezier(t, _x1, _x2) - x;
      if (Math.Abs(error) < _epsilon) {
        return t;
      }

      double slope = Slope(t, _x1, _x2);
      if (Math.Abs(slope) < _epsilon) {
        break;
      }

      t = Math.Clamp(t - error / slope, 0, 1);
    }

    // Newton stalled on a flat stretch: bisect, which always converges since x(t) is monotonic.
    double low = 0;
    double high = 1;
    t = x;
    for (int i = 0; i < _bisectSteps; i++) {
      double error = Bezier(t, _x1, _x2) - x;
      if (Math.Abs(error) < _epsilon) {
        break;
      }

      if (error > 0) {
        high = t;
      } else {
        low = t;
      }

      t = (low + high) / 2;
    }
    return t;
  }
}
