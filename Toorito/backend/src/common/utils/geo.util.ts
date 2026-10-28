/** A WGS-84 coordinate in decimal degrees. */
export interface LatLng {
    lat: number;
    lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Metres covered by one degree of latitude. */
const METRES_PER_DEGREE_LAT = 111_320;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
export function haversineM(from: LatLng, to: LatLng): number {
    const deltaLat = toRadians(to.lat - from.lat);
    const deltaLng = toRadians(to.lng - from.lng);

    const haversine =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(toRadians(from.lat)) *
            Math.cos(toRadians(to.lat)) *
            Math.sin(deltaLng / 2) ** 2;

    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(haversine));
}

/** Ray-casting point-in-polygon test (polygon is a list of vertices). */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const { lng: xi, lat: yi } = polygon[i];
        const { lng: xj, lat: yj } = polygon[j];

        const crossesRay =
            yi > point.lat !== yj > point.lat &&
            point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;

        if (crossesRay) {
            inside = !inside;
        }
    }

    return inside;
}

/** Axis-aligned bounding box of a set of points (used for indexed SQL prefilters). */
export function bboxOfPoints(points: LatLng[]) {
    const lats = points.map((point) => point.lat);
    const lngs = points.map((point) => point.lng);

    return {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLng: Math.min(...lngs),
        maxLng: Math.max(...lngs),
    };
}

/** Bounding box of a circle; longitude spread widens towards the poles. */
export function bboxOfRadius(center: LatLng, radiusM: number) {
    const deltaLat = radiusM / METRES_PER_DEGREE_LAT;
    const deltaLng =
        radiusM /
        (METRES_PER_DEGREE_LAT *
            Math.max(Math.cos(toRadians(center.lat)), 0.01));

    return {
        minLat: center.lat - deltaLat,
        maxLat: center.lat + deltaLat,
        minLng: center.lng - deltaLng,
        maxLng: center.lng + deltaLng,
    };
}

/* -------------------------------------------------------------------------- */
/* Polygon hygiene (all local, no map API calls)                              */
/* -------------------------------------------------------------------------- */

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
const samePoint = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

/**
 * Rounds to 6 dp (~11 cm), drops consecutive duplicates and the closing point.
 * Keeps stored polygons small and point-in-polygon checks fast.
 */
export function normalizeRing(points: LatLng[]): LatLng[] {
    const ring: LatLng[] = [];

    for (const point of points) {
        const next = { lat: round6(point.lat), lng: round6(point.lng) };
        const last = ring[ring.length - 1];

        if (!last || !samePoint(last, next)) {
            ring.push(next);
        }
    }

    if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) {
        ring.pop();
    }

    return ring;
}

/** Approximate area in m² (local equirectangular projection; fine at city scale). */
export function ringAreaM2(ring: LatLng[]): number {
    if (ring.length < 3) {
        return 0;
    }

    const origin = ring[0];
    const kx = METRES_PER_DEGREE_LAT * Math.cos(toRadians(origin.lat));
    const points = ring.map((p) => ({
        x: (p.lng - origin.lng) * kx,
        y: (p.lat - origin.lat) * METRES_PER_DEGREE_LAT,
    }));

    let sum = 0;

    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }

    return Math.abs(sum) / 2;
}

const orientation = (a: LatLng, b: LatLng, c: LatLng) => {
    const value = (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
    return Math.abs(value) < 1e-18 ? 0 : Math.sign(value);
};

const onSegment = (a: LatLng, b: LatLng, p: LatLng) =>
    Math.min(a.lng, b.lng) <= p.lng &&
    p.lng <= Math.max(a.lng, b.lng) &&
    Math.min(a.lat, b.lat) <= p.lat &&
    p.lat <= Math.max(a.lat, b.lat);

function segmentsIntersect(a: LatLng, b: LatLng, c: LatLng, d: LatLng): boolean {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);

    if (o1 !== o2 && o3 !== o4) return true;

    return (
        (o1 === 0 && onSegment(a, b, c)) ||
        (o2 === 0 && onSegment(a, b, d)) ||
        (o3 === 0 && onSegment(c, d, a)) ||
        (o4 === 0 && onSegment(c, d, b))
    );
}

/** True when two non-adjacent edges touch or cross ("bow-tie" shapes). */
export function isSelfIntersecting(ring: LatLng[]): boolean {
    const n = ring.length;

    for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue; // adjacent through the wrap

            if (segmentsIntersect(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) {
                return true;
            }
        }
    }

    return false;
}

/** Largest distance (m) from `center` to any vertex. */
export const farthestFrom = (center: LatLng, ring: LatLng[]): number =>
    Math.max(...ring.map((point) => haversineM(center, point)));
