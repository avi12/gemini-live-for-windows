using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace GeminiLive;

/// <summary>
/// Gemini's glow under the pill, the way Android's Live draws it: the gradient's colours drift
/// slowly side to side, and its strength follows the conversation. It breathes while Gemini's
/// page owns the audio, follows voice levels otherwise; Gemini speaking reads brighter and drifts
/// faster than the user speaking. With motion off it holds still at a steady strength.
/// </summary>
public sealed class GlowAnimator {
  private const double _restOpacity = 0.35;
  private const double _steadyOpacity = 0.75;
  private const double _breatheLow = 0.5;
  private const double _breatheHigh = 1;
  private const double _levelFloor = 0.45;
  private const double _geminiGain = 0.55;
  private const double _userGain = 0.35;  // calmer while the user talks
  private const float _quietLevel = 0.02f;
  private const double _driftReach = 0.3;  // of the brush's width, each way
  private const double _speakingDriftSpeed = 2.5;
  private static readonly Duration _breatheHalfPeriod = TimeSpan.FromMilliseconds(1400);
  private static readonly Duration _driftHalfPeriod = TimeSpan.FromSeconds(3);

  private readonly Border _glow;
  private readonly AnimationClock? _drift;

  private bool _geminiSpeaking;

  /// <param name="glow">The blurred border whose background is the glow.</param>
  public GlowAnimator(Border glow) {
    _glow = glow;
    // A private copy of the theme's glow: the shared resource is frozen, and drifting needs a
    // live transform. Its colours don't change with the theme, so copying once is enough.
    var brush = ((LinearGradientBrush)glow.FindResource("LiveGlowBrush")).Clone();
    brush.SpreadMethod = GradientSpreadMethod.Reflect;
    var shift = new TranslateTransform();
    brush.RelativeTransform = shift;
    glow.Background = brush;

    if (!Motion.Enabled) {
      return;
    }

    var drift = new DoubleAnimation(-_driftReach, _driftReach, _driftHalfPeriod) {
      AutoReverse = true,
      RepeatBehavior = RepeatBehavior.Forever,
      EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
    };
    _drift = drift.CreateClock();
    shift.ApplyAnimationClock(TranslateTransform.XProperty, _drift);
    _drift.Controller!.Pause();
  }

  /// <summary>Gemini's page owns the audio, so there are no levels: breathe instead.</summary>
  public void Breathe() {
    Wake();

    if (!Motion.Enabled) {
      Motion.To(_glow, UIElement.OpacityProperty, _steadyOpacity, Motion.StandardDuration,
                Motion.Standard);
      return;
    }

    _glow.BeginAnimation(UIElement.OpacityProperty,
                         new DoubleAnimation(_breatheLow, _breatheHigh, _breatheHalfPeriod) {
                           AutoReverse = true,
                           RepeatBehavior = RepeatBehavior.Forever,
                           EasingFunction = new SineEase(),
                         });
  }

  /// <summary>Follows a voice peak (0..1) from either side of the conversation.</summary>
  public void Follow(float level, bool isUser) {
    Wake();

    if (!isUser) {
      SetGeminiSpeaking(level >= _quietLevel);
    }

    if (isUser && level < _quietLevel) {
      return;  // let Gemini's voice own the glow while the user is quiet
    }

    double gain = isUser ? _userGain : _geminiGain;
    double target = _levelFloor + Math.Min(1, level * 3) * gain;
    Motion.To(_glow, UIElement.OpacityProperty, target, Motion.FollowDuration, Motion.Standard);
  }

  /// <summary>The session ended: dim, and stop drifting.</summary>
  public void Rest() {
    SetGeminiSpeaking(false);
    _drift?.Controller!.Pause();
    Motion.To(_glow, UIElement.OpacityProperty, _restOpacity, Motion.StandardDuration,
              Motion.Standard);
  }

  private void Wake() {
    _drift?.Controller!.Resume();
  }

  private void SetGeminiSpeaking(bool speaking) {
    if (speaking == _geminiSpeaking) {
      return;
    }

    _geminiSpeaking = speaking;

    if (_drift is not null) {
      _drift.Controller!.SpeedRatio = speaking ? _speakingDriftSpeed : 1;
    }
  }
}
