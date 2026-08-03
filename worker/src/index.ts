export interface Env {
  DATA_BASE_URL: string;
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

      return jsonResponse({ error: "not found" }, 404);
    } catch (err) {
      return jsonResponse(
        { error: "internal error", message: (err as Error).message },
        502
      );
    }
  },
};
