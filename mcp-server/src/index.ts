import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { db } from "./db.js";

const server = new McpServer({
  name: "mcp-server",
  version: "1.0.0",
});

const searchPhotosInput = {
  country: z.enum(["Germany", "Switzerland", "Sweden", "Vietnam", "Austria", "Slovenia"]).optional(),
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

type SearchPhotosInput = z.infer<ReturnType<typeof z.object<typeof searchPhotosInput>>>;

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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.limit = input.limit;

  return {
    sql: `SELECT * FROM photos ${where} ORDER BY captured_at DESC LIMIT @limit`,
    params,
  };
}

server.registerTool(
  "search_photos",
  {
    title: "Search Photos",
    description: "Search the photo library by country, city, exposure settings (aperture/ISO range), or date range.",
    inputSchema: searchPhotosInput,
  },
  async (input) => {
    const { sql, params } = buildSearchQuery(input);
    const rows = db.prepare(sql).all(params);
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  }
);


const transport = new StdioServerTransport();

await server.connect(transport);


