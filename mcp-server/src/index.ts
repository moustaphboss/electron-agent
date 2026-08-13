import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { db } from "./db.js";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { extractExif } from "./exif.js";

const server = new McpServer({
  name: "mcp-server",
  version: "1.0.0",
});

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
  async (input) => {
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
      });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              totalMatches,
              returned: rows.length,
              truncated: totalMatches > rows.length,
              photos: rows,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

const getPhotoDetailsInput = {
  id: z.number().int().positive(),
};

server.registerTool(
  "get_photo_details",
  {
    title: "Get Photo Details",
    description: "Fetch the full metadata for a single photo by its id.",
    inputSchema: getPhotoDetailsInput,
  },
  async ({ id }) => {
    const photo = db.prepare("SELECT * FROM photos WHERE id = @id").get({ id });
    if (!photo) {
      return {
        content: [{ type: "text", text: `No photo found with id ${id}.` }],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(photo, null, 2) }],
    };
  },
);

const suggestPhotoLocationsInput = {
  folderPath: z.string(),
};

server.registerTool(
  "suggest_photo_locations",
  {
    title: "Suggest Photo Locations",
    description:
      "Given a folder of unsorted photos, suggest which trip (country/city) each one belongs to, by matching its capture date against known trip date ranges.",
    inputSchema: suggestPhotoLocationsInput,
  },
  async ({ folderPath }) => {
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
      const cityMatch = cityRanges.find(
        (r) => exif.captured_at! >= r.start && exif.captured_at! <= r.end,
      );
      if (cityMatch) {
        suggestions.push({
          filename: file.name,
          suggestedCountry: cityMatch.country,
          suggestedCity: cityMatch.city,
          reason: `Captured ${exif.captured_at}, within your ${cityMatch.city}, ${cityMatch.country} trip.`,
        });
        continue;
      }
      const countryMatch = countryRanges.find(
        (r) => exif.captured_at! >= r.start && exif.captured_at! <= r.end,
      );
      suggestions.push(
        countryMatch
          ? {
              filename: file.name,
              suggestedCountry: countryMatch.country,
              suggestedCity: null,
              reason: `Captured ${exif.captured_at}, within your ${countryMatch.country} trip.`,
            }
          : {
              filename: file.name,
              suggestedCountry: null,
              suggestedCity: null,
              reason: "Doesn't match any known trip.",
            },
      );
    }

    return {
      content: [{ type: "text", text: JSON.stringify(suggestions, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();

await server.connect(transport);
