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

function luaNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Cannot encode non-finite Lua number: ${value}`);
  return Object.is(value, -0) ? "0" : String(value);
}

function luaLongString(value: string): string {
  let equals = "";
  while (value.includes(`]${equals}]`)) equals += "=";
  return `[${equals}[${value}]${equals}]`;
}

function quoteConsoleLua(code: string): string {
  return `"${code.replace(/\\/g, "\\\\").replace(/\r?\n/g, " ").replace(/"/g, "'")}"`;
}

/** Build one bounded mcp_eval command for a logical route. */
export function buildEngineNavigationCommand(
  route: EngineNavigationRoute,
  mode: EngineNavigationMode = "both",
): string {
  const [validated] = validateEngineNavigationRoutes([route]);
  const points = validated.points
    .map((point) => `Vector(${point.map(luaNumber).join(",")})`)
    .join(",");
  const includeEndpoint = mode === "endpoints" || mode === "both";
  const includeSegments = mode === "segments" || mode === "both";
  const code = [
    "(function()",
    `local pts={${points}}`,
    "local function check(a,b,i)",
    "local can=GridNav:CanFindPath(a,b)",
    "local len=GridNav:FindPathLength(a,b)",
    "local sa=GridNav:IsTraversable(a)",
    "local sb=GridNav:IsTraversable(b)",
    "return {index=i,from={a.x,a.y,a.z},to={b.x,b.y,b.z},startTraversable=sa,endTraversable=sb,canFindPath=can,pathLength=len,passed=(can and sa and sb and len>=0)}",
    "end",
    "local endpoint=check(pts[1],pts[#pts],nil)",
    "local segments={}",
    "local passed=true",
    includeEndpoint ? "if not endpoint.passed then passed=false end" : "",
    includeSegments
      ? "for i=1,#pts-1 do local row=check(pts[i],pts[i+1],i);segments[#segments+1]=row;if not row.passed then passed=false end end"
      : "",
    `return {name=${luaLongString(validated.name)},mode=${luaLongString(mode)},pointCount=#pts,endpoint=endpoint,segments=segments,passed=passed}`,
    "end)()",
  ]
    .filter(Boolean)
    .join(" ");
  const command = `mcp_eval ${quoteConsoleLua(code)}`;
  if (command.length > 24_000) {
    throw new Error(`Engine navigation command for "${route.name}" is too large; split the route.`);
  }
  return command;
}

export function parseEngineNavigationLine(line: string): EngineNavigationRouteResult {
  const marker = "[MCP] EVAL_OK ";
  const index = line.indexOf(marker);
  if (index < 0) throw new Error(`DebugSDK did not return EVAL_OK: ${line}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(index + marker.length).trim());
  } catch (error) {
    throw new Error(`DebugSDK returned invalid navigation JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = resultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`DebugSDK navigation result had the wrong shape: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return result.data;
}

/** Wait until the DebugSDK is loaded and the requested map game-state is active. */
export async function waitForEngineNavigationReady(
  vc: VConsoleClient,
  minimumGameState = 3,
  timeoutMs = 120_000,
): Promise<{ ready: boolean; line?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const wait = vc.waitForLine(
      (line) => {
        if (!line.text.includes("[MCP] PONG")) return false;
        const match = /\bstate=(\d+)\b/.exec(line.text);
        return !!match && Number(match[1]) >= minimumGameState;
      },
      Math.min(1500, remaining),
    );
    try {
      vc.send("mcp_ping");
    } catch {
      // A later poll may succeed while the map is still loading.
    }
    const line = await wait;
    if (line) return { ready: true, line: line.text };
    if (Date.now() < deadline) await sleep(250);
  }
  return { ready: false };
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
  for (const route of validated) {
    const response = vc.waitForLine(
      (line) => line.text.includes("[MCP] EVAL_OK ") || line.text.includes("[MCP] EVAL_ERR "),
      timeoutMs,
    );
    try {
      vc.send(buildEngineNavigationCommand(route, mode));
    } catch (error) {
      failures.push({ name: route.name, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const line = await response;
    if (!line) {
      failures.push({ name: route.name, error: `No DebugSDK response within ${timeoutMs}ms.` });
      continue;
    }
    if (line.text.includes("[MCP] EVAL_ERR ")) {
      failures.push({ name: route.name, error: "DebugSDK Lua evaluation failed.", consoleLine: line.text });
      continue;
    }
    try {
      const result = parseEngineNavigationLine(line.text);
      if (result.name !== route.name) {
        throw new Error(`Expected route "${route.name}" but DebugSDK returned "${result.name}".`);
      }
      results.push(result);
    } catch (error) {
      failures.push({
        name: route.name,
        error: error instanceof Error ? error.message : String(error),
        consoleLine: line.text,
      });
    }
  }
  return { results, failures };
}
