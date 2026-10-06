using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace GeminiLive;

/// <summary>
/// The share menu's entries: a live thumbnail of every display plus its name, so you can tell
/// which is which, with the one Gemini sees outlined and checked. The thumbnails keep refreshing
/// while the menu is open, so each preview is live rather than a frozen still.
/// </summary>
public static class DisplayPicker {
  private const int _previewWidth = 176;
  private const double _selectedOutline = 2;
  private static readonly TimeSpan _refresh = TimeSpan.FromMilliseconds(500);

  /// <summary>Fills the menu with the display previews and keeps them live while it is open.</summary>
  public static void Fill(ContextMenu menu, IReadOnlyList<MonitorInfo> displays, MonitorInfo? shared,
                          Action<MonitorInfo> onPick) {
    var feeds = new List<(MonitorInfo Display, ImageBrush Brush)>();
    foreach (MonitorInfo display in displays) {
      bool selected = display.IsSameDisplay(shared);
      var brush = new ImageBrush { Stretch = Stretch.UniformToFill };
      Refresh(brush, display);  // a first frame so the menu never opens empty
      var item = new MenuItem {
        Header = PreviewOf(display, selected, brush),
        IsCheckable = true,
        IsChecked = selected,
        ToolTip = display.Description,
      };
      item.Click += (_, _) => onPick(display);
      menu.Items.Add(item);
      feeds.Add((display, brush));
    }

    // Tie the refresh to the menu's own lifetime: grab new frames only while it is on screen.
    var timer = new DispatcherTimer { Interval = _refresh };
    timer.Tick += (_, _) => {
      foreach ((MonitorInfo display, ImageBrush brush) in feeds) {
        RefreshAsync(brush, display);
      }
    };
    menu.Opened += (_, _) => timer.Start();
    menu.Closed += (_, _) => timer.Stop();
  }

  private static FrameworkElement PreviewOf(MonitorInfo display, bool selected, ImageBrush live) {
    var panel = new StackPanel { Margin = new Thickness(0, 4, 0, 4) };
    // A border only clips its background (not a child image) to its corners, so the live feed is
    // the border's background. Sized by the display's own aspect, independent of the frame.
    var thumbnail = new Border {
      Width = _previewWidth,
      Height = _previewWidth * display.Height / (double)display.Width,
      Background = live,
      BorderThickness = new Thickness(selected ? _selectedOutline : 0),
    };
    thumbnail.SetResourceReference(Border.CornerRadiusProperty, "SmallRadius");
    thumbnail.SetResourceReference(Border.BorderBrushProperty, "LivePrimaryBrush");
    panel.Children.Add(thumbnail);

    var name = new TextBlock { Text = display.Description, Margin = new Thickness(0, 4, 0, 0) };
    name.SetResourceReference(FrameworkElement.StyleProperty, "LiveCaptionText");
    panel.Children.Add(name);
    return panel;
  }

  /// <summary>Grabs a frame off the UI thread and swaps it into the brush when it lands.</summary>
  private static void RefreshAsync(ImageBrush brush, MonitorInfo display) {
    Task.Run(() => Grab(display)).ContinueWith(
        task => {
          if (task.Result is { } image) {
            brush.ImageSource = image;
          }
        },
        TaskScheduler.FromCurrentSynchronizationContext());
  }

  private static void Refresh(ImageBrush brush, MonitorInfo display) {
    if (Grab(display) is { } image) {
      brush.ImageSource = image;
    }
  }

  /// <summary>One downscaled, frozen still of the display, or null when it can't be captured.</summary>
  private static BitmapImage? Grab(MonitorInfo display) {
    try {
      ScreenGrabber.Frame frame = ScreenGrabber.Grab(display);
      var image = new BitmapImage();
      image.BeginInit();
      image.StreamSource = new MemoryStream(frame.Jpeg);
      image.DecodePixelWidth = _previewWidth;
      image.CacheOption = BitmapCacheOption.OnLoad;
      image.EndInit();
      image.Freeze();
      return image;
    } catch (Exception e) {
      Log.Write($"preview of {display.DeviceName} failed: {e.Message}");
      return null;
    }
  }
}
