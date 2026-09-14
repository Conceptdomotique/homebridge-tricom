import { Logger } from 'homebridge';

/**
 * Nested map returned by the Tricom HTTP server:
 * { "<exoAddress>": { "<outputNbr>": <value> } }
 *
 * Keys arrive as strings in JSON; values are numeric output levels
 * (0 = off, >0 = on / dimmer level).
 */
export type ExoValues = Record<string, Record<string, number>>;

/**
 * Thin HTTP client for the Tricom "jeedom" gateway.
 *
 * It reproduces exactly the two calls the original Jeedom plugin made:
 *   - GET /jeedom/allExosOutputsValues?apikey=...        -> read every output
 *   - GET /jeedom/exoOutputValue?exo=&output=&value=...  -> write one output
 *
 * URL building mirrors the PHP callTricomHttpServer(): the apikey is
 * appended with '?' when the path has no query string, otherwise with '&'.
 */
export class TricomClient {
  private readonly base: string;

  constructor(
    private readonly ip: string,
    private readonly port: number,
    private readonly apikey: string,
    private readonly timeoutMs: number,
    private readonly log: Logger,
  ) {
    this.base = `http://${ip}:${port}/jeedom`;
  }

  private buildUrl(path: string): string {
    const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');
    const sep = clean.includes('?') ? '&' : '?';
    return `${this.base}/${clean}${sep}apikey=${encodeURIComponent(this.apikey)}`;
  }

  private async get(path: string): Promise<string> {
    const url = this.buildUrl(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} on ${url}`);
      }
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Read the state of every EXO output on the central. */
  async getAllValues(): Promise<ExoValues> {
    const body = await this.get('/allExosOutputsValues');
    try {
      return JSON.parse(body) as ExoValues;
    } catch (e) {
      throw new Error(`Invalid JSON from Tricom: ${body.slice(0, 120)}`);
    }
  }

  /** Set a single EXO output to a raw value (0 = off). */
  async setOutput(exo: number | string, output: number | string, value: number): Promise<void> {
    this.log.debug(`Tricom set exo=${exo} output=${output} value=${value}`);
    await this.get(`/exoOutputValue?exo=${exo}&output=${output}&value=${value}`);
  }
}
