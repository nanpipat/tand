import type { Environment } from "../types";

const variablePattern = /\{\{([^}]+)\}\}/g;

export function resolveVariables(text: string, env?: Environment | null): string {
  if (!text) return text;
  return text.replace(variablePattern, (match, variableName) => {
    const variable = env?.variables.find(
      (candidate) => candidate.key === String(variableName).trim() && candidate.enabled,
    );
    return variable ? variable.value : match;
  });
}

export function extractVariables(text: string): string[] {
  if (!text) return [];
  return [...text.matchAll(variablePattern)].map((match) => match[1].trim());
}

export function isVariableResolved(variableName: string, env?: Environment | null): boolean {
  return Boolean(env?.variables.some((variable) => variable.key === variableName && variable.enabled));
}

export function unresolvedVariables(texts: string[], env?: Environment | null): string[] {
  return [...new Set(texts.flatMap(extractVariables).filter((name) => !isVariableResolved(name, env)))];
}
