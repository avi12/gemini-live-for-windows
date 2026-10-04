using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace GeminiLive;

/// <summary>One JPEG still of a monitor, downscaled. Every screen frame Gemini sees comes from here.</summary>
public static class ScreenGrabber
{
    public const int MaxEdge = 1280;
    const long JpegQuality = 70;
    public const string MimeType = "image/jpeg";

    static readonly ImageCodecInfo Jpeg = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);

    public sealed record Frame(byte[] Jpeg, int Width, int Height);

    public static Frame Grab(MonitorInfo m)
    {
        using var full = new Bitmap(m.Width, m.Height, PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(full))
            g.CopyFromScreen(m.X, m.Y, 0, 0, new Size(m.Width, m.Height), CopyPixelOperation.SourceCopy);

        var scale = Math.Min(1.0, (double)MaxEdge / Math.Max(m.Width, m.Height));
        using var small = new Bitmap((int)(m.Width * scale), (int)(m.Height * scale), PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(small))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBilinear;
            g.DrawImage(full, 0, 0, small.Width, small.Height);
        }

        using var ms = new MemoryStream();
        using var p = new EncoderParameters(1);
        p.Param[0] = new EncoderParameter(Encoder.Quality, JpegQuality);
        small.Save(ms, Jpeg, p);
        return new Frame(ms.ToArray(), small.Width, small.Height);
    }
}
