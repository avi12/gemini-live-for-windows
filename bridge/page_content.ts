// Encodes the screen's text as Chromium's AnnotatedPageContent protobuf, the form Gemini in Chrome
// reads a page's text in (schema: Chromium's common_quality_data.proto). Glic asks its host for it
// alongside each screenshot, so Gemini gets exact words where the picture is a blur.
// Ported from interview-prep's apps/gemini-live/src/lib/page-content.ts.

/** A block of the screen's text (ScreenText.BlockKind on the C# side). */
export enum BlockKind {
  Heading = 'heading',
  Paragraph = 'paragraph',
}

export interface Block {
  kind: BlockKind;
  text: string;
}

enum WireType {
  Varint = 0,
  Bytes = 2,
}

enum ContentAttributeType {
  Root = 1,
  Paragraph = 4,
  Heading = 5,
  Text = 20,
}

enum AnnotatedPageContentField {
  Version = 1,
  RootNode = 2,
  MainFrameData = 3,
}
enum ContentNodeField {
  Children = 1,
  Attributes = 2,
}
enum ContentAttributesField {
  DomNodeId = 2,
  Type = 3,
  TextData = 10,
}
enum TextInfoField {
  TextContent = 1,
}
enum FrameDataField {
  Url = 4,
  Title = 5,
}

const APC_VERSION_1_0 = 1;
const VARINT_CONTINUE = 0x80;
const VARINT_LOW_BITS = 0x7f;
const TAG_WIRE_TYPE_BITS = 3;

const BLOCK_TYPE: Record<BlockKind, ContentAttributeType> = {
  [BlockKind.Heading]: ContentAttributeType.Heading,
  [BlockKind.Paragraph]: ContentAttributeType.Paragraph,
};

const encoder = new TextEncoder();

const varint = (value: number): number[] => {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= VARINT_CONTINUE) {
    bytes.push((rest & VARINT_LOW_BITS) | VARINT_CONTINUE);
    rest = Math.floor(rest / VARINT_CONTINUE);
  }
  bytes.push(rest);
  return bytes;
};

const tag = (field: number, wireType: WireType): number[] => varint((field << TAG_WIRE_TYPE_BITS) | wireType);

const varintField = (field: number, value: number): number[] => [...tag(field, WireType.Varint), ...varint(value)];

const bytesField = (field: number, bytes: ArrayLike<number>): number[] => [
  ...tag(field, WireType.Bytes),
  ...varint(bytes.length),
  ...Array.from(bytes),
];

const stringField = (field: number, text: string): number[] => bytesField(field, encoder.encode(text));

const contentNode = (type: ContentAttributeType, id: number, text?: string, children: number[][] = []): number[] => {
  const attributes = [
    ...varintField(ContentAttributesField.DomNodeId, id),
    ...varintField(ContentAttributesField.Type, type),
    ...(text === undefined
      ? []
      : bytesField(ContentAttributesField.TextData, stringField(TextInfoField.TextContent, text))),
  ];
  return [
    ...children.flatMap((child) => bytesField(ContentNodeField.Children, child)),
    ...bytesField(ContentNodeField.Attributes, attributes),
  ];
};

/** The page content of a screen whose window is titled `title`: a root holding one node per block. */
export const annotatedPageContent = (title: string, url: string, blocks: Block[]): Uint8Array => {
  let nextId = 1;
  const children = blocks.map(({ kind, text }) => {
    const blockId = ++nextId;
    const textNode = contentNode(ContentAttributeType.Text, ++nextId, text);
    return contentNode(BLOCK_TYPE[kind], blockId, undefined, [textNode]);
  });
  const root = contentNode(ContentAttributeType.Root, 1, undefined, children);
  const frame = [...stringField(FrameDataField.Url, url), ...stringField(FrameDataField.Title, title)];
  return new Uint8Array([
    ...varintField(AnnotatedPageContentField.Version, APC_VERSION_1_0),
    ...bytesField(AnnotatedPageContentField.RootNode, root),
    ...bytesField(AnnotatedPageContentField.MainFrameData, frame),
  ]);
};

/** Glic reads the page content as a stream. */
export const byteStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
