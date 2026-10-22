declare module "@mercuryworkshop/wisp-js/server" {
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export const server: {
    routeRequest(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      connectionOptions?: Record<string, unknown>,
    ): void;
  };
}
