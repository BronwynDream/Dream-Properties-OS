import { GARDEN_ROUTE_CENTROIDS } from "@/lib/external-listings/geocode";

// One name per place for the suburb picker: the centroid list carries
// spelling aliases ("Belvedere", "Leisure Island"), so keep the first name
// at each point. Farm districts and other towns are left out.
const FAR = /^(Rheenendal|Sedgefield|Plettenberg Bay|Plett|George|Wilderness|Knysna)$/;
export const SUBURBS: { name: string; lng: number; lat: number }[] = (() => {
  const seen = new Set<string>();
  const out: { name: string; lng: number; lat: number }[] = [];
  for (const [name, c] of Object.entries(GARDEN_ROUTE_CENTROIDS)) {
    const k = `${c.lng.toFixed(3)},${c.lat.toFixed(3)}`;
    if (FAR.test(name) || seen.has(k)) continue;
    seen.add(k);
    out.push({ name, lng: c.lng, lat: c.lat });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
})();
