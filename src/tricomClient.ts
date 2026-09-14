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
 * The central reports application-level failures as HTTP 200 with a plain
 * text body of the form "ERROR <code>" — never as a 4xx status. The original
 * Jeedom plugin never checked for this, so a refused API key surfaced as a
 * JSON parse failure deep in its cron loop. We detect it explicitly.
 *
 * AnB-Rimex does not publish the code table; `code` is passed through as-is.
 */
export class TricomServerError extends Error {
  readonly code: number;

  constructor(code: number, context: string) {
    super(`Tricom refused the request with ERROR ${code} (${context})`);
    this.name = 'TricomServerError';
    this.code = code;
  }
}

/** Matches the central's plain-text error body, e.g. "ERROR 9001". */
const ERROR_BODY = /^\s*ERROR\s+(\d+)\s*$/i;

/**
 * Human-readable hint for the codes we have been able to observe against a
 * real central. Deliberately conservative: AnB-Rimex publishes no code table,
 * so anything unrecognised is reported as-is rather than guessed at.
 */
export function describeErrorCode(code: number): string {
  switch (code) {
    case 9001:
      return 'clé API refusée par la centrale — vérifiez la clé saisie dans le logiciel TRINITY';
    default:
      return 'code non documenté par AnB-Rimex';
  }
}

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

  private async get(path: string, context: string): Promise<string> {
    const url = this.buildUrl(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} on ${url}`);
      }
      const body = await res.text();

      const err = ERROR_BODY.exec(body);
      if (err) {
        throw new TricomServerError(Number(err[1]), context);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Raw request against the central, with the apikey appended.
   * Returns the body verbatim — "ERROR <code>" included — so diagnostics can
   * compare responses across inputs. Not used by the plugin itself.
   */
  async raw(path: string): Promise<string> {
    const url = this.buildUrl(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      return `${res.status} ${await res.text()}`.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Read the state of every EXO output on the central. */
  async getAllValues(): Promise<ExoValues> {
    const body = await this.get('/allExosOutputsValues', 'lecture des sorties');
    try {
      return JSON.parse(body) as ExoValues;
    } catch {
      throw new Error(`Invalid JSON from Tricom: ${body.slice(0, 120)}`);
    }
  }

  /** Set a single EXO output to a raw value (0 = off). */
  async setOutput(exo: number | string, output: number | string, value: number): Promise<void> {
    this.log.debug(`Tricom set exo=${exo} output=${output} value=${value}`);
    await this.get(
      `/exoOutputValue?exo=${exo}&output=${output}&value=${value}`,
      `écriture exo ${exo} sortie ${output}`,
    );
  }
}
