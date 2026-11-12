export const RPG_CAMERA_BASE_ZOOM = 1.29;
export const RPG_CAMERA_MOBILE_ZOOM = RPG_CAMERA_BASE_ZOOM * .65;

export function cameraZoomPercent(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) ? zoom : RPG_CAMERA_BASE_ZOOM;
  return Math.round(safeZoom / RPG_CAMERA_BASE_ZOOM * 100);
}
