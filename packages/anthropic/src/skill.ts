export type ClaudeSkillDefinition = {
  name: string;
  description: string;
  body: string;
};

export function skill(
  definition: ClaudeSkillDefinition,
): ClaudeSkillDefinition {
  return Object.freeze(definition);
}
