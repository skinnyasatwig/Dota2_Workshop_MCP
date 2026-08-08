import { createHash } from "node:crypto";

export interface OfflineAcceptanceArtifactIntegrity {
  algorithm: "sha256";
  byteLength: number;
  sha256: string;
}

export interface OfflineAcceptanceArtifactVerification {
  ok: boolean;
  actual: OfflineAcceptanceArtifactIntegrity;
  findings: string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Build deterministic integrity evidence for a saved acceptance artifact. */
export function describeOfflineAcceptanceArtifact(
  data: Uint8Array,
): OfflineAcceptanceArtifactIntegrity {
  return {
    algorithm: "sha256",
    byteLength: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

/** Fail closed when saved metadata is absent, malformed, or does not match the bytes. */
export function verifyOfflineAcceptanceArtifact(
  data: Uint8Array,
  expected: unknown,
): OfflineAcceptanceArtifactVerification {
  const actual = describeOfflineAcceptanceArtifact(data);
  const value = record(expected);
  const findings: string[] = [];
  if (!value) {
    findings.push("Artifact integrity metadata is missing or malformed.");
    return { ok: false, actual, findings };
  }
  if (value.algorithm !== "sha256") findings.push("Artifact integrity algorithm must be sha256.");
  if (!Number.isInteger(value.byteLength) || Number(value.byteLength) < 0) {
    findings.push("Artifact byteLength must be a non-negative integer.");
  } else if (Number(value.byteLength) !== actual.byteLength) {
    findings.push(`Artifact byte length differs: expected ${value.byteLength}, found ${actual.byteLength}.`);
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    findings.push("Artifact sha256 must be a lowercase 64-character hexadecimal digest.");
  } else if (value.sha256 !== actual.sha256) {
    findings.push(`Artifact SHA-256 differs: expected ${value.sha256}, found ${actual.sha256}.`);
  }
  return { ok: findings.length === 0, actual, findings };
}
