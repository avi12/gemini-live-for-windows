// Every message from the app (HomeHost) to the Home page's bridge, as a protocol map keyed by an
// enum. The app's side is src/GeminiLive/Glic/HomeProtocol.cs.

export enum HomeMessage {
  Ready = "ready",
  PcLights = "pcLights"
}

/** The PC Lights tile as the page shows it; x and y are whole pixels, where HomeHost clicks. */
export type PcLightsState =
  | { found: false }
  | {
    found: true;
    name: string;
    /** null when the tile shows no state word yet. */
    on: boolean | null;
    text: string;
    x: number;
    y: number;
  };

export interface HomeProtocolMap {
  /** Whether the device grid has loaded the lights' state. */
  [HomeMessage.Ready](): boolean;
  [HomeMessage.PcLights](): PcLightsState;
}
