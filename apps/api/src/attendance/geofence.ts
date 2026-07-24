export interface Coordinates {
  latitude: number;
  longitude: number;
}

const earthRadiusMeters = 6_371_000;

export function haversineDistanceMeters(first: Coordinates, second: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const firstLatitudeRadians = toRadians(first.latitude);
  const secondLatitudeRadians = toRadians(second.latitude);
  const latitudeDelta = secondLatitudeRadians - firstLatitudeRadians;
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitudeRadians) * Math.cos(secondLatitudeRadians) * Math.sin(longitudeDelta / 2) ** 2;
  const boundedHaversine = Math.min(1, Math.max(0, haversine));

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(boundedHaversine), Math.sqrt(1 - boundedHaversine));
}
