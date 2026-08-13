export interface TableColumn {
  key: string;
  label: string;
}

export type TableCellValue = string | number | null;

export interface TableUIBlock {
  type: "table";
  title?: string;
  columns: TableColumn[];
  rows: Record<string, TableCellValue>[];
}

// Extend this union as more A2UI variants are added.
export type UIBlock = TableUIBlock;

export const RENDER_TABLE_TOOL_NAME = "render_table";
export const MAX_TABLE_COLUMNS = 8;
export const MAX_TABLE_ROWS = 50;

export const RENDER_TABLE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string" },
        },
        required: ["key", "label"],
      },
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: { type: ["string", "number", "null"] },
      },
    },
  },
  required: ["columns", "rows"],
} as const;

export const RENDER_TABLE_TOOL_DESCRIPTION =
  "Render a data table in the chat UI. Call this when you have two or more records to present " +
  "to the user (e.g. after search_photos or get_photo_details), instead of listing them in prose. " +
  `Max ${MAX_TABLE_COLUMNS} columns, ${MAX_TABLE_ROWS} rows.`;

export function validateTableBlock(input: unknown): TableUIBlock {
  if (typeof input !== "object" || input === null) {
    throw new Error("input must be an object");
  }
  const { title, columns, rows } = input as Record<string, unknown>;

  if (title !== undefined && typeof title !== "string") {
    throw new Error("title must be a string");
  }

  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error("columns must be a non-empty array");
  }
  if (columns.length > MAX_TABLE_COLUMNS) {
    throw new Error(`columns exceeds max of ${MAX_TABLE_COLUMNS}`);
  }
  const validatedColumns: TableColumn[] = columns.map((c, i) => {
    if (
      typeof c !== "object" ||
      c === null ||
      typeof (c as Record<string, unknown>).key !== "string" ||
      typeof (c as Record<string, unknown>).label !== "string"
    ) {
      throw new Error(`columns[${i}] must be { key: string; label: string }`);
    }
    return { key: (c as { key: string }).key, label: (c as { label: string }).label };
  });
  const validKeys = new Set(validatedColumns.map((c) => c.key));

  if (!Array.isArray(rows)) {
    throw new Error("rows must be an array");
  }
  if (rows.length > MAX_TABLE_ROWS) {
    throw new Error(`rows exceeds max of ${MAX_TABLE_ROWS}`);
  }
  const validatedRows: Record<string, TableCellValue>[] = rows.map((r, i) => {
    if (typeof r !== "object" || r === null) {
      throw new Error(`rows[${i}] must be an object`);
    }
    const row: Record<string, TableCellValue> = {};
    for (const [key, value] of Object.entries(r as Record<string, unknown>)) {
      // Drop keys that don't match a declared column rather than erroring —
      // tolerate minor model slop instead of rejecting the whole table.
      if (!validKeys.has(key)) continue;
      if (value !== null && typeof value !== "string" && typeof value !== "number") {
        throw new Error(`rows[${i}].${key} must be a string, number, or null`);
      }
      row[key] = value as TableCellValue;
    }
    return row;
  });

  return {
    type: "table",
    ...(title !== undefined ? { title } : {}),
    columns: validatedColumns,
    rows: validatedRows,
  };
}
