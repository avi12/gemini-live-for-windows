using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Windows;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Point = System.Drawing.Point;

namespace GeminiLive;

/// <summary>
/// One word the OCR engine read, with its box in the pixels of the bitmap that was scanned.
/// </summary>
public sealed record OcrWord(string Text, Rect Bounds);

/// <summary>
/// One line of text. Words are in reading order as Windows returns them, so a right-to-left
/// line (Hebrew) lists its words right to left; each word still carries its own box.
/// </summary>
public sealed record OcrLine(IReadOnlyList<OcrWord> Words) {
  /// <summary>The words joined by single spaces, in reading order.</summary>
  public string Text { get; } = string.Join(' ', Words.Select(word => word.Text));
}

/// <summary>
/// Finds where text sits in a screenshot with the built-in Windows OCR, so the UI can let the
/// user pick words straight off a frozen screen without any network call.
/// </summary>
public static class ScreenOcr {
  /// <summary>Keeps tiny crops legible to the engine, which misses text under a few pixels tall.</summary>
  private const int _minEdge = 40;

  /// <summary>
  /// All text lines in <paramref name="region"/> of <paramref name="source"/> (null = the whole
  /// bitmap), top to bottom. Word boxes are in <paramref name="source"/>'s pixels, already offset
  /// by the region. Empty when nothing is found or OCR is unavailable: it never throws. The
  /// caller keeps ownership of <paramref name="source"/>.
  /// </summary>
  public static async Task<IReadOnlyList<OcrLine>> ReadAsync(Bitmap source, Rectangle? region = null) {
    try {
      Rectangle area = Rectangle.Intersect(region ?? new Rectangle(Point.Empty, source.Size),
                                           new Rectangle(Point.Empty, source.Size));
      if (area.Width < 1 || area.Height < 1) {
        return [];
      }

      List<OcrEngine> engines = Engines();
      if (engines.Count == 0) {
        Log.Write("OCR: no recognizer language is installed");
        return [];
      }

      double scale = Math.Min(1.0, (double)OcrEngine.MaxImageDimension / Math.Max(area.Width, area.Height));
      using SoftwareBitmap image = await ToSoftwareBitmapAsync(source, area, scale);
      foreach (OcrEngine engine in engines) {
        OcrResult result = await engine.RecognizeAsync(image);
        if (result.Lines.Count > 0) {
          return Map(result, area.Location, scale);
        }
      }

      return [];
    } catch (Exception error) {
      Log.Write($"OCR failed: {error.Message}");
      return [];
    }
  }

  /// <summary>
  /// The user-profile engine first (their own languages), then one per installed recognizer
  /// language, so a Hebrew or English screen is read whichever the profile lacks.
  /// </summary>
  private static List<OcrEngine> Engines() {
    var engines = new List<OcrEngine>();
    OcrEngine? profile = OcrEngine.TryCreateFromUserProfileLanguages();
    if (profile is not null) {
      engines.Add(profile);
    }

    foreach (Language language in OcrEngine.AvailableRecognizerLanguages) {
      if (profile?.RecognizerLanguage.LanguageTag == language.LanguageTag) {
        continue;
      }

      OcrEngine? engine = OcrEngine.TryCreateFromLanguage(language);
      if (engine is not null) {
        engines.Add(engine);
      }
    }

    return engines;
  }

  /// <summary>
  /// Crops <paramref name="area"/> and scales it by <paramref name="scale"/> into the BGRA
  /// bitmap the engine takes, going through an in-memory BMP so no pixel format surprises.
  /// </summary>
  private static async Task<SoftwareBitmap> ToSoftwareBitmapAsync(Bitmap source, Rectangle area, double scale) {
    int width = Math.Max(_minEdge, (int)Math.Round(area.Width * scale));
    int height = Math.Max(_minEdge, (int)Math.Round(area.Height * scale));
    using var crop = new Bitmap(width, height, PixelFormat.Format32bppArgb);
    using (Graphics graphics = Graphics.FromImage(crop)) {
      graphics.Clear(Color.White);
      graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
      graphics.DrawImage(source, new Rectangle(0, 0, (int)Math.Round(area.Width * scale),
                                               (int)Math.Round(area.Height * scale)),
                         area, GraphicsUnit.Pixel);
    }

    using var memory = new MemoryStream();
    crop.Save(memory, ImageFormat.Bmp);
    memory.Position = 0;
    BitmapDecoder decoder = await BitmapDecoder.CreateAsync(memory.AsRandomAccessStream());
    return await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
  }

  /// <summary>
  /// Moves boxes from the scanned (cropped, scaled) image back into the source bitmap's pixels.
  /// </summary>
  private static List<OcrLine> Map(OcrResult result, Point origin, double scale) {
    return result.Lines
        .Select(line => new OcrLine(line.Words
            .Select(word => new OcrWord(word.Text, new Rect(
                origin.X + (word.BoundingRect.X / scale), origin.Y + (word.BoundingRect.Y / scale),
                word.BoundingRect.Width / scale, word.BoundingRect.Height / scale)))
            .ToList()))
        .OrderBy(line => line.Words.Min(word => word.Bounds.Top))
        .ToList();
  }
}
