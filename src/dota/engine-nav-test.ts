import { z } from "zod";
import { ManagedMapPath } from "./map-contract.js";
import { VConsoleClient } from "./vconsole.js";

export type EngineNavigationMode = "endpoints" | "segments" | "both";
export type EngineNavigationPoint = [number, number, number];

export interface EngineNavigationRoute {
  name: string;
  points: EngineNavigationPoint[];
}

const pointSchema = z.tuple([z.number(), z.number(), z.number()]);
const checkSchema = z
  .object({
    index: z.number().int().positive().optional(),
    from: pointSchema,
    to: pointSchema,
    startTraversable: z.boolean(),
    endTraversable: z.boolean(),
    canFindPath: z.boolean(),
    pathLength: z.number(),
    passed: z.boolean(),
  })
  .strict();

const resultSchema = z
  .object({
    name: z.string(),
    mode: z.enum(["endpoints", "segments", "both"]),
    pointCount: z.number().int().min(2),
    endpoint: checkSchema.nullable(),
    segments: z.array(checkSchema),
    passed: z.boolean(),
  })
  .strict();

export type EngineNavigationRouteResult = z.infer<typeof resultSchema>;

export interface EngineNavigationExecution {
  results: EngineNavigationRouteResult[];
  failures: { name: string; error: string; consoleLine?: string }[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function validateEngineNavigationRoutes(
  routes: readonly EngineNavigationRoute[],
): EngineNavigationRoute[] {
  if (!routes.length) throw new Error("Engine navigation needs at least one route.");
  if (routes.length > 64) throw new Error("Engine navigation supports at most 64 routes per launch.");
  const names = new Set<string>();
  let pointCount = 0;
  return routes.map((route, routeIndex) => {
    if (!route.name.trim()) throw new Error(`routes[${routeIndex}].name must not be empty.`);
    if (!/^[A-Za-z0-9_.:-]+$/.test(route.name)) {
      throw new Error(`Engine navigation route "${route.name}" may contain only letters, digits, _, ., :, and -.`);
    }
    if (names.has(route.name)) throw new Error(`Engine navigation route name is duplicated: ${route.name}`);
    names.add(route.name);
    if (route.points.length < 2) {
      throw new Error(`Engine navigation route "${route.name}" needs at least two points.`);
    }
    if (route.points.length > 128) {
      throw new Error(`Engine navigation route "${route.name}" has more than 128 points; split it into smaller routes.`);
    }
    const points = route.points.map((point, pointIndex): EngineNavigationPoint => {
      if (point.length !== 3 || !point.every(Number.isFinite)) {
        throw new Error(`Engine navigation route "${route.name}" point ${pointIndex} must be three finite numbers.`);
      }
      return [point[0], point[1], point[2]];
    });
    pointCount += points.length;
    if (pointCount > 1024) throw new Error("Engine navigation supports at most 1024 total points per launch.");
    return { name: route.name, points };
  });
}

export function engineNavigationRoutesFromManagedPaths(
  paths: readonly ManagedMapPath[],
): EngineNavigationRoute[] {
  return validateEngineNavigationRoutes(
    paths.map((path) => ({ name: path.name, points: path.points })),
  );
}

const MAX_NAV_COMMAND_LENGTH = 480;
const NAV_CHUNK_POINTS = 8;
let navigationExecutionSequence = 0;
let navigationReadinessSequence = 0;

function consoleNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Cannot encode non-finite Lua number: ${value}`);
  return Object.is(value, -0) ? "0" : String(value);
}

/** Build one compact, correlated GridNav command that stays below Source 2's console limit. */
export function buildEngineNavigationCommand(
  route: EngineNavigationRoute,
  mode: EngineNavigationMode = "both",
  requestId = "nav",
): string {
  const [validated] = validateEngineNavigationRoutes([route]);
  if (!/^[A-Za-z0-9_.:-]+$/.test(requestId)) {
    throw new Error(`Engine navigation request id "${requestId}" contains unsafe console characters.`);
  }
  const points = validated.points.map((point) => point.map(consoleNumber).join(",")).join(":");
  const command = `mcp_nav ${requestId} ${validated.name} ${mode} "${points}"`;
  if (command.length > MAX_NAV_COMMAND_LENGTH) {
    throw new Error(
      `Engine navigation command for "${route.name}" is ${command.length} characters; split it below ${MAX_NAV_COMMAND_LENGTH}.`,
    );
  }
  return command;
}

export function parseEngineNavigationResponse(
  line: string,
): { requestId: string; result: EngineNavigationRouteResult } {
  const marker = "[MCP] NAV_OK ";
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) throw new Error(`DebugSDK did not return NAV_OK: ${line}`);
  const payload = line.slice(markerIndex + marker.length);
  const separator = payload.indexOf(" ");
  if (separator < 1) throw new Error(`DebugSDK NAV_OK response omitted its request id: ${line}`);
  const requestId = payload.slice(0, separator);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.slice(separator + 1).trim());
  } catch (error) {
    throw new Error(`DebugSDK returned invalid navigation JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Lua tables omit keys whose value is nil. Segment-only responses therefore
  // omit `endpoint`; normalize that wire representation to the public null.
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && !("endpoint" in parsed)) {
    parsed = { ...parsed, endpoint: null };
  }
  const result = resultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`DebugSDK navigation result had the wrong shape: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return { requestId, result: result.data };
}

export function parseEngineNavigationLine(line: string): EngineNavigationRouteResult {
  return parseEngineNavigationResponse(line).result;
}

/** Wait until the DebugSDK is loaded and the requested map game-state is active. */
export async function waitForEngineNavigationReady(
  vc: VConsoleClient,
  minimumGameState = 3,
  timeoutMs = 120_000,
): Promise<{ ready: boolean; line?: string; lastPong?: string; pongCount: number }> {
  const deadline = Date.now() + timeoutMs;
  let lastPong: string | undefined;
  let pongCount = 0;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const requestId = `navready_${Date.now().toString(36)}_${(navigationReadinessSequence++).toString(36)}`;
    const wait = vc.waitForLine(
      (line) => {
        if (!line.text.includes("[MCP] PONG")) return false;
        if (!line.text.includes(`request=${requestId}`)) return false;
        lastPong = line.text;
        pongCount++;
        const match = /\bstate=(\d+)\b/.exec(line.text);
        return !!match && Number(match[1]) >= minimumGameState;
      },
      Math.min(1500, remaining),
    );
    try {
      vc.send(`mcp_ping ${requestId}`);
    } catch {
      // A later poll may succeed while the map is still loading.
    }
    const line = await wait;
    if (line) return { ready: true, line: line.text, lastPong, pongCount };
    if (Date.now() < deadline) await sleep(250);
  }
  return { ready: false, lastPong, pongCount };
}

/** Execute route checks sequentially so each console response is correlated. */
export async function executeEngineNavigationChecks(
  vc: VConsoleClient,
  routes: readonly EngineNavigationRoute[],
  mode: EngineNavigationMode = "both",
  timeoutMs = 10_000,
): Promise<EngineNavigationExecution> {
  const validated = validateEngineNavigationRoutes(routes);
  const results: EngineNavigationRouteResult[] = [];
  const failures: EngineNavigationExecution["failures"] = [];
  const executionId = `n${Date.now().toString(36)}${(navigationExecutionSequence++).toString(36)}`;
  const responseTimeoutMs = Math.min(timeoutMs, 5_000);

  for (let routeIndex = 0; routeIndex < validated.length; routeIndex++) {
    const route = validated[routeIndex];
    const requests: {
      id: string;
      mode: "endpoints" | "segments";
      points: EngineNavigationPoint[];
      segmentOffset: number;
    }[] = [];
    let requestIndex = 0;
    if (mode !== "segments") {
      requests.push({
        id: `${executionId}_${routeIndex}_${requestIndex++}`,
        mode: "endpoints",
        points: [route.points[0], route.points[route.points.length - 1]],
        segmentOffset: 0,
      });
    }
    if (mode !== "endpoints") {
      for (let start = 0; start < route.points.length - 1; start += NAV_CHUNK_POINTS - 1) {
        requests.push({
          id: `${executionId}_${routeIndex}_${requestIndex++}`,
          mode: "segments",
          points: route.points.slice(start, Math.min(route.points.length, start + NAV_CHUNK_POINTS)),
          segmentOffset: start,
        });
      }
    }

    const failureCountBeforeRoute = failures.length;
    let endpoint: EngineNavigationRouteResult["endpoint"] = null;
    const segments: EngineNavigationRouteResult["segments"] = [];

    for (const request of requests) {
      const okMarker = `[MCP] NAV_OK ${request.id} `;
      const errorMarker = `[MCP] NAV_ERR ${request.id} `;
      const response = vc.waitForLine(
        (line) => line.text.includes(okMarker) || line.text.includes(errorMarker),
        responseTimeoutMs,
      );
      try {
        vc.send(
          buildEngineNavigationCommand(
            { name: route.name, points: request.points },
            request.mode,
            request.id,
          ),
        );
      } catch (error) {
        failures.push({ name: route.name, error: error instanceof Error ? error.message : String(error) });
        break;
      }

      const line = await response;
      if (!line) {
        failures.push({
          name: route.name,
          error: `No correlated DebugSDK response for ${request.id} within ${responseTimeoutMs}ms.`,
        });
        break;
      }
      if (line.text.includes(errorMarker)) {
        failures.push({ name: route.name, error: "DebugSDK GridNav query failed.", consoleLine: line.text });
        break;
      }

      try {
        const parsed = parseEngineNavigationResponse(line.text);
        if (parsed.requestId !== request.id) {
          throw new Error(`Expected request "${request.id}" but DebugSDK returned "${parsed.requestId}".`);
        }
        if (parsed.result.name !== route.name) {
          throw new Error(`Expected route "${route.name}" but DebugSDK returned "${parsed.result.name}".`);
        }
        if (request.mode === "endpoints") {
          if (!parsed.result.endpoint) throw new Error("DebugSDK omitted the endpoint result.");
          endpoint = parsed.result.endpoint;
        } else {
          if (parsed.result.segments.length !== request.points.length - 1) {
            throw new Error("DebugSDK returned the wrong number of segment results.");
          }
          segments.push(
            ...parsed.result.segments.map((segment, localIndex) => ({
              ...segment,
              index: request.segmentOffset + (segment.index ?? localIndex + 1),
            })),
          );
        }
      } catch (error) {
        failures.push({
          name: route.name,
          error: error instanceof Error ? error.message : String(error),
          consoleLine: line.text,
        });
        break;
      }
    }

    if (failures.length === failureCountBeforeRoute) {
      const passed = (endpoint?.passed ?? true) && segments.every((segment) => segment.passed);
      results.push({
        name: route.name,
        mode,
        pointCount: route.points.length,
        endpoint,
        segments,
        passed,
      });
    }
  }
  return { results, failures };
}
