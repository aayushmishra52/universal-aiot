/**
 * Secret scanning for `aiot-sdk test` step 1: make sure no credentials leak
 * into files that are (or could be) committed.
 */
import { readFileSync } from "node:fs";

export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  excerpt: string;
}

const PATTERNS: { name: string; regex: RegExp }[] = [
  {
    name: "password assignment",
    regex: /(password|passwd|pwd|mqtt[_-]?pass|wifi[_-]?pass)\s*[:=]\s*["'][^"']{3,}["']/i,
  },
  {
    name: "secret/token assignment",
    regex: /(secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["'][^"']{6,}["']/i,
  },
  {
    name: "private key block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    name: "AWS-style secret",
    regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
];

const SKIP_FILES = new Set(["config/config.h", "config.h"]);

/**
 * Scan file contents for secrets. Files whose relative path is in SKIP_FILES
 * (the gitignored real-secrets header) are skipped by design.
 */
export function scanContent(relativePath: string, content: string): SecretFinding[] {
  if (SKIP_FILES.has(relativePath)) return [];
  const findings: SecretFinding[] = [];
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    for (const p of PATTERNS) {
      if (p.regex.test(line)) {
        findings.push({
          file: relativePath,
          line: idx + 1,
          pattern: p.name,
          excerpt: line.trim().slice(0, 120),
        });
        break;
      }
    }
  });
  return findings;
}

export function scanFiles(files: { path: string; relativePath: string }[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const f of files) {
    try {
      findings.push(...scanContent(f.relativePath, readFileSync(f.path, "utf8")));
    } catch {
      /* unreadable (binary) — skip */
    }
  }
  return findings;
}
