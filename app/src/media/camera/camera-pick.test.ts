import {
  listCameraEntries,
  pickColorCamera,
  SOURCE_KIND_COLOR,
  STREAM_VIDEO_PREVIEW,
  STREAM_VIDEO_RECORD
} from "./camera-pick.ts";
import type { CameraGroupInfo } from "./camera-pick.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const INFRARED = 2;
const PHOTO = 3;

const IR_ONLY: CameraGroupInfo = {
  id: "ir",
  name: "IR camera",
  sources: [{
    id: "ir-1",
    sourceKind: INFRARED,
    mediaStreamType: STREAM_VIDEO_PREVIEW
  }]
};
const WEBCAM: CameraGroupInfo = {
  id: "cam-a",
  name: "Integrated Webcam",
  sources: [
    {
      id: "photo",
      sourceKind: SOURCE_KIND_COLOR,
      mediaStreamType: PHOTO
    },
    {
      id: "preview",
      sourceKind: SOURCE_KIND_COLOR,
      mediaStreamType: STREAM_VIDEO_PREVIEW
    }
  ]
};
const USB: CameraGroupInfo = {
  id: "cam-b",
  name: "USB Camera",
  sources: [{
    id: "record",
    sourceKind: SOURCE_KIND_COLOR,
    mediaStreamType: STREAM_VIDEO_RECORD
  }]
};

describe("camera list", () => {
  it("lists only groups with a color video source, by Windows' name", () => {
    assert.deepEqual(listCameraEntries([IR_ONLY, WEBCAM, USB]), [
      {
        id: "cam-a",
        name: "Integrated Webcam"
      },
      {
        id: "cam-b",
        name: "USB Camera"
      }
    ]);
  });

  it("is empty with no camera", () => {
    assert.deepEqual(listCameraEntries([]), []);
    assert.deepEqual(listCameraEntries([IR_ONLY]), []);
  });
});

describe("camera pick", () => {
  it("takes the first webcam and its color video source, skipping a photo stream", () => {
    assert.deepEqual(
      pickColorCamera({
        groups: [IR_ONLY, WEBCAM, USB],
        cameraId: undefined
      }), {
        groupId: "cam-a",
        sourceId: "preview"
      }
    );
  });

  it("takes the camera asked for", () => {
    assert.deepEqual(
      pickColorCamera({
        groups: [WEBCAM, USB],
        cameraId: "cam-b"
      }), {
        groupId: "cam-b",
        sourceId: "record"
      }
    );
  });

  it("falls back to the first webcam when the one asked for is gone", () => {
    assert.equal(
      pickColorCamera({
        groups: [WEBCAM, USB],
        cameraId: "unplugged"
      })?.groupId, "cam-a"
    );
  });

  it("is undefined when there is no webcam", () => {
    assert.equal(
      pickColorCamera({
        groups: [IR_ONLY],
        cameraId: undefined
      }), undefined
    );
    assert.equal(
      pickColorCamera({
        groups: [],
        cameraId: undefined
      }), undefined
    );
  });
});
