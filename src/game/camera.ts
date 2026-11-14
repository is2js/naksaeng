export const RPG_CAMERA_BASE_ZOOM = 1.29;
export const RPG_CAMERA_MOBILE_ZOOM = RPG_CAMERA_BASE_ZOOM * .65;
export const RPG_CAMERA_MOBILE_MEDIA_QUERY = '(pointer: coarse), (max-width: 760px)';
export const RPG_CAMERA_MOBILE_MIN_ZOOM = RPG_CAMERA_BASE_ZOOM * .4;
export const RPG_CAMERA_DESKTOP_MIN_ZOOM = RPG_CAMERA_BASE_ZOOM * .65;
export const RPG_CAMERA_MAX_ZOOM = RPG_CAMERA_BASE_ZOOM * 2.8;

/** Initial/reset zoom and the allowed zoom range are intentionally separate. */
export function clampCameraZoom(zoom: number, mobile: boolean): number {
  const safeZoom = Number.isFinite(zoom) ? zoom : RPG_CAMERA_BASE_ZOOM;
  return Math.max(mobile ? RPG_CAMERA_MOBILE_MIN_ZOOM : RPG_CAMERA_DESKTOP_MIN_ZOOM,
    Math.min(RPG_CAMERA_MAX_ZOOM, safeZoom));
}

export function cameraZoomAfterWheel(currentZoom: number, wheelDelta: number, mobile: boolean): number {
  const current = clampCameraZoom(currentZoom, mobile);
  const delta = Number.isFinite(wheelDelta) ? wheelDelta : 0;
  // Keep the candidate finite even for a very large input delta, then apply the
  // same limits as reset/buttons. Invalid wheel input is simply ignored.
  const exponent = Math.max(-50, Math.min(50, -delta * .0014));
  return clampCameraZoom(current * Math.exp(exponent), mobile);
}

export function cameraZoomPercent(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) ? zoom : RPG_CAMERA_BASE_ZOOM;
  return Math.round(safeZoom / RPG_CAMERA_BASE_ZOOM * 100);
}
