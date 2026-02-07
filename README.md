# Coder Link (coder-link)

A CLI that links coding tools to models from multiple providers.

## Features

- **Multi-Provider Support**: Works with GLM Coding Plan (Global/China) and Kimi 2.5
- **Interactive Wizard**: Friendly onboarding guidance on first launch
- **Tool Management**: Automatically configures CLI tools with your API credentials
- **MCP Configuration**: Easily manage Model Context Protocol services
- **Local Storage**: All settings stored securely on your machine
- **Internationalization**: Chinese and English bilingual interface

## Supported Coding Tools

- Claude Code
- OpenCode
- Crush
- Factory Droid
- Kimi (native)

## Quick Start

**Prerequisite**: Node.js 18 or later

### Install and Launch

#### Option 1: Run directly with npx

```bash
npx coder-link
```

#### Option 2: Install globally

```bash
npm install -g coder-link
coder-link
```

### Complete the Wizard

Once you enter the wizard UI, use the Up/Down arrow keys to navigate and press Enter to confirm each action, following the guided initialization flow.

The wizard will help you complete:

1. Selecting the UI language
2. Choosing the provider (GLM Coding Plan Global/China or Kimi 2.5)
3. Entering your API key
4. Selecting the tools to manage
5. Automatically configuring tools
6. Managing MCP services (optional)

## Command List

### Show help
```bash
coder-link -h
coder-link --help
```

### Show version
```bash
coder-link -v
coder-link --version
```

### Run the initialization wizard
```bash
coder-link init
```

### Language management
```bash
coder-link lang show              # Display the current language
coder-link lang set zh_CN         # Switch to Chinese
coder-link lang set en_US         # Switch to English
coder-link lang --help            # Show help for language commands
```

### API key management
```bash
coder-link auth                   # Interactively set the key
coder-link auth glm_coding_plan_global <token>    # Choose Global plan and set the key
coder-link auth glm_coding_plan_china <token>     # Choose China plan and set the key
coder-link auth kimi <token>                       # Set Kimi API key
coder-link auth revoke            # Delete the saved key
coder-link auth reload <tool>     # Load the latest config into a tool
coder-link auth --help            # Show help for auth commands
```

### Tool management
```bash
coder-link tools list             # List all supported tools and their status
coder-link tools install <tool>   # Install a coding tool
coder-link tools uninstall <tool> # Uninstall a coding tool
```

### MCP management
```bash
coder-link mcp list               # List available MCP services
coder-link mcp installed          # List installed MCP services
coder-link mcp install <service>  # Install an MCP service
coder-link mcp uninstall <service> # Uninstall an MCP service
```

### Health check
```bash
coder-link doctor                 # Inspect system configuration and tool status
```

## Configuration File

The configuration file is stored at `~/.coder-link/config.yaml`:

```yaml
lang: zh_CN                    # UI language
plan: glm_coding_plan_global   # Plan type: glm_coding_plan_global, glm_coding_plan_china, or kimi
api_key: your-api-key-here     # API key
```

## Provider Details

### GLM Coding Plan (Global)
- **Base URL**: `https://api.z.ai/api/anthropic` (Claude Code) or `https://api.z.ai/api/coding/paas/v4` (others)
- **Models**: GLM-4.7, GLM-4.6, GLM-4.5-air
- Get your API key from [Z.AI Open Platform](https://z.ai/model-api)

### GLM Coding Plan (China)
- **Base URL**: `https://open.bigmodel.cn/api/anthropic` (Claude Code) or `https://open.bigmodel.cn/api/coding/paas/v4` (others)
- **Models**: GLM-4.7, GLM-4.6, GLM-4.5-air
- Get your API key from [Z.AI Open Platform](https://z.ai/model-api)

### Kimi 2.5
- **Base URL**: `https://api.moonshot.ai/v1`
- **Models**: kimi-k2.5, kimi-k2-thinking, kimi-k2-0711-preview, etc.
- Get your API key from [Moonshot AI](https://platform.moonshot.ai/)

## How It Works

The tool uses a manager pattern where each coding tool has its own manager class that knows how to:

1. Read and write the tool's configuration file
2. Inject the appropriate API credentials and endpoints
3. Detect existing configurations
4. Manage MCP (Model Context Protocol) services

When you run `coder-link auth <plan> <token>` or use the wizard, the tool:

1. Saves your API key and plan type to `~/.coder-link/config.yaml`
2. For each selected tool, calls its manager's `loadConfig()` method
3. The manager writes the appropriate configuration to the tool's config file
4. MCP services can be installed to extend tool capabilities

## MCP Services

MCP (Model Context Protocol) allows coding tools to access external services. Built-in MCP services include:

- **filesystem**: File system operations
- **github**: GitHub integration

You can also install custom MCP services through the tool's own marketplace (Claude Code) or manually configure them.

## Development

```bash
# Clone the repository
git clone https://github.com/z-ai-org/coding-helper.git
cd coding-helper

# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev

# Lint
npm run lint
```

## Contributing

We welcome contributions! Please feel free to submit issues or pull requests.

## License

Apache License 2.0
