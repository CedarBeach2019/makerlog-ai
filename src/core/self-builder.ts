/**
 * @file src/core/self-builder.ts
 * @description The agent that builds itself — reads its own code, identifies improvements, and generates patches.
 */

// --- Interfaces ---

/**
 * Represents a potential improvement to the codebase.
 */
export interface Improvement {
  id: string;
  type: 'bug' | 'feature' | 'refactor' | 'perf' | 'docs';
  file: string;
  description: string;
  priority: number; // 1-10, 10 is highest
  code: string; // The suggested code change or patch content
  applied: boolean;
}

/**
 * Represents a collection of improvements to be applied.
 */
export interface BuildPlan {
  id: string;
  improvements: Improvement[];
  totalScore: number;
  estimatedImpact: string; // e.g., 'low', 'medium', 'high'
  createdAt: number;
}

/**
 * A minimal interface for a file manager dependency to handle I/O.
 */
export interface FileManager {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

// --- SelfBuilder Class ---

/**
 * The SelfBuilder agent analyzes code, suggests improvements, and manages their application.
 */
export class SelfBuilder {
  private improvements: Improvement[] = [];
  private plans: BuildPlan[] = [];
  private fileManager: FileManager;

  constructor(fileManager: FileManager) {
    this.fileManager = fileManager;
  }

  /**
   * Analyzes file content to find potential improvements based on a set of heuristics.
   * @param fileContent The content of the file to analyze.
   * @param fileName The name/path of the file.
   * @returns An array of found improvements.
   */
  public analyze(fileContent: string, fileName: string): Improvement[] {
    const found: Improvement[] = [];
    const lines = fileContent.split('\n');

    // Heuristic: Functions > 50 lines
    // This is a simplified check and may not be perfectly accurate for all function styles.
    const functionRegex = /^(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(|const\s+\w+\s*=\s*(?:async\s*)?\(/;
    let funcStart = -1;
    let braceCount = 0;
    for (let i = 0; i < lines.length; i++) {
        if (functionRegex.test(lines[i])) {
            funcStart = i;
        }
        if (funcStart !== -1) {
            braceCount += (lines[i].match(/{/g) || []).length;
            braceCount -= (lines[i].match(/}/g) || []).length;
            if (braceCount === 0 && i > funcStart) {
                const lineCount = i - funcStart + 1;
                if (lineCount > 50) {
                    found.push(this.createImprovement('refactor', fileName, `Function starting on line ${funcStart + 1} is too long (${lineCount} lines). Consider splitting it.`, 6));
                }
                funcStart = -1;
            }
        }
    }

    // Heuristic: Deep nesting (>3 levels)
    let maxDepth = 0;
    let currentDepth = 0;
    lines.forEach(line => {
        const indent = line.match(/^\s*/)?.[0].length || 0;
        currentDepth = Math.floor(indent / 2); // Assuming 2-space indentation
        if (currentDepth > maxDepth) maxDepth = currentDepth;
    });
    if (maxDepth > 3) {
        found.push(this.createImprovement('refactor', fileName, `Deep nesting detected (depth ${maxDepth}). Consider using early returns.`, 7));
    }

    lines.forEach((line, i) => {
      // Heuristic: Missing types (any)
      if (/\s*:\s*any\b|\bany\s*\[\]/.test(line)) {
        found.push(this.createImprovement('refactor', fileName, `Use of 'any' type on line ${i + 1}. Use a specific type.`, 5));
      }
      // Heuristic: Long parameter lists (>5)
      const paramsMatch = line.match(/\(([^)]*)\)/);
      if (paramsMatch && paramsMatch[1].split(',').length > 5) {
        found.push(this.createImprovement('refactor', fileName, `Long parameter list on line ${i + 1}. Consider an options object.`, 4));
      }
      // Heuristic: Magic numbers
      if (/[=,\[(]\s*(-?\d+)\s*[;,\])]/.test(line) && !line.includes('const') && !/for\s*\(/.test(line)) {
        const num = line.match(/[=,\[(]\s*(-?\d+)\s*[;,\])]/)?.[1];
        if (num &&