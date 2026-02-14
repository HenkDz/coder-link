import inquirer from 'inquirer';
import chalk from 'chalk';
import { homedir } from 'os';
import { join } from 'path';

import { configManager } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { toolManager, type ToolName } from '../lib/tool-manager.js';
import { 
  SkillsManager, 
  type Skill, 
  type SkillFrontmatter, 
  type ToolWithSkills 
} from '../lib/skills-manager.js';

// Re-export ToolWithSkills for use in other modules
export type { ToolWithSkills } from '../lib/skills-manager.js';

import { 
  printHeader, 
  printNavigationHints, 
  planLabel, 
  toolLabel,
  truncateForTerminal 
} from '../utils/brand.js';
import { printError, printSuccess, printWarning, printInfo } from '../utils/output.js';
import { createSafeSpinner, pause } from './shared.js';

// Tools that support skills
const SKILLS_CAPABLE_TOOLS: ToolWithSkills[] = ['claude-code', 'opencode'];

function getSkillsManager(tool: ToolWithSkills): SkillsManager {
  return SkillsManager.getInstance(tool);
}

/**
 * Main skills menu for selecting a tool and managing its skills
 */
export async function skillsMenu(): Promise<void> {
  while (true) {
    console.clear();
    printHeader('Agent Skills');
    const auth = configManager.getAuth();
    printNavigationHints();

    printInfo('Skills extend AI capabilities with custom instructions and workflows.');
    console.log();
    console.log(chalk.gray('  Skills are stored in:'));
    console.log(chalk.gray('    • Personal: ~/.claude/skills/ or ~/.config/opencode/skills/'));
    console.log(chalk.gray('    • Project: ./.claude/skills/ or ./.opencode/skills/'));
    console.log();

    const choices: Array<{ name: string; value: string } | inquirer.Separator> = [];

    for (const tool of SKILLS_CAPABLE_TOOLS) {
      const manager = getSkillsManager(tool);
      const skills = manager.listSkills();
      const personalCount = skills.filter(s => s.location === 'personal').length;
      const projectCount = skills.filter(s => s.location === 'project').length;
      
      const countStr = personalCount + projectCount > 0
        ? chalk.green(` (${personalCount} personal, ${projectCount} project)`)
        : chalk.gray(' (no skills)');

      choices.push({
        name: `${toolLabel(tool)}${countStr}`,
        value: tool,
      });
    }

    choices.push(new inquirer.Separator());
    choices.push({ name: chalk.gray('← Back'), value: '__back' });

    const { selectedTool } = await inquirer.prompt<{ selectedTool: string }>([
      {
        type: 'list',
        name: 'selectedTool',
        message: 'Manage skills for:',
        choices,
      },
    ]);

    if (selectedTool === '__back') return;

    await toolSkillsMenu(selectedTool as ToolWithSkills);
  }
}

/**
 * Skills menu for a specific tool (exported for use in tool-menu)
 */
export async function toolSkillsMenu(tool: ToolWithSkills): Promise<void> {
  while (true) {
    console.clear();
    printHeader(`Skills · ${toolLabel(tool)}`);
    printNavigationHints();

    const manager = getSkillsManager(tool);
    const skills = manager.listSkills();
    const locations = manager.getLocations();

    console.log(chalk.gray('  Personal:'), locations.personal);
    console.log(chalk.gray('  Project:'), locations.project);
    console.log();

    const personalSkills = skills.filter(s => s.location === 'personal');
    const projectSkills = skills.filter(s => s.location === 'project');

    if (personalSkills.length > 0) {
      console.log(chalk.cyan('  Personal Skills:'));
      for (const skill of personalSkills) {
        const statusBadge = skill.frontmatter.disableModelInvocation 
          ? chalk.yellow(' [manual]')
          : '';
        console.log(`    • ${skill.name}${statusBadge}`);
        console.log(`      ${chalk.gray(truncateForTerminal(skill.description, 60))}`);
      }
      console.log();
    }

    if (projectSkills.length > 0) {
      console.log(chalk.cyan('  Project Skills:'));
      for (const skill of projectSkills) {
        const statusBadge = skill.frontmatter.disableModelInvocation 
          ? chalk.yellow(' [manual]')
          : '';
        console.log(`    • ${skill.name}${statusBadge}`);
        console.log(`      ${chalk.gray(truncateForTerminal(skill.description, 60))}`);
      }
      console.log();
    }

    if (skills.length === 0) {
      printInfo('No skills configured. Create one to extend the AI\'s capabilities.');
      console.log();
    }

    type SkillAction = 'create' | 'edit' | 'delete' | 'view' | '__back';
    const choices: Array<{ name: string; value: SkillAction } | inquirer.Separator> = [
      { name: '✨ Create New Skill', value: 'create' },
    ];

    if (skills.length > 0) {
      choices.push({ name: '👁 View Skill Details', value: 'view' });
      choices.push({ name: '✏️  Edit Skill', value: 'edit' });
      choices.push({ name: '🗑 Delete Skill', value: 'delete' });
    }

    choices.push(new inquirer.Separator());
    choices.push({ name: chalk.gray('← Back'), value: '__back' });

    const { action } = await inquirer.prompt<{ action: SkillAction }>([
      {
        type: 'list',
        name: 'action',
        message: 'Action:',
        choices,
      },
    ]);

    if (action === '__back') return;

    try {
      switch (action) {
        case 'create':
          await createSkillFlow(manager);
          break;
        case 'view':
          await viewSkillFlow(manager);
          break;
        case 'edit':
          await editSkillFlow(manager);
          break;
        case 'delete':
          await deleteSkillFlow(manager);
          break;
      }
    } catch (error) {
      logger.logError('skillsMenu', error);
      printError(error instanceof Error ? error.message : String(error));
      await pause();
    }
  }
}

/**
 * Flow for creating a new skill with back navigation at each step
 */
async function createSkillFlow(manager: SkillsManager): Promise<void> {
  console.log();
  printInfo('Create a new skill with a SKILL.md file.');
  console.log();

  // Step 1: Get skill ID (with cancel option)
  const { skillId, cancelStep1 } = await inquirer.prompt<{ skillId: string; cancelStep1?: boolean }>([
    {
      type: 'input',
      name: 'skillId',
      message: 'Skill ID (lowercase, hyphens only) or leave empty to cancel:',
      validate: (input: string) => {
        if (!input.trim()) return true; // Allow empty to cancel
        if (!manager.isValidSkillName(input.trim())) {
          return 'Must be lowercase alphanumeric with single hyphens (e.g., my-skill)';
        }
        return true;
      },
    },
  ]);

  if (!skillId.trim()) {
    printInfo('Cancelled');
    await pause();
    return;
  }

  const trimmedId = skillId.trim();

  // Step 2: Get location (with back option)
  const { location } = await inquirer.prompt<{ location: 'personal' | 'project' | '__back' }>([
    {
      type: 'list',
      name: 'location',
      message: 'Save to:',
      choices: [
        { name: 'Personal (~/.claude or ~/.config/opencode)', value: 'personal' },
        { name: 'Project (./.claude or ./.opencode)', value: 'project' },
        new inquirer.Separator(),
        { name: chalk.gray('← Cancel'), value: '__back' },
      ],
      default: 'personal',
    },
  ]);

  if (location === '__back') {
    printInfo('Cancelled');
    await pause();
    return;
  }

  // Check if already exists
  if (manager.skillExists(trimmedId, location)) {
    printWarning(`Skill "${trimmedId}" already exists at ${location} level.`);
    await pause();
    return;
  }

  // Step 3: Get skill name (with skip option)
  const { skillName } = await inquirer.prompt<{ skillName: string }>([
    {
      type: 'input',
      name: 'skillName',
      message: 'Display name (or press Enter to cancel):',
      default: trimmedId,
    },
  ]);

  if (!skillName.trim()) {
    printInfo('Cancelled');
    await pause();
    return;
  }

  // Step 4: Get description (with skip option)
  const { description } = await inquirer.prompt<{ description: string }>([
    {
      type: 'input',
      name: 'description',
      message: 'Description (or press Enter to cancel):',
    },
  ]);

  if (!description.trim()) {
    printInfo('Cancelled');
    await pause();
    return;
  }

  // Step 5: Get invocation options (with back option)
  const { invocationType } = await inquirer.prompt<{ invocationType: 'auto' | 'manual' | 'both' | '__cancel' }>([
    {
      type: 'list',
      name: 'invocationType',
      message: 'How should this skill be invoked?',
      choices: [
        { name: 'Automatic + Manual (AI can auto-invoke, user can also use /command)', value: 'auto' },
        { name: 'Manual only (user must invoke with /command)', value: 'manual' },
        { name: 'Hidden from menu (AI auto-loads based on description)', value: 'both' },
        new inquirer.Separator(),
        { name: chalk.gray('← Cancel'), value: '__cancel' },
      ],
      default: 'auto',
    },
  ]);

  if (invocationType === '__cancel') {
    printInfo('Cancelled');
    await pause();
    return;
  }

  // Step 6: Get template (with skip option)
  const { useTemplate } = await inquirer.prompt<{ useTemplate: boolean }>([
    {
      type: 'confirm',
      name: 'useTemplate',
      message: 'Start with a template?',
      default: true,
    },
  ]);

  let content = '';
  if (useTemplate) {
    const { template } = await inquirer.prompt<{ template: string | '__cancel' }>([
      {
        type: 'list',
        name: 'template',
        message: 'Choose a template:',
        choices: [
          { name: 'General Purpose', value: 'general' },
          { name: 'Code Review', value: 'review' },
          { name: 'Git/Commit', value: 'git' },
          { name: 'Documentation', value: 'docs' },
          { name: 'Testing', value: 'testing' },
          { name: 'Blank', value: 'blank' },
          new inquirer.Separator(),
          { name: chalk.gray('← Cancel'), value: '__cancel' },
        ],
      },
    ]);

    if (template === '__cancel') {
      printInfo('Cancelled');
      await pause();
      return;
    }

    content = getTemplateContent(template);
  }

  // Step 7: Confirm creation
  console.log();
  console.log(chalk.cyan('  Skill Summary:'));
  console.log(`    ${chalk.gray('ID:')} ${trimmedId}`);
  console.log(`    ${chalk.gray('Name:')} ${skillName}`);
  console.log(`    ${chalk.gray('Location:')} ${location}`);
  console.log(`    ${chalk.gray('Invocation:')} ${invocationType}`);
  console.log();

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'list',
      name: 'confirm',
      message: 'Create skill?',
      choices: [
        { name: '✓ Yes, create skill', value: true },
        { name: '✗ No, cancel', value: false },
      ],
      default: true,
    },
  ]);

  if (!confirm) {
    printInfo('Cancelled');
    await pause();
    return;
  }

  const frontmatter: SkillFrontmatter = {
    name: skillName,
    description,
    disableModelInvocation: invocationType === 'manual',
    userInvocable: invocationType !== 'both',
  };

  try {
    const skill = manager.createSkill(trimmedId, frontmatter, content, location);
    printSuccess(`Created skill "${skill.name}" at ${skill.path}`);
    console.log();
    printInfo(`Edit the skill file to add your instructions:`);
    console.log(chalk.gray(`  ${join(skill.path, 'SKILL.md')}`));
    await pause();
  } catch (error) {
    throw error;
  }
}

/**
 * Flow for viewing a skill
 */
async function viewSkillFlow(manager: SkillsManager): Promise<void> {
  const skills = manager.listSkills();
  
  if (skills.length === 0) {
    printWarning('No skills to view.');
    await pause();
    return;
  }

  const { skillId } = await inquirer.prompt<{ skillId: string }>([
    {
      type: 'list',
      name: 'skillId',
      message: 'Select skill to view:',
      choices: [
        ...skills.map(s => ({
          name: `${s.name} ${chalk.gray(`(${s.location})`)}`,
          value: s.id,
        })),
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' },
      ],
    },
  ]);

  if (skillId === '__back') return;

  const skill = manager.getSkill(skillId);
  if (!skill) {
    printWarning('Skill not found');
    await pause();
    return;
  }

  console.log();
  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.cyan(`  ${skill.name}`));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log();
  console.log(`${chalk.gray('ID:')} ${skill.id}`);
  console.log(`${chalk.gray('Location:')} ${skill.location}`);
  console.log(`${chalk.gray('Path:')} ${skill.path}`);
  console.log(`${chalk.gray('Description:')} ${skill.frontmatter.description}`);
  
  if (skill.frontmatter.disableModelInvocation) {
    console.log(`${chalk.gray('Invocation:')} Manual only (/command)`);
  } else if (!skill.frontmatter.userInvocable) {
    console.log(`${chalk.gray('Invocation:')} AI auto-loads (hidden from menu)`);
  } else {
    console.log(`${chalk.gray('Invocation:')} Automatic + Manual`);
  }

  if (skill.frontmatter.allowedTools) {
    console.log(`${chalk.gray('Allowed Tools:')} ${skill.frontmatter.allowedTools}`);
  }
  if (skill.frontmatter.model) {
    console.log(`${chalk.gray('Model:')} ${skill.frontmatter.model}`);
  }
  if (skill.frontmatter.context) {
    console.log(`${chalk.gray('Context:')} ${skill.frontmatter.context}`);
  }

  console.log();
  console.log(chalk.gray('Files:'));
  for (const file of skill.files) {
    console.log(`  • ${file}`);
  }

  console.log();
  console.log(chalk.cyan('Content:'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(skill.content);
  console.log(chalk.gray('─'.repeat(40)));

  await pause();
}

/**
 * Flow for editing a skill
 */
async function editSkillFlow(manager: SkillsManager): Promise<void> {
  const skills = manager.listSkills();
  
  if (skills.length === 0) {
    printWarning('No skills to edit.');
    await pause();
    return;
  }

  const { skillId } = await inquirer.prompt<{ skillId: string }>([
    {
      type: 'list',
      name: 'skillId',
      message: 'Select skill to edit:',
      choices: [
        ...skills.map(s => ({
          name: `${s.name} ${chalk.gray(`(${s.location})`)}`,
          value: s.id,
        })),
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' },
      ],
    },
  ]);

  if (skillId === '__back') return;

  const skill = manager.getSkill(skillId);
  if (!skill) {
    printWarning('Skill not found');
    await pause();
    return;
  }

  type EditAction = 'name' | 'description' | 'invocation' | 'open' | '__back';
  const { editAction } = await inquirer.prompt<{ editAction: EditAction }>([
    {
      type: 'list',
      name: 'editAction',
      message: 'What to edit:',
      choices: [
        { name: 'Display Name', value: 'name' },
        { name: 'Description', value: 'description' },
        { name: 'Invocation Type', value: 'invocation' },
        { name: '📝 Open in Editor', value: 'open' },
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' },
      ],
    },
  ]);

  if (editAction === '__back') return;

  if (editAction === 'open') {
    const skillPath = join(skill.path, 'SKILL.md');
    console.log();
    printInfo(`Skill file location: ${skillPath}`);
    console.log();
    printInfo('Open this file in your editor to make changes.');
    await pause();
    return;
  }

  const updates: { frontmatter?: Partial<SkillFrontmatter> } = {};

  switch (editAction) {
    case 'name':
      const { newName } = await inquirer.prompt<{ newName: string }>([
        {
          type: 'input',
          name: 'newName',
          message: 'New display name (or press Enter to cancel):',
          default: skill.frontmatter.name,
        },
      ]);
      if (!newName.trim()) {
        printInfo('Cancelled');
        await pause();
        return;
      }
      updates.frontmatter = { name: newName.trim() };
      break;

    case 'description':
      const { newDesc } = await inquirer.prompt<{ newDesc: string }>([
        {
          type: 'editor',
          name: 'newDesc',
          message: 'Edit description (save empty to cancel):',
          default: skill.frontmatter.description,
        },
      ]);
      if (!newDesc.trim()) {
        printInfo('Cancelled');
        await pause();
        return;
      }
      updates.frontmatter = { description: newDesc.trim() };
      break;

    case 'invocation':
      const { invocationType } = await inquirer.prompt<{ invocationType: 'auto' | 'manual' | 'both' | '__cancel' }>([
        {
          type: 'list',
          name: 'invocationType',
          message: 'How should this skill be invoked?',
          choices: [
            { name: 'Automatic + Manual', value: 'auto' },
            { name: 'Manual only', value: 'manual' },
            { name: 'Hidden from menu', value: 'both' },
            new inquirer.Separator(),
            { name: chalk.gray('← Cancel'), value: '__cancel' },
          ],
          default: skill.frontmatter.disableModelInvocation 
            ? 'manual' 
            : (!skill.frontmatter.userInvocable ? 'both' : 'auto'),
        },
      ]);
      if (invocationType === '__cancel') {
        printInfo('Cancelled');
        await pause();
        return;
      }
      updates.frontmatter = {
        disableModelInvocation: invocationType === 'manual',
        userInvocable: invocationType !== 'both',
      };
      break;
  }

  if (updates.frontmatter) {
    manager.updateSkill(skillId, updates);
    printSuccess('Skill updated');
    await pause();
  }
}

/**
 * Flow for deleting a skill
 */
async function deleteSkillFlow(manager: SkillsManager): Promise<void> {
  const skills = manager.listSkills();
  
  if (skills.length === 0) {
    printWarning('No skills to delete.');
    await pause();
    return;
  }

  const { skillId } = await inquirer.prompt<{ skillId: string }>([
    {
      type: 'list',
      name: 'skillId',
      message: 'Select skill to delete:',
      choices: [
        ...skills.map(s => ({
          name: `${s.name} ${chalk.gray(`(${s.location})`)}`,
          value: s.id,
        })),
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' },
      ],
    },
  ]);

  if (skillId === '__back') return;

  const skill = manager.getSkill(skillId);
  if (!skill) {
    printWarning('Skill not found');
    await pause();
    return;
  }

  console.log();
  printWarning(`This will permanently delete "${skill.name}" and all its files.`);
  console.log(chalk.gray(`  Path: ${skill.path}`));
  console.log();

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'list',
      name: 'confirm',
      message: 'Delete this skill?',
      choices: [
        { name: '✗ No, keep it', value: false },
        { name: chalk.red('🗑 Yes, delete permanently'), value: true },
      ],
      default: false,
    },
  ]);

  if (!confirm) {
    printInfo('Cancelled');
    await pause();
    return;
  }

  manager.deleteSkill(skillId);
  printSuccess('Skill deleted');
  await pause();
}

/**
 * Get template content for a given template type
 */
function getTemplateContent(template: string): string {
  const templates: Record<string, string> = {
    general: `## What I do

Describe what this skill does and its capabilities.

## When to use me

Explain when the AI should invoke this skill automatically.

## Instructions

1. First step
2. Second step
3. Third step

## Examples

Provide examples of expected behavior.
`,
    review: `## What I do

I review code changes for quality, security, and best practices.

## When to use me

Use this skill when reviewing pull requests, commits, or any code changes.

## Review Checklist

### Code Quality
- [ ] Code is readable and well-organized
- [ ] Functions are focused and single-purpose
- [ ] Variable and function names are descriptive
- [ ] No duplicated code

### Security
- [ ] No hardcoded secrets or credentials
- [ ] Input validation where needed
- [ ] Proper error handling

### Best Practices
- [ ] Follows project conventions
- [ ] Proper documentation for complex logic
- [ ] Tests cover new functionality

## Output Format

Provide a summary of findings with:
1. **Issues**: Critical problems that must be fixed
2. **Suggestions**: Improvements that could be made
3. **Praise**: Things done well
`,
    git: `## What I do

I help create consistent, meaningful git commits following conventional commit format.

## When to use me

Use this skill when preparing commits or writing commit messages.

## Commit Format

Follow Conventional Commits specification:

\`\`\`
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
\`\`\`

## Types

- \`feat\`: New feature
- \`fix\`: Bug fix
- \`docs\`: Documentation changes
- \`style\`: Code style changes (formatting, semicolons)
- \`refactor\`: Code refactoring
- \`test\`: Adding or updating tests
- \`chore\`: Maintenance tasks
- \`perf\`: Performance improvements

## Guidelines

1. Use imperative mood (\`add\` not \`added\`)
2. No period at the end of subject line
3. Limit subject line to 50 characters
4. Separate subject from body with blank line
5. Explain what and why, not how
`,
    docs: `## What I do

I help write clear, comprehensive documentation.

## When to use me

Use this skill when creating or updating documentation.

## Documentation Types

### README
- Project overview and purpose
- Installation instructions
- Quick start guide
- Configuration options

### API Documentation
- Clear descriptions of each function/method
- Parameters with types and defaults
- Return values and types
- Usage examples

### Tutorials
- Step-by-step instructions
- Prerequisites listed upfront
- Code examples that work

## Style Guidelines

1. **Be concise**: Get to the point quickly
2. **Use examples**: Show, don't just tell
3. **Keep updated**: Remove outdated information
4. **Structure well**: Use headers and lists effectively
`,
    testing: `## What I do

I help write comprehensive tests for code.

## When to use me

Use this skill when writing unit tests, integration tests, or end-to-end tests.

## Test Structure

Follow the AAA pattern:

\`\`\`
// Arrange: Set up test data and dependencies
// Act: Execute the code under test
// Assert: Verify the results
\`\`\`

## Best Practices

1. **One assertion per test**: Keep tests focused
2. **Descriptive names**: Test names should describe the scenario
3. **Test edge cases**: Null, empty, max, min values
4. **Keep tests isolated**: No dependencies between tests
5. **Test behavior, not implementation**: Focus on what, not how

## Coverage Areas

- [ ] Happy path (expected inputs)
- [ ] Error handling (invalid inputs)
- [ ] Edge cases (boundary conditions)
- [ ] Integration points
- [ ] Performance (if applicable)

## Example

\`\`\`typescript
describe('calculateTotal', () => {
  it('should sum positive numbers correctly', () => {
    const result = calculateTotal([1, 2, 3]);
    expect(result).toBe(6);
  });

  it('should return 0 for empty array', () => {
    const result = calculateTotal([]);
    expect(result).toBe(0);
  });
});
\`\`\`
`,
    blank: ``,
  };

  return templates[template] || templates.general;
}

/**
 * Quick function to check if a tool supports skills
 */
export function toolSupportsSkills(tool: string): tool is ToolWithSkills {
  return SKILLS_CAPABLE_TOOLS.includes(tool as ToolWithSkills);
}
