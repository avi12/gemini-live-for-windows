import type { CropFrame } from "@/overlays/ports.ts";

// Lens' direct upload. Query: ep=gsbubb is the entry point (results come back tagged
// source=lns.web.gsbubb), re=df the result mode, stcs the client clock in Unix ms, vpw and vph the
// viewport (the page adds those). Verified 2026-10-26 with curl and headless Chrome: a 303 to
// www.google.com/search?vsrid=...&udm=26.
export const LENS_UPLOAD_URL = "https://lens.google.com/v3/upload?re=df&ep=gsbubb";

// The multipart field Lens reads the picture from (verified as above)
export const LENS_IMAGE_FIELD = "encoded_image";

// Optional multipart field, "width,height" of the picture; Lens echoes it as vsdim
export const LENS_DIMENSIONS_FIELD = "processed_image_dimensions";

export const LENS_IMAGE_MIME_TYPE = "image/jpeg";

// A page that rebuilds the JPEG as a file input and submits it to Lens on load. A top-level form
// post needs no CORS, and the 303 it gets lands the tab on the results. The browser itself has to
// make the upload: Lens binds the results to the cookies of whoever uploaded
export function lensUploadPage({ crop, sentAtMs }: {
  crop: CropFrame;
  sentAtMs: number;
}) {
  const jpeg = Buffer.from(crop.jpeg).toString("base64");
  return [
    "<!doctype html>",
    "<meta charset=\"utf-8\">",
    "<title>Google Lens</title>",
    `<form id="lens" method="post" enctype="multipart/form-data" action="${LENS_UPLOAD_URL}&stcs=${sentAtMs}">`,
    `  <input type="file" name="${LENS_IMAGE_FIELD}" id="image" hidden>`,
    `  <input type="hidden" name="${LENS_DIMENSIONS_FIELD}" value="${crop.width},${crop.height}">`,
    "</form>",
    "<p>Sending the picture to Google Lens...</p>",
    "<script>",
    `  const bytes = Uint8Array.from(atob("${jpeg}"), (glyph) => glyph.charCodeAt(0));`,
    "  const files = new DataTransfer();",
    `  files.items.add(new File([bytes], "image.jpg", { type: "${LENS_IMAGE_MIME_TYPE}" }));`,
    "  document.getElementById(\"image\").files = files.files;",
    "  const form = document.getElementById(\"lens\");",
    "  form.action += `&vpw=${innerWidth}&vph=${innerHeight}`;",
    "  form.submit();",
    "</script>",
    ""
  ].join("\n");
}
