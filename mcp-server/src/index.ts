import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { db } from "./db.js";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { extractExif } from "./exif.js";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { cosineSimilarity, bufferToFloat32Array } from "./similarity.js";

const server = new McpServer({
  name: "mcp-server",
  version: "1.0.0",
});

function logEvent(event: string, data: Record<string, unknown>) {
  console.error(
    JSON.stringify({ event, timestamp: new Date().toISOString(), ...data }),
  );
}

function withLogging<Args>(
  toolName: string,
  handler: (args: Args, extra: any) => Promise<any>,
) {
  return async (args: Args, extra: any) => {
    const callId = extra.requestId;
    const traceId = extra._meta?.traceId ?? callId;
    const start = Date.now();
    logEvent("tool_call_start", { tool: toolName, callId, traceId, args });
    try {
      const result = await handler(args, extra);
      logEvent("tool_call_end", {
        tool: toolName,
        callId,
        traceId,
        durationMs: Date.now() - start,
        isError: !!result?.isError,
      });
      return result;
    } catch (err) {
      logEvent("tool_call_error", {
        tool: toolName,
        callId,
        traceId,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}

const searchPhotosInput = {
  country: z
    .enum([
      "Germany",
      "Switzerland",
      "Sweden",
      "Vietnam",
      "Austria",
      "Slovenia",
    ])
    .optional(),
  city: z.string().optional(),
  exposure: z
    .object({
      minAperture: z.number().optional(),
      maxAperture: z.number().optional(),
      minIso: z.number().optional(),
      maxIso: z.number().optional(),
    })
    .optional(),
  dateRange: z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .optional(),
  limit: z.number().int().positive().max(100).default(20),
};

type SearchPhotosInput = z.infer<
  ReturnType<typeof z.object<typeof searchPhotosInput>>
>;

function buildSearchQuery(input: SearchPhotosInput) {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (input.country) {
    conditions.push("country = @country");
    params.country = input.country;
  }
  if (input.city) {
    conditions.push("city = @city");
    params.city = input.city;
  }
  if (input.exposure?.minAperture !== undefined) {
    conditions.push("aperture >= @minAperture");
    params.minAperture = input.exposure.minAperture;
  }
  if (input.exposure?.maxAperture !== undefined) {
    conditions.push("aperture <= @maxAperture");
    params.maxAperture = input.exposure.maxAperture;
  }
  if (input.exposure?.minIso !== undefined) {
    conditions.push("iso >= @minIso");
    params.minIso = input.exposure.minIso;
  }
  if (input.exposure?.maxIso !== undefined) {
    conditions.push("iso <= @maxIso");
    params.maxIso = input.exposure.maxIso;
  }
  if (input.dateRange?.from) {
    conditions.push("captured_at >= @from");
    params.from = input.dateRange.from;
  }
  if (input.dateRange?.to) {
    conditions.push("captured_at <= @to");
    params.to = input.dateRange.to;
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return { where, params };
}

server.registerTool(
  "search_photos",
  {
    title: "Search Photos",
    description:
      "Search the photo library by country, city, exposure settings (aperture/ISO range), or date range.",
    inputSchema: searchPhotosInput,
  },
  withLogging("search_photos", async (input: SearchPhotosInput) => {
    const { where, params } = buildSearchQuery(input);
    const totalMatches = (
      db.prepare(`SELECT COUNT(*) as n FROM photos ${where}`).get(params) as {
        n: number;
      }
    ).n;
    const rows = db
      .prepare(
        `SELECT * FROM photos ${where} ORDER BY captured_at DESC LIMIT @limit`,
      )
      .all({
        ...params,
        limit: input.limit,
      }) as Record<string, unknown>[];

    // file_path is deliberately withheld here — a broad search shouldn't
    // hand back displayable images for free. To actually show a specific
    // photo, the model must call get_photo_details(id) for it, which does
    // return file_path. This keeps "what gets displayed" tied one-to-one
    // to an explicit per-photo lookup instead of whatever a search returned.
    const photosForModel = rows.map(({ file_path, ...rest }) => rest);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              totalMatches,
              returned: photosForModel.length,
              truncated: totalMatches > photosForModel.length,
              photos: photosForModel,
            },
            null,
            2,
          ),
        },
      ],
    };
  }),
);

const getPhotoDetailsInput = {
  id: z.number().int().positive(),
  includeImage: z
    .boolean()
    .default(false)
    .describe(
      "Set true only when actually displaying this photo to the user (e.g. as a thumbnail). " +
        "Leave false when you just need metadata to describe in text.",
    ),
};

server.registerTool(
  "get_photo_details",
  {
    title: "Get Photo Details",
    description: "Fetch the full metadata for a single photo by its id.",
    inputSchema: getPhotoDetailsInput,
  },
  withLogging(
    "get_photo_details",
    async ({ id, includeImage }: { id: number; includeImage: boolean }) => {
      const photo = db
        .prepare("SELECT * FROM photos WHERE id = @id")
        .get({ id }) as Record<string, unknown> | undefined;
      if (!photo) {
        return {
          content: [{ type: "text", text: `No photo found with id ${id}.` }],
        };
      }
      // Same principle as search_photos: file_path only goes to the model
      // when it explicitly asked for it, not just because it looked up the id.
      const { file_path, ...rest } = photo;
      const responsePhoto = includeImage ? photo : rest;
      return {
        content: [{ type: "text", text: JSON.stringify(responsePhoto, null, 2) }],
      };
    },
  ),
);

const suggestPhotoLocationsInput = {
  folderPath: z.string(),
};

server.registerTool(
  "suggest_photo_locations",
  {
    title: "Suggest Photo Locations",
    description:
      "Given a folder of unsorted photos, suggest which trip (country/city) each one belongs to, " +
      "by matching its capture date against known trip date ranges. Each suggestion's " +
      "existingFolder is the real, already-existing folder that trip's other photos are filed " +
      "under — pass it verbatim as move_photo's destinationFolder. Never construct a destination " +
      "path yourself (e.g. a new folder directly under the user's Pictures directory); this tool " +
      "always tells you the real one.",
    inputSchema: suggestPhotoLocationsInput,
  },
  withLogging(
    "suggest_photo_locations",
    async ({ folderPath }: { folderPath: string }) => {
      const cityRanges = db
        .prepare(
          `SELECT country, city, MIN(captured_at) as start, MAX(captured_at) as end
         FROM photos WHERE city IS NOT NULL GROUP BY country, city`,
        )
        .all() as { country: string; city: string; start: string; end: string }[];
      const countryRanges = db
        .prepare(
          `SELECT country, MIN(captured_at) as start, MAX(captured_at) as end FROM photos GROUP BY country`,
        )
        .all() as { country: string; start: string; end: string }[];

      // City and country ranges compete on equal footing — a country-wide
      // span (e.g. several separate city trips combined) can be far broader
      // than a short, distinct trip elsewhere that happens to fall inside
      // it. Below, whichever matching range is narrowest wins, regardless
      // of whether it's a city or a country row.
      const allRanges: {
        country: string;
        city: string | null;
        start: string;
        end: string;
      }[] = [
        ...cityRanges.map((r) => ({ ...r, city: r.city as string | null })),
        ...countryRanges.map((r) => ({ ...r, city: null })),
      ];

      // Maps "country::city" to the real, already-cataloged folder photos
      // for that trip are filed under, so move_photo's destination can be
      // derived instead of guessed. Photos for the same (country, city)
      // aren't always in one flat folder — some trips are entirely under a
      // subfolder like "edit" — so this picks whichever cataloged photo has
      // the *shallowest* path (fewest folder segments), which is always the
      // real trip folder itself rather than one of its subfolders.
      const depth = (p: string) => p.split(path.sep).length;
      const canonicalFolderFor = new Map<string, string>();
      for (const { country, city, file_path } of db
        .prepare(`SELECT country, city, file_path FROM photos`)
        .all() as { country: string; city: string | null; file_path: string }[]) {
        const key = `${country}::${city ?? ""}`;
        const existing = canonicalFolderFor.get(key);
        if (!existing || depth(file_path) < depth(existing)) {
          canonicalFolderFor.set(key, file_path);
        }
      }

      let entries;
      try {
        entries = await readdir(folderPath, { withFileTypes: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const message =
          code === "ENOENT"
            ? `Folder not found: ${folderPath}`
            : code === "ENOTDIR"
              ? `Not a folder: ${folderPath}`
              : code === "EACCES"
                ? `Permission denied reading folder: ${folderPath}`
                : `Could not read folder: ${folderPath}`;
        return { content: [{ type: "text", text: message }], isError: true };
      }

      const jpgs = entries.filter(
        (e) => e.isFile() && e.name.toLowerCase().endsWith(".jpg"),
      );

      const suggestions = [];
      for (const file of jpgs) {
        const exif = await extractExif(path.join(folderPath, file.name));
        if (!exif.captured_at) {
          suggestions.push({
            filename: file.name,
            suggestedCountry: null,
            suggestedCity: null,
            reason: "No capture date in EXIF.",
          });
          continue;
        }
        const matches = allRanges.filter(
          (r) => exif.captured_at! >= r.start && exif.captured_at! <= r.end,
        );
        if (matches.length === 0) {
          suggestions.push({
            filename: file.name,
            suggestedCountry: null,
            suggestedCity: null,
            reason: "Doesn't match any known trip.",
          });
          continue;
        }
        const duration = (r: (typeof matches)[number]) =>
          new Date(r.end).getTime() - new Date(r.start).getTime();
        const best = matches.reduce((a, b) => (duration(b) < duration(a) ? b : a));
        const canonicalPath = canonicalFolderFor.get(
          `${best.country}::${best.city ?? ""}`,
        );
        const existingFolder = canonicalPath ? path.dirname(canonicalPath) : null;
        suggestions.push({
          filename: file.name,
          suggestedCountry: best.country,
          suggestedCity: best.city,
          // The real, already-existing folder this photo's trip is filed
          // under — derived from an actual cataloged photo, not guessed.
          // Use this exact path as move_photo's destinationFolder.
          existingFolder,
          reason: best.city
            ? `Captured ${exif.captured_at}, within your ${best.city}, ${best.country} trip (existing folder: ${existingFolder}).`
            : `Captured ${exif.captured_at}, within your ${best.country} trip (existing folder: ${existingFolder}).`,
        });
      }

      return {
        content: [{ type: "text", text: JSON.stringify(suggestions, null, 2) }],
      };
    },
  ),
);

const movePhotoInput = {
  sourcePath: z.string(),
  destinationFolder: z.string(),
};

server.registerTool(
  "move_photo",
  {
    title: "Move Photo",
    description:
      "Move a photo file into a destination folder, creating the folder if it doesn't exist. " +
      "Never overwrites an existing file — if the destination already has a file with that name, " +
      "this fails instead of clobbering it, so pick a different destination or ask the user how " +
      "to resolve the conflict. Only call this when the user has explicitly asked to move, sort, " +
      "or organize specific files — never automatically after just suggesting where they belong.",
    inputSchema: movePhotoInput,
  },
  withLogging(
    "move_photo",
    async ({
      sourcePath,
      destinationFolder,
    }: {
      sourcePath: string;
      destinationFolder: string;
    }) => {
      let sourceStat;
      try {
        sourceStat = await stat(sourcePath);
      } catch {
        return {
          content: [{ type: "text", text: `Source file not found: ${sourcePath}` }],
          isError: true,
        };
      }
      if (!sourceStat.isFile()) {
        return {
          content: [{ type: "text", text: `Not a file: ${sourcePath}` }],
          isError: true,
        };
      }

      const destinationPath = path.join(
        destinationFolder,
        path.basename(sourcePath),
      );

      const alreadyExists = await access(destinationPath)
        .then(() => true)
        .catch(() => false);
      if (alreadyExists) {
        return {
          content: [
            {
              type: "text",
              text: `A file already exists at ${destinationPath} — refusing to overwrite it. Choose a different destination or ask the user how to resolve the conflict.`,
            },
          ],
          isError: true,
        };
      }

      try {
        await mkdir(destinationFolder, { recursive: true });
        await rename(sourcePath, destinationPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EXDEV") {
          // rename() can't cross filesystem/device boundaries atomically —
          // fall back to copy-then-delete, which works across devices.
          await copyFile(sourcePath, destinationPath);
          await unlink(sourcePath);
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Could not move file: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }

      return {
        content: [
          { type: "text", text: JSON.stringify({ movedTo: destinationPath }) },
        ],
      };
    },
  ),
);

const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

// Loaded once and reused across calls — this is a long-running server
// process, not a one-shot script, so there's no reason to re-load the
// ~90MB model on every tool call the way indexEmbeddings.ts loads it once
// per run.
let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;
function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", EMBEDDING_MODEL);
  }
  return embedderPromise;
}

const searchPhotosByDescriptionInput = {
  query: z.string().describe("A description of the visual content to search for, e.g. 'foggy mountain lake' or 'street photography at night'."),
  top_k: z.number().int().positive().max(20).default(5),
};

server.registerTool(
  "search_photos_by_description",
  {
    title: "Search Photos by Description",
    description:
      "Semantic search over what's actually visible in each photo — subject matter, scene, " +
      "mood, lighting, colors — as opposed to search_photos, which only filters on structured " +
      "metadata (country, city, exposure, date). Use this for content/vibe queries like 'moody " +
      "photos with fog' or 'street portraits at night'; use search_photos for date/location/" +
      "exposure filters. Unlike search_photos, this returns file_path directly since results are " +
      "already capped to a small top_k of the most relevant matches.",
    inputSchema: searchPhotosByDescriptionInput,
  },
  withLogging(
    "search_photos_by_description",
    async ({ query, top_k }: { query: string; top_k: number }) => {
      const embedder = await getEmbedder();
      const output = await embedder(query, { pooling: "mean", normalize: true });
      const queryVector = Float32Array.from(output.data as Float32Array);

      const rows = db
        .prepare(
          `SELECT p.id, p.file_path, e.caption, e.embedding
           FROM photo_embeddings e JOIN photos p ON p.id = e.photo_id
           WHERE e.model = @model`,
        )
        .all({ model: EMBEDDING_MODEL }) as {
        id: number;
        file_path: string;
        caption: string;
        embedding: Buffer;
      }[];

      const scored = rows
        .map((row) => ({
          id: row.id,
          file_path: row.file_path,
          caption: row.caption,
          score: cosineSimilarity(queryVector, bufferToFloat32Array(row.embedding)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, top_k);

      return {
        content: [{ type: "text", text: JSON.stringify({ results: scored }, null, 2) }],
      };
    },
  ),
);

const transport = new StdioServerTransport();

await server.connect(transport);
