// The numbers behind Windows' enums, so the pick is pure and tested without a camera. A color source on
// the preview or record stream is a webcam picture; infrared, depth and photo streams are not.
export const SOURCE_KIND_COLOR = 1;
export const STREAM_VIDEO_PREVIEW = 0;
export const STREAM_VIDEO_RECORD = 1;

export interface CameraSourceInfo {
  readonly id: string;
  readonly sourceKind: number;
  readonly mediaStreamType: number;
}

export interface CameraGroupInfo {
  readonly id: string;
  readonly name: string;
  readonly sources: readonly CameraSourceInfo[];
}

function isColorVideo(source: CameraSourceInfo) {
  const isColor = source.sourceKind === SOURCE_KIND_COLOR;
  const isVideo = source.mediaStreamType === STREAM_VIDEO_PREVIEW || source.mediaStreamType === STREAM_VIDEO_RECORD;
  return isColor && isVideo;
}

// The webcams: groups that have a color video source, named as Windows names them
export function listCameraEntries(groups: readonly CameraGroupInfo[]) {
  return groups
    .filter(group => group.sources.some(isColorVideo))
    .map(group => ({
      id: group.id,
      name: group.name
    }));
}

// The group asked for by id, else the first webcam; and its first color video source
export function pickColorCamera({ groups, cameraId }: {
  groups: readonly CameraGroupInfo[];
  cameraId: string | undefined;
}) {
  const candidates = groups.filter(group => group.sources.some(isColorVideo));
  const group = candidates.find(candidate => candidate.id === cameraId) ?? candidates[0];
  const source = group?.sources.find(isColorVideo);
  const isGroupMissingOrSourceMissing = group === undefined || source === undefined;
  if (isGroupMissingOrSourceMissing) {
    return undefined;
  }

  return {
    groupId: group.id,
    sourceId: source.id
  };
}
