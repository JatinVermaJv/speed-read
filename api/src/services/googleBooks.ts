export interface GoogleBooksVolumeMetadata {
  googleVolumeId: string;
  coverImageUrl: string | null;
  description: string | null;
  categories: string | null;
  publishedDate: string | null;
  pageCount: number | null;
  publisher: string | null;
  language: string | null;
  previewLink: string | null;
}

export interface GoogleBooksVolumeCandidate {
  googleVolumeId: string;
  title: string | null;
  author: string | null;
  coverImageUrl: string | null;
  description: string | null;
  categories: string | null;
  publishedDate: string | null;
  pageCount: number | null;
  publisher: string | null;
  language: string | null;
  previewLink: string | null;
}

function normalizeHttps(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("http://")) return `https://${trimmed.slice("http://".length)}`;
  return trimmed;
}

function normalizeText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

type GoogleBooksVolume = {
  id?: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    description?: string;
    categories?: string[];
    publishedDate?: string;
    pageCount?: number;
    publisher?: string;
    language?: string;
    previewLink?: string;
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
    };
  };
};

function scoreCandidate(volume: GoogleBooksVolume, title: string, author: string): number {
  const vTitle = (volume.volumeInfo?.title ?? "").toLowerCase();
  const vAuthors = (volume.volumeInfo?.authors ?? []).map((a) => a.toLowerCase());
  const titleNeedle = title.toLowerCase();
  const authorNeedle = author.toLowerCase();

  let score = 0;
  if (vTitle.includes(titleNeedle)) score += 3;
  if (vTitle.replace(/[^a-z0-9]/g, "").includes(titleNeedle.replace(/[^a-z0-9]/g, ""))) score += 1;

  if (vAuthors.some((a) => a.includes(authorNeedle))) score += 3;
  if (vAuthors.some((a) => a.replace(/[^a-z0-9]/g, "").includes(authorNeedle.replace(/[^a-z0-9]/g, "")))) {
    score += 1;
  }

  const hasThumb = Boolean(
    volume.volumeInfo?.imageLinks?.thumbnail || volume.volumeInfo?.imageLinks?.smallThumbnail
  );
  if (hasThumb) score += 1;

  return score;
}

export async function lookupBestVolume(params: {
  title: string;
  author: string;
  traceId?: string;
}): Promise<GoogleBooksVolumeMetadata | null> {
  const title = params.title.trim();
  const author = params.author.trim();
  if (!title || !author) return null;

  const key = (process.env.GOOGLE_BOOKS_API_KEY ?? "").trim();

  const qParts = [`intitle:${title}`, `inauthor:${author}`];
  const query = encodeURIComponent(qParts.join(" "));
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=5&printType=books` +
    (key ? `&key=${encodeURIComponent(key)}` : "");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as { items?: GoogleBooksVolume[] };
    const items = Array.isArray(json.items) ? json.items : [];
    if (items.length === 0) return null;

    const sorted = [...items].sort((a, b) => scoreCandidate(b, title, author) - scoreCandidate(a, title, author));
    const best = sorted[0];

    if (!best) return null;

    const googleVolumeId = toStringOrNull(best?.id);
    if (!googleVolumeId) return null;

    const image =
      toStringOrNull(best.volumeInfo?.imageLinks?.thumbnail) ||
      toStringOrNull(best.volumeInfo?.imageLinks?.smallThumbnail);

    const description = normalizeText(best.volumeInfo?.description, 4000);

    const categoriesArray = Array.isArray(best.volumeInfo?.categories)
      ? best.volumeInfo?.categories.filter((c) => typeof c === "string").map((c) => c.trim()).filter(Boolean)
      : [];

    const categories = categoriesArray.length > 0 ? categoriesArray.join(", ") : null;

    const publishedDate = normalizeText(best.volumeInfo?.publishedDate, 40);
    const pageCount = Number.isFinite(best.volumeInfo?.pageCount ?? NaN)
      ? Math.max(1, Math.floor(best.volumeInfo?.pageCount as number))
      : null;
    const publisher = normalizeText(best.volumeInfo?.publisher, 255);
    const language = normalizeText(best.volumeInfo?.language, 20);
    const previewLink = normalizeText(best.volumeInfo?.previewLink, 1200);

    return {
      googleVolumeId,
      coverImageUrl: image ? normalizeHttps(image) : null,
      description,
      categories,
      publishedDate,
      pageCount,
      publisher,
      language,
      previewLink,
    };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[googleBooks${params.traceId ? `:${params.traceId}` : ""}] lookup failed`, {
        title,
        author,
        message,
      });
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchVolumes(params: {
  q: string;
  maxResults?: number;
  traceId?: string;
}): Promise<GoogleBooksVolumeCandidate[]> {
  const q = params.q.trim();
  if (!q) return [];

  const key = (process.env.GOOGLE_BOOKS_API_KEY ?? "").trim();
  const maxResults = Math.min(20, Math.max(1, Math.floor(params.maxResults ?? 10)));

  const query = encodeURIComponent(q);
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=${maxResults}&printType=books` +
    (key ? `&key=${encodeURIComponent(key)}` : "");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];

    const json = (await response.json()) as { items?: GoogleBooksVolume[] };
    const items = Array.isArray(json.items) ? json.items : [];
    if (items.length === 0) return [];

    const out: GoogleBooksVolumeCandidate[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const googleVolumeId = toStringOrNull(item?.id);
      if (!googleVolumeId) continue;
      if (seen.has(googleVolumeId)) continue;
      seen.add(googleVolumeId);

      const title = normalizeText(item.volumeInfo?.title, 500);
      const authorArray = Array.isArray(item.volumeInfo?.authors)
        ? item.volumeInfo?.authors.filter((a) => typeof a === "string").map((a) => a.trim()).filter(Boolean)
        : [];
      const author = authorArray.length > 0 ? authorArray.join(", ") : null;

      const image =
        toStringOrNull(item.volumeInfo?.imageLinks?.thumbnail) ||
        toStringOrNull(item.volumeInfo?.imageLinks?.smallThumbnail);

      const description = normalizeText(item.volumeInfo?.description, 1400);

      const categoriesArray = Array.isArray(item.volumeInfo?.categories)
        ? item.volumeInfo?.categories.filter((c) => typeof c === "string").map((c) => c.trim()).filter(Boolean)
        : [];
      const categories = categoriesArray.length > 0 ? categoriesArray.join(", ") : null;

      const publishedDate = normalizeText(item.volumeInfo?.publishedDate, 40);
      const pageCount = Number.isFinite(item.volumeInfo?.pageCount ?? NaN)
        ? Math.max(1, Math.floor(item.volumeInfo?.pageCount as number))
        : null;
      const publisher = normalizeText(item.volumeInfo?.publisher, 255);
      const language = normalizeText(item.volumeInfo?.language, 20);
      const previewLink = normalizeText(item.volumeInfo?.previewLink, 1200);

      out.push({
        googleVolumeId,
        title,
        author,
        coverImageUrl: image ? normalizeHttps(image) : null,
        description,
        categories,
        publishedDate,
        pageCount,
        publisher,
        language,
        previewLink,
      });
    }

    return out;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[googleBooks${params.traceId ? `:${params.traceId}` : ""}] search failed`, {
        q,
        message,
      });
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
