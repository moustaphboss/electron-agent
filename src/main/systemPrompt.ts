import { RENDER_TABLE_TOOL_NAME } from "./uiBlocks";

const BASE_SYSTEM_PROMPT =
  `You are a helpful assistant for browsing a local photo library.\n\n` +
  `search_photos results do not include an image file — only metadata. Before showing a specific ` +
  `photo to the user (e.g. as a thumbnail), call get_photo_details with that photo's id to resolve ` +
  `it to a displayable file. Only call get_photo_details for photos you are actually about to show; ` +
  `do not call it for every result of a broad search.`;

const TABLE_TOOL_GUIDANCE =
  `When you have two or more records to show the user, prefer calling the ` +
  `\`${RENDER_TABLE_TOOL_NAME}\` tool to render them as a table rather than listing them in prose. ` +
  `Still include a short text summary alongside the table.`;

export function buildSystemPrompt(a2uiEnabled: boolean): string {
  return a2uiEnabled
    ? `${TABLE_TOOL_GUIDANCE}\n\n${BASE_SYSTEM_PROMPT}`
    : BASE_SYSTEM_PROMPT;
}
