// Every message from the app (HomeHost) to the Home page's bridge, as a protocol map keyed by an
// enum. The app's side is src/GeminiLive/Glic/HomeProtocol.cs.
import { z } from 'zod';

export enum HomeMessage {
  Ready = 'ready',
  PcLights = 'pcLights',
}

// Zod enforces the shape, so a Home-app DOM change that breaks our reading surfaces as a validation
// error here instead of a silently wrong value in C#.
export const PcLightsState = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    name: z.string(),
    on: z.boolean().nullable(), // null when the tile shows no state word yet
    text: z.string(),
    x: z.number().int(),
    y: z.number().int(),
  }),
]);
export type PcLightsState = z.infer<typeof PcLightsState>;

export interface HomeProtocolMap {
  /** Whether the device grid has loaded the lights' state. */
  [HomeMessage.Ready](): boolean;
  [HomeMessage.PcLights](): PcLightsState;
}
