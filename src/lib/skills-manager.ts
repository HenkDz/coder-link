import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string;
  model?: string;
  context?: string;
  agent?: string;
  argumentHint?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  path: string;
  location: 'personal' | 'project';
  tool: ToolWithSkills;
  frontmatter: SkillFrontmatter;
  content: string;
  files: string[];
}

export type ToolWithSkills = 'claude-code' | 'opencode';

export interface SkillLocation {
  personal: string;
  project: string;
}

const SKILL_LOCATIONS: Record<ToolWithSkills, SkillLocation> = {
  'claude-code': {
    personal: join(homedir(), '.claude', 'skills'),
    project: join(process.cwd(), '.claude', 'skills'),
  },
  opencode: {
    personal: join(homedir(), '.config', 'opencode', 'skills'),
    project: join(process.cwd(), '.opencode', 'skills'),
  },
};

const SKILL_FRONTMATTER_DEFAULTS: Partial<SkillFrontmatter> = {
  userInvocable: true,
  disableModelInvocation: false,
};

export class SkillsManager {
  private static instances: Map<ToolWithSkills, SkillsManager> = new Map();
  private tool: ToolWithSkills;
  private locations: SkillLocation;

  private constructor(tool: ToolWithSkills) {
    this.tool = tool;
    this.locations = SKILL_LOCATIONS[tool];
  }

  static getInstance(tool: ToolWithSkills): SkillsManager {
    if (!SkillsManager.instances.has(tool)) {
      SkillsManager.instances.set(tool, new SkillsManager(tool));
    }
    return SkillsManager.instances.get(tool)!;
  }

  /**
   * Get paths where skills are stored for this tool
   */
  getLocations(): SkillLocation {
    return { ...this.locations };
  }

  /**
   * List all skills for this tool (personal + project)
   */
  listSkills(): Skill[] {
    const skills: Skill[] = [];
    
    // Personal skills
    if (existsSync(this.locations.personal)) {
      const personalSkills = this.loadSkillsFromDirectory(this.locations.personal, 'personal');
      skills.push(...personalSkills);
    }

    // Project skills
    if (existsSync(this.locations.project)) {
      const projectSkills = this.loadSkillsFromDirectory(this.locations.project, 'project');
      skills.push(...projectSkills);
    }

    return skills;
  }

  /**
   * Get a specific skill by ID
   */
  getSkill(skillId: string): Skill | null {
    const skills = this.listSkills();
    return skills.find(s => s.id === skillId) || null;
  }

  /**
   * Check if a skill exists
   */
  skillExists(skillId: string, location: 'personal' | 'project'): boolean {
    const basePath = location === 'personal' ? this.locations.personal : this.locations.project;
    const skillPath = join(basePath, skillId, 'SKILL.md');
    return existsSync(skillPath);
  }

  /**
   * Create a new skill
   */
  createSkill(
    skillId: string,
    frontmatter: SkillFrontmatter,
    content: string,
    location: 'personal' | 'project' = 'personal'
  ): Skill {
    const basePath = location === 'personal' ? this.locations.personal : this.locations.project;
    const skillDir = join(basePath, skillId);
    const skillPath = join(skillDir, 'SKILL.md');

    // Validate skill name
    if (!this.isValidSkillName(skillId)) {
      throw new Error(
        `Invalid skill name "${skillId}". Must be 1-64 characters, lowercase alphanumeric with single hyphen separators.`
      );
    }

    // Check if already exists
    if (existsSync(skillPath)) {
      throw new Error(`Skill "${skillId}" already exists at ${location} level.`);
    }

    // Create directory
    mkdirSync(skillDir, { recursive: true });

    // Build SKILL.md content
    const fullContent = this.buildSkillFile(frontmatter, content);
    writeFileSync(skillPath, fullContent, 'utf-8');

    logger.logInfo(`Created skill "${skillId}" at ${skillPath}`);

    return {
      id: skillId,
      name: frontmatter.name,
      description: frontmatter.description,
      path: skillDir,
      location,
      tool: this.tool,
      frontmatter,
      content,
      files: ['SKILL.md'],
    };
  }

  /**
   * Update an existing skill
   */
  updateSkill(
    skillId: string,
    updates: { frontmatter?: Partial<SkillFrontmatter>; content?: string }
  ): Skill {
    const existing = this.getSkill(skillId);
    if (!existing) {
      throw new Error(`Skill "${skillId}" not found.`);
    }

    const skillPath = join(existing.path, 'SKILL.md');
    
    // Merge frontmatter
    const newFrontmatter: SkillFrontmatter = {
      ...existing.frontmatter,
      ...updates.frontmatter,
    };

    // Use existing content if not provided
    const newContent = updates.content !== undefined ? updates.content : existing.content;

    // Write updated file
    const fullContent = this.buildSkillFile(newFrontmatter, newContent);
    writeFileSync(skillPath, fullContent, 'utf-8');

    logger.logInfo(`Updated skill "${skillId}"`);

    return {
      ...existing,
      frontmatter: newFrontmatter,
      content: newContent,
    };
  }

  /**
   * Delete a skill
   */
  deleteSkill(skillId: string): void {
    const existing = this.getSkill(skillId);
    if (!existing) {
      throw new Error(`Skill "${skillId}" not found.`);
    }

    rmSync(existing.path, { recursive: true, force: true });
    logger.logInfo(`Deleted skill "${skillId}"`);
  }

  /**
   * Get the template for a new skill
   */
  getNewSkillTemplate(): string {
    return `---
name: my-skill
description: Describe what this skill does and when to use it
---

## What I do

Describe the skill's purpose and capabilities.

## When to use me

Explain when this skill should be invoked.

## Instructions

Provide detailed instructions for the skill.
`;
  }

  /**
   * Add a supporting file to a skill
   */
  addSkillFile(skillId: string, filename: string, content: string): void {
    const existing = this.getSkill(skillId);
    if (!existing) {
      throw new Error(`Skill "${skillId}" not found.`);
    }

    const filePath = join(existing.path, filename);
    
    // Ensure directory exists for nested paths
    const dir = join(existing.path, ...filename.split('/').slice(0, -1));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, content, 'utf-8');
    logger.logInfo(`Added file "${filename}" to skill "${skillId}"`);
  }

  /**
   * Validate a skill name follows the naming rules
   */
  isValidSkillName(name: string): boolean {
    // 1-64 characters, lowercase alphanumeric with single hyphen separators
    // Cannot start or end with hyphen, no consecutive hyphens
    const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    return name.length >= 1 && name.length <= 64 && pattern.test(name);
  }

  // -----------------------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------------------

  private loadSkillsFromDirectory(basePath: string, location: 'personal' | 'project'): Skill[] {
    const skills: Skill[] = [];

    try {
      const entries = readdirSync(basePath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = join(basePath, entry.name);
        const skillPath = join(skillDir, 'SKILL.md');

        if (!existsSync(skillPath)) continue;

        try {
          const skill = this.loadSkill(skillDir, location);
          if (skill) {
            skills.push(skill);
          }
        } catch (error) {
          logger.logError('SkillsManager.loadSkill', error);
          // Skip malformed skills
        }
      }
    } catch (error) {
      logger.logError('SkillsManager.loadSkillsFromDirectory', error);
    }

    return skills;
  }

  private loadSkill(skillDir: string, location: 'personal' | 'project'): Skill | null {
    const skillPath = join(skillDir, 'SKILL.md');
    
    if (!existsSync(skillPath)) {
      return null;
    }

    const rawContent = readFileSync(skillPath, 'utf-8');
    const { frontmatter, content } = this.parseSkillFile(rawContent);

    if (!frontmatter.name || !frontmatter.description) {
      logger.logWarn(`Skill at ${skillDir} missing required frontmatter fields`);
      return null;
    }

    // Get the skill ID from directory name
    const skillId = skillDir.split(/[/\\]/).pop() || frontmatter.name;

    // List supporting files
    const files = this.listSkillFiles(skillDir);

    return {
      id: skillId,
      name: frontmatter.name,
      description: frontmatter.description,
      path: skillDir,
      location,
      tool: this.tool,
      frontmatter,
      content,
      files,
    };
  }

  private parseSkillFile(rawContent: string): { frontmatter: SkillFrontmatter; content: string } {
    // Default frontmatter
    const defaultFrontmatter: SkillFrontmatter = {
      name: '',
      description: '',
      ...SKILL_FRONTMATTER_DEFAULTS,
    };

    // Check for YAML frontmatter
    const frontmatterMatch = rawContent.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);

    if (!frontmatterMatch) {
      // No frontmatter, use entire content
      return {
        frontmatter: { ...defaultFrontmatter, name: 'unnamed', description: 'No description' },
        content: rawContent,
      };
    }

    const yamlContent = frontmatterMatch[1];
    const content = frontmatterMatch[2];

    // Simple YAML parsing for frontmatter
    const frontmatter = this.parseSimpleYaml(yamlContent, defaultFrontmatter);

    return { frontmatter, content };
  }

  private parseSimpleYaml(yaml: string, defaults: SkillFrontmatter): SkillFrontmatter {
    const result: any = { ...defaults };
    const lines = yaml.split('\n');

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      let value: any = line.slice(colonIndex + 1).trim();

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Convert known boolean fields
      if (key === 'disableModelInvocation' || key === 'userInvocable') {
        value = value === 'true';
      }

      // Map YAML keys to frontmatter properties
      const keyMap: Record<string, keyof SkillFrontmatter> = {
        'name': 'name',
        'description': 'description',
        'license': 'license',
        'compatibility': 'compatibility',
        'disable-model-invocation': 'disableModelInvocation',
        'disableModelInvocation': 'disableModelInvocation',
        'user-invocable': 'userInvocable',
        'userInvocable': 'userInvocable',
        'allowed-tools': 'allowedTools',
        'allowedTools': 'allowedTools',
        'model': 'model',
        'context': 'context',
        'agent': 'agent',
        'argument-hint': 'argumentHint',
        'argumentHint': 'argumentHint',
      };

      const mappedKey = keyMap[key];
      if (mappedKey) {
        result[mappedKey] = value;
      }
    }

    return result as SkillFrontmatter;
  }

  private buildSkillFile(frontmatter: SkillFrontmatter, content: string): string {
    const yamlLines: string[] = ['---'];

    // Required fields
    yamlLines.push(`name: ${frontmatter.name}`);
    yamlLines.push(`description: ${frontmatter.description}`);

    // Optional fields
    if (frontmatter.license) {
      yamlLines.push(`license: ${frontmatter.license}`);
    }
    if (frontmatter.compatibility) {
      yamlLines.push(`compatibility: ${frontmatter.compatibility}`);
    }
    if (frontmatter.disableModelInvocation) {
      yamlLines.push(`disable-model-invocation: true`);
    }
    if (frontmatter.userInvocable === false) {
      yamlLines.push(`user-invocable: false`);
    }
    if (frontmatter.allowedTools) {
      yamlLines.push(`allowed-tools: ${frontmatter.allowedTools}`);
    }
    if (frontmatter.model) {
      yamlLines.push(`model: ${frontmatter.model}`);
    }
    if (frontmatter.context) {
      yamlLines.push(`context: ${frontmatter.context}`);
    }
    if (frontmatter.agent) {
      yamlLines.push(`agent: ${frontmatter.agent}`);
    }
    if (frontmatter.argumentHint) {
      yamlLines.push(`argument-hint: ${frontmatter.argumentHint}`);
    }

    yamlLines.push('---');
    yamlLines.push('');

    return yamlLines.join('\n') + content;
  }

  private listSkillFiles(skillDir: string): string[] {
    const files: string[] = [];

    const scan = (dir: string, prefix: string = '') => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            scan(join(dir, entry.name), relativePath);
          } else {
            files.push(relativePath);
          }
        }
      } catch {
        // Ignore errors
      }
    };

    scan(skillDir);
    return files;
  }
}

// Singleton getters
export const claudeCodeSkills = () => SkillsManager.getInstance('claude-code');
export const opencodeSkills = () => SkillsManager.getInstance('opencode');
