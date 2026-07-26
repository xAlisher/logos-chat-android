// JS wrapper over the native LocationProvider module. Fetches a single current
// location using the *platform* LocationManager (no Google Play Services), so the
// UI can attach a coordinate to a chat message. The native side resolves a
// stringified JSON {lat,lng,accuracy}; parseLocation turns it into an object.
import {NativeModules} from 'react-native';

export interface FixLocation {
  /** Latitude in decimal degrees. */
  lat: number;
  /** Longitude in decimal degrees. */
  lng: number;
  /** Horizontal accuracy radius in meters. */
  accuracy: number;
}

interface LocationNative {
  /**
   * Fetch a single current location. Resolves a stringified {@link FixLocation}.
   * Rejects with code "permission" (no location permission granted), "unavailable"
   * (no provider), or "timeout" (no fix within ~15s).
   */
  getCurrent(): Promise<string>;
}

const native: LocationNative = NativeModules.LocationProvider;

/** Parse the JSON getCurrent resolves with. Returns null on malformed input. */
export function parseLocation(json: string | null): FixLocation | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    if (
      typeof o?.lat === 'number' &&
      typeof o?.lng === 'number' &&
      typeof o?.accuracy === 'number'
    ) {
      return {lat: o.lat, lng: o.lng, accuracy: o.accuracy};
    }
  } catch {
    // fall through
  }
  return null;
}

export default native;
