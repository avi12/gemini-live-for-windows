import { z } from "zod";

// The boundary between the app and the Home page's bridge (bridge/home/home_protocol.ts), mirrored
// as an as-const object for the same reason as the glic protocol.

export const HomeMessage = {
  READY: "ready",
  PC_LIGHTS: "pcLights"
} as const;

// The PC Lights tile as the page shows it; x and y are whole pixels, where a trusted click lands
export const pcLightsSchema = z.discriminatedUnion("found", [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    // null when the tile shows no name; the lights are then called PC lights
    name: z.string().nullable(),
    // null when the tile shows no state word yet
    on: z.boolean().nullable(),
    text: z.string(),
    x: z.number(),
    y: z.number()
  })
]);

export interface HomeProtocolMap {
  // Whether the device grid has loaded the lights' state
  [HomeMessage.READY](): unknown;
  [HomeMessage.PC_LIGHTS](): unknown;
}
