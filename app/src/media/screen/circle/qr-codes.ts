import { installImageCodecs } from "winui-svelte/web-apis/images";
import { BarcodeDetector } from "winui-svelte/web-apis/shape-detection";

const QR_FORMAT = "qr_code";
const JPEG_MIME_TYPE = "image/jpeg";

// The decoded text of each QR code in a JPEG, in the library's pure TypeScript reader. The image
// codecs it decodes with are installed here, once, on first use
export async function readQrTexts(jpeg: Uint8Array) {
  installImageCodecs();
  const detector = new BarcodeDetector({ formats: [QR_FORMAT] });
  const codes = await detector.detect(new Blob([jpeg.slice()], { type: JPEG_MIME_TYPE }));
  return codes.map(code => code.rawValue);
}
