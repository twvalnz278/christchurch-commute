export const METRO_BASE_URL = "https://apis.metroinfo.co.nz";
export const GTFS_STATIC_URL = `${METRO_BASE_URL}/rti/gtfs/v1/gtfs.zip`;
export const SERVICE_ALERTS_URL = `${METRO_BASE_URL}/rti/gtfsrt/v1/service-alerts.pb`;
export const SIRI_ET_URL = `${METRO_BASE_URL}/rti/siri/v1/et`;

export function metroHeaders(apiKey: string): Headers {
  if (!apiKey) throw new Error("METRO_API_KEY secret is missing");
  return new Headers({ "Ocp-Apim-Subscription-Key": apiKey });
}

export async function checkedFetch(url: string, apiKey: string, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(url, { headers: metroHeaders(apiKey), redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Metro request failed with HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("Metro response exceeds the configured size limit");
  if (!response.body) throw new Error("Metro response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error("Metro response exceeds the configured size limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
