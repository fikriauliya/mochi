import { Headers, HttpServerResponse } from "@effect/platform";
import { Stream } from "effect";
import type { BuildEvent } from "./Schema";

const HEADERS = Headers.fromInput({
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  // Hint to nginx-style proxies not to buffer.
  "x-accel-buffering": "no",
  connection: "keep-alive",
});

const HEARTBEAT = ":\n\n";

const formatEvent = (ev: BuildEvent): string =>
  `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;

/**
 * Wrap a `Stream<BuildEvent>` as a server-sent-events HTTP response.
 *
 * - Emits a leading `:\n\n` comment so browsers don't wait for buffering
 * - Heartbeats every 15s while the stream is idle so proxies don't drop
 *   the connection
 * - On stream end the connection closes naturally
 */
export const sseResponse = (events: Stream.Stream<BuildEvent>) => {
  const eventLines = events.pipe(Stream.map(formatEvent));
  const heartbeats = Stream.tick("15 seconds").pipe(Stream.map(() => HEARTBEAT));

  const merged = Stream.merge(eventLines, heartbeats, { haltStrategy: "left" });
  const body = Stream.concat(
    Stream.succeed(": connected\n\n") as Stream.Stream<string>,
    merged,
  ).pipe(Stream.encodeText);

  return HttpServerResponse.stream(body, { headers: HEADERS });
};
