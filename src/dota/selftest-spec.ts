import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { pathExists } from "../util/fsx.js";

const selftestSpecSchema = z
  .object({
    map: z.string().min(1).optional(),
    setupCommands: z.array(z.string()).optional(),
    commands: z.array(z.string()).optional(),
    asserts: z.array(z.string()).optional(),
    setupGameState: z.number().int().min(1).max(9).optional(),
    readyGameState: z.number().int().min(1).max(9).optional(),
    readyAssert: z.string().min(1).optional(),
    readyTimeoutMs: z.number().int().min(1000).max(180000).optional(),
    errorWindowMs: z.number().int().min(0).max(60000).optional(),
    screenshot: z.boolean().optional(),
  })
  .strict();

export type SelftestSpec = z.infer<typeof selftestSpecSchema>;

export interface ResolvedSelftestSpec {
  path: string;
  spec: SelftestSpec;
}

/**
 * Load a project's reusable smoke-test recipe.
 *
 * The default file is optional so existing projects keep working. An explicit
 * file is treated as required and produces a useful error when missing.
 */
export async function loadSelftestSpec(
  projectRoot: string,
  specFile?: string,
): Promise<ResolvedSelftestSpec | undefined> {
  const path = specFile
    ? isAbsolute(specFile)
      ? specFile
      : join(projectRoot, specFile)
    : join(projectRoot, ".dota-workshop", "selftest.json");

  if (!(await pathExists(path))) {
    if (specFile) throw new Error(`Self-test recipe not found: ${path}`);
    return undefined;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new Error(`Could not parse self-test recipe ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const parsed = selftestSpecSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid self-test recipe ${path}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return { path, spec: parsed.data };
}
