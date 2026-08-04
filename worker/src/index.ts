export interface Env {
  DATA_BASE_URL: string;
  STATS: D1Database;
  STATS_TOKEN: string;
  RATE_LIMITER: RateLimit;
}

interface Brand {
  slug: string;
  name: string;
  aliases: string[];
  colors: { primary: string };
  logo: string;
  version?: number;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DIACRITICS_REGEX = /\p{Diacritic}/gu;
const NON_ALNUM_REGEX = /[^a-z0-9]/g;

function normalize(input: string): string {
  return input
    .normalize("NFKD")
    .replace(DIACRITICS_REGEX, "")
    .toLowerCase()
    .replace(NON_ALNUM_REGEX, "");
}

async function loadBrands(env: Env): Promise<Brand[]> {
  const url = `${env.DATA_BASE_URL.replace(/\/$/, "")}/data/brands.json`;
  const res = await fetch(url, {
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) {
    throw new Error(`Kon brands.json niet ophalen (${res.status}) van ${url}`);
  }
  return res.json();
}

function findBrand(brands: Brand[], query: string): Brand | null {
  const nq = normalize(query);
  if (!nq) return null;

  let prefixMatch: Brand | null = null;
  let substringMatch: Brand | null = null;

  for (const brand of brands) {
    const candidates = [brand.slug, brand.name, ...brand.aliases].map(normalize);
    for (const candidate of candidates) {
      if (candidate === nq) return brand;
      if (!prefixMatch && (candidate.startsWith(nq) || nq.startsWith(candidate))) {
        prefixMatch = brand;
      }
      if (!substringMatch && (candidate.includes(nq) || nq.includes(candidate))) {
        substringMatch = brand;
      }
    }
  }

  return prefixMatch || substringMatch;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function toPublicBrand(brand: Brand, dataBaseUrl: string) {
  const logoUrl = `${dataBaseUrl.replace(/\/$/, "")}/${brand.logo}`;
  return {
    slug: brand.slug,
    name: brand.name,
    colors: brand.colors,
    logo: brand.version ? `${logoUrl}?v=${brand.version}` : logoUrl,
  };
}

interface TrackBody {
  slug?: unknown;
  custom?: unknown;
}

async function handleTrack(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.RATE_LIMITER.limit({ key: ip });
  if (!success) {
    return new Response(null, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as TrackBody | null;
  if (!body) {
    return new Response(null, { status: 204 });
  }

  const kind = body.slug ? "slug" : body.custom ? "custom" : null;
  const name = String(body.slug ?? body.custom ?? "")
    .trim()
    .toLowerCase();

  // Vertrouw de client niet: dezelfde grenzen als de app nog eens serverside.
  if (!kind || !name || name.length > 40) {
    return new Response(null, { status: 204 });
  }

  await env.STATS.prepare(
    `INSERT INTO store_counts (kind, name, count) VALUES (?, ?, 1)
     ON CONFLICT(kind, name) DO UPDATE SET count = count + 1`
  )
    .bind(kind, name)
    .run();

  return new Response(null, { status: 204 });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStatsHtml(
  known: { name: string; count: number }[],
  custom: { name: string; count: number }[]
): string {
  const rows = (list: { name: string; count: number }[]) =>
    list
      .map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${r.count}</td></tr>`)
      .join("");

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title>BrandAPI stats</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  h2 { font-size: 1rem; margin-top: 2rem; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.25rem 0.5rem; border-bottom: 1px solid #ddd; }
  td:last-child { text-align: right; }
</style>
</head>
<body>
  <h1>Winkelteller</h1>
  <h2>Bekende merken (uit de catalogus)</h2>
  <table>${rows(known)}</table>
  <h2>Zelf getypte winkels (3x of vaker)</h2>
  <table>${rows(custom)}</table>
</body>
</html>`;
}

async function handleStats(url: URL, env: Env): Promise<Response> {
  if (url.searchParams.get("token") !== env.STATS_TOKEN) {
    return new Response("Nope", { status: 401 });
  }

  const known = await env.STATS.prepare(
    `SELECT name, count FROM store_counts WHERE kind = 'slug' ORDER BY count DESC`
  ).all<{ name: string; count: number }>();

  // Alleen namen die vaker dan twee keer voorkomen. Wat één iemand typt is
  // niet interessant voor de merkenlijst en is nou juist wat persoonlijk kan
  // zijn — dit is de belangrijkste regel op deze pagina.
  const custom = await env.STATS.prepare(
    `SELECT name, count FROM store_counts WHERE kind = 'custom' AND count >= 3 ORDER BY count DESC LIMIT 100`
  ).all<{ name: string; count: number }>();

  return new Response(renderStatsHtml(known.results, custom.results), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/brand" && request.method === "GET") {
        const query = url.searchParams.get("q") ?? "";
        const brands = await loadBrands(env);
        const match = findBrand(brands, query);
        if (!match) {
          return jsonResponse({ error: "not found", query }, 404);
        }
        return jsonResponse(toPublicBrand(match, env.DATA_BASE_URL));
      }

      if (url.pathname === "/brands" && request.method === "GET") {
        const brands = await loadBrands(env);
        return jsonResponse(brands.map((b) => toPublicBrand(b, env.DATA_BASE_URL)));
      }

      // Geen CORS op /track en /stats: dit komt van de app resp. rechtstreeks
      // uit de browser via het token in de query, niet vanuit een webpagina.
      if (url.pathname === "/track" && request.method === "POST") {
        return await handleTrack(request, env);
      }

      if (url.pathname === "/stats" && request.method === "GET") {
        return await handleStats(url, env);
      }

      return jsonResponse({ error: "not found" }, 404);
    } catch (err) {
      return jsonResponse(
        { error: "internal error", message: (err as Error).message },
        502
      );
    }
  },
};
