import {z} from 'zod';
import {widgetSettings} from '../widget';
import {workingHours} from '../working-hours';
// Widget settings an MCP client may read and change: chat mode (workingHours.enabled: a person can be asked
// at any time, or only inside working hours), the working hours and away message, the visitor's AI-or-person
// choice (visitorChoice) and the handoff contact option (hideContact hides the optional email field and the
// after-hours "Leave an email for a follow-up" button). Branding, prompts, origins and paths are out of reach.
// Values are validated with the same zod schemas as Widget studio (lib/widget.ts, lib/working-hours.ts);
// db/047 mcp_settings_problem checks them again.
export const MCP_SETTINGS = widgetSettings.pick({visitorChoice: true, hideContact: true, workingHours: true});
export type McpSettings = z.infer<typeof MCP_SETTINGS>;
export type McpSettingsView = {configured: boolean; settings: McpSettings};
const wh = workingHours.shape;
// Patch input: every key optional and no defaults, so an omitted key keeps its stored value.
export const SETTINGS_PATCH_SHAPE = {
  visitorChoice: z.boolean().optional().describe('Let visitors choose "Ask the AI" or "Talk to a person".'),
  hideContact: z.boolean().optional().describe('Hide the optional contact email field, including the after-hours follow-up option.'),
  workingHours: z.object({
    enabled: z.boolean().optional().describe('Chat mode: false means a person can be asked at any time; true applies the hours below.'),
    timezone: wh.timezone.optional().describe('IANA time zone, for example Asia/Kolkata.'),
    days: wh.days.unwrap().optional().describe('Opening ranges: day 0 (Sunday) to 6, start and end as 24-hour HH:MM. An end before the start runs past midnight.'),
    awayMessage: wh.awayMessage.unwrap().optional().describe('Shown when a visitor asks for a person outside the hours. Up to 300 characters.'),
  }).strict().optional(),
};
const PATCH = z.object(SETTINGS_PATCH_SHAPE).strict();
export type McpSettingsPatch = z.infer<typeof PATCH>;
// Normalise what the database returned. Stored values that no longer parse are reported as absent.
export function settingsView(raw: Record<string, unknown>): McpSettingsView {
  const h = workingHours.safeParse(raw.workingHours);
  return {configured: raw.configured === true, settings: {
    visitorChoice: typeof raw.visitorChoice === 'boolean' ? raw.visitorChoice : true,
    hideContact: typeof raw.hideContact === 'boolean' ? raw.hideContact : false,
    ...(h.success ? {workingHours: h.data} : {}),
  }};
}
const issue = (e: z.ZodError) => e.issues.map((i) => (i.path.length ? i.path.join('.') + ': ' : '') + i.message).slice(0, 3).join('; ');
// Merge a patch over the current settings and validate the result with the Widget studio schema. Returns only
// the changed top-level keys, each complete (workingHours is sent whole), ready for mcp_update_settings.
export function mergeSettingsPatch(current: McpSettings, input: unknown): {ok: true; changes: Partial<McpSettings>} | {ok: false; error: string} {
  const p = PATCH.safeParse(input);
  if (!p.success) return {ok: false, error: 'Invalid settings: ' + issue(p.error)};
  const patch = p.data;
  if (patch.visitorChoice === undefined && patch.hideContact === undefined && patch.workingHours === undefined) return {ok: false, error: 'Send at least one of visitorChoice, hideContact or workingHours.'};
  const merged = {...current, ...(patch.visitorChoice !== undefined ? {visitorChoice: patch.visitorChoice} : {}), ...(patch.hideContact !== undefined ? {hideContact: patch.hideContact} : {}),
    ...(patch.workingHours ? {workingHours: {...current.workingHours, ...Object.fromEntries(Object.entries(patch.workingHours).filter(([, v]) => v !== undefined))}} : {})};
  const v = MCP_SETTINGS.safeParse(merged);
  if (!v.success) return {ok: false, error: 'Invalid settings: ' + issue(v.error)};
  const changes: Partial<McpSettings> = {};
  if (patch.visitorChoice !== undefined) changes.visitorChoice = v.data.visitorChoice;
  if (patch.hideContact !== undefined) changes.hideContact = v.data.hideContact;
  if (patch.workingHours) changes.workingHours = v.data.workingHours;
  return {ok: true, changes};
}
