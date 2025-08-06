# Build and Deployment Process

This document describes the automated build and deployment process for the Ambientika Local Control Home Assistant Add-on.

## Overview

The project uses GitHub Actions for automated building and deployment of Docker containers to GitHub Container Registry (GHCR). Home Assistant users install the add-on by pulling these pre-built containers.

## Repository Structure

```
ambientika-local-control-ha-addon/
├── .github/workflows/          # GitHub Actions workflows
├── ambientika-local-control/   # Main application code
│   ├── src/                   # TypeScript source code
│   ├── config.yaml            # Home Assistant add-on configuration
│   ├── run.sh                 # Container startup script
│   ├── Dockerfile            # Container build instructions
│   └── package.json          # Node.js dependencies
├── CHANGELOG.md              # Version history
└── BUILD_AND_DEPLOYMENT.md  # This file
```

## Build Process

The build is **fully automated** via GitHub Actions. Manual local building is **NOT** required.

### GitHub Actions Workflow

1. **Trigger**: Pushes to `master` branch or Git tags starting with `v`
2. **Multi-architecture builds**: Supports `aarch64` and `amd64` architectures
3. **Container registry**: Publishes to `ghcr.io/alexlenk/ambientika-local-control-ha-addon-{arch}`
4. **Automated**: No manual intervention required

## Deployment Process

### 1. Code Changes

Make changes to the TypeScript code in `ambientika-local-control/src/`

### 2. Version Update

Update version and changelog in these files:
- `ambientika-local-control/config.yaml` - Change `version: "X.X.X"`
- `CHANGELOG.md` - Add new version entry with appealing format (no starting sentence, smaller version numbers)
- `ambientika-local-control/CHANGELOG.md` - **CRITICAL**: Update the addon's internal changelog (visible in Home Assistant UI)

### 3. Commit and Push

```bash
git add .
git commit -m "v1.0.X: Descriptive Release Name

Brief description of changes

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push
```

### 4. Create Named Release Tag

**CRITICAL**: Every release must have a descriptive name and properly tagged build.

```bash
git tag -a v1.0.X -m "v1.0.X: Descriptive Release Name"
git push --tags
```

### 5. Automatic Build and Release

GitHub Actions will automatically:
- Build Docker containers for both architectures  
- Run tests and validation
- Push containers to GitHub Container Registry with version tag
- Make them available for Home Assistant installation
- **Build name appears in GitHub releases**

## Home Assistant Add-on Installation

Users install via:
1. Add custom repository: `https://github.com/alexlenk/ambientika-local-control-ha-addon`
2. Install "Ambientika Local Control" add-on
3. Home Assistant pulls the container matching the user's architecture

## Version Management

### Version Format
- Use semantic versioning: `MAJOR.MINOR.PATCH`
- Current versioning: `1.0.X` (patch releases)

### Version Files to Update
1. **`ambientika-local-control/config.yaml`**:
   ```yaml
   version: "1.0.26"
   ```

2. **`CHANGELOG.md`** (use appealing format):
   ```markdown
   ## v1.0.26 - Descriptive Release Name
   
   **Added**
   - New feature description
   
   **Fixed**  
   - Bug fix description
   
   **Changed**
   - Enhancement description
   ```

## Container Registry

**Location**: GitHub Container Registry (GHCR)
**Images**:
- `ghcr.io/alexlenk/ambientika-local-control-ha-addon-aarch64`
- `ghcr.io/alexlenk/ambientika-local-control-ha-addon-amd64`

**Access**: Public (no authentication required for pulling)

## Troubleshooting

### Build Failures
- Check GitHub Actions logs: Repository → Actions tab
- Common issues: TypeScript errors, dependency conflicts, Docker build failures

### Container Not Updating
- Verify version was updated in `config.yaml`
- Check that Git tag was pushed: `git push --tags`
- Allow 5-10 minutes for build completion

### Home Assistant Not Seeing Update
- Force refresh in Home Assistant add-on store
- Check container architecture matches device (ARM64 vs AMD64)

## Important Notes

1. **Never build locally** - Use GitHub Actions exclusively
2. **Always update version** in both `config.yaml` and `CHANGELOG.md`
3. **Always create Git tag** to trigger release build
4. **Multi-arch support** - Both ARM64 and AMD64 are built automatically
5. **Test thoroughly** before tagging - tags should represent stable releases

## Development Workflow for Claude Code Sessions

When working on this project in Claude Code, follow these **mandatory steps**:

### Release Checklist

1. **Make code changes** in `ambientika-local-control/src/`
2. **Update version** in `ambientika-local-control/config.yaml`
3. **Update root changelog** (`CHANGELOG.md`) with appealing format
4. **Update addon changelog** (`ambientika-local-control/CHANGELOG.md`) - **MANDATORY**
5. **Commit with descriptive name**: 
   ```bash
   git commit -m "v1.0.X: Descriptive Release Name"
   ```
6. **Create annotated tag with name**:
   ```bash
   git tag -a v1.0.X -m "v1.0.X: Descriptive Release Name"
   ```
7. **Push everything**: 
   ```bash
   git push && git push --tags
   ```
8. **Wait for GitHub Actions** to build and deploy (5-10 minutes)
9. **Verify release appears** in GitHub Releases with proper name

### Changelog Format Requirements

**Both changelogs** (`CHANGELOG.md` and `ambientika-local-control/CHANGELOG.md`) must follow this format:

- **NO opening sentence** - Remove "All notable changes to this project will be documented in this file"
- **Smaller version format**: `v1.0.26 - Release Name` instead of `[1.0.26]`
- **Bold section headers**: `**Added**`, `**Fixed**`, `**Changed**`
- **Descriptive release names**: Each version needs meaningful name
- **Clean formatting**: No extra spacing or complex markdown

### Every Release Must Have:
- ✅ Descriptive release name
- ✅ Updated root changelog (`CHANGELOG.md`) in new format
- ✅ Updated addon changelog (`ambientika-local-control/CHANGELOG.md`) in new format
- ✅ Annotated Git tag
- ✅ GitHub release entry (auto-generated from tag)

### Critical Notes:
- **Both changelogs** must be updated (root and addon)
- **Addon changelog** is what users see in Home Assistant UI
- **Root changelog** is for GitHub repository visitors

## Contact

For build/deployment issues:
- GitHub Issues: https://github.com/alexlenk/ambientika-local-control-ha-addon/issues
- GitHub Actions logs for detailed error information