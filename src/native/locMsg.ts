// locMsg — the location-share wire format (#204), pure + RN-free (unit-tested).
// Unlike images/voice there is no blob: the coordinates ARE the content, so the
// same string lives on the wire and in the DB. Rendered as clickable coordinates
// (Copy / Open in maps), never as a map image.
//
// Format: loc1:<lat>,<lng>[,<accuracyMeters>]

export const LOC_PREFIX = 'loc1:';

export interface LatLng {
  lat: number;
  lng: number;
  /** Horizontal accuracy in metres, if known. */
  accuracy?: number;
}

export function buildLocation(loc: LatLng): string {
  const acc = loc.accuracy != null ? `,${Math.round(loc.accuracy)}` : '';
  return `${LOC_PREFIX}${loc.lat},${loc.lng}${acc}`;
}

export function parseLocation(s: string): LatLng | null {
  if (!s.startsWith(LOC_PREFIX)) return null;
  const parts = s.slice(LOC_PREFIX.length).split(',');
  if (parts.length < 2) return null;
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const accuracy = parts[2] != null ? parseFloat(parts[2]) : undefined;
  return {
    lat,
    lng,
    accuracy: accuracy != null && Number.isFinite(accuracy) ? accuracy : undefined,
  };
}

export function isLocationContent(s: string): boolean {
  return s.startsWith(LOC_PREFIX);
}

/** A short human label for a bubble / preview, e.g. "37.7749, -122.4194". */
export function formatLatLng(loc: LatLng): string {
  return `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
}

/** geo: URI for an "Open in maps" intent. */
export function geoUri(loc: LatLng): string {
  return `geo:${loc.lat},${loc.lng}?q=${loc.lat},${loc.lng}`;
}
