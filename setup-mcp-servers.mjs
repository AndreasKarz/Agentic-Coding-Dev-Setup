#!/usr/bin/env node

// =============================================================================
// MCP Server Setup Script
// =============================================================================
// Installs and configures MCP (Model Context Protocol) servers globally
// for VS Code and VS Code Insiders on Windows and macOS.
//
// Usage:  node setup-mcp-servers.mjs [--dry-run] [--skip-neo4j] [--skip-neo4j-docker] [--skip-cache-warm]
//
// Options:
//   --dry-run              Show what would be done without making changes
//   --skip-neo4j           Skip downloading the neo4j-mcp binary
//   --skip-neo4j-docker    Skip starting the Neo4j Docker container
//   --skip-cache-warm      Skip pre-warming the npx cache
//
// Cross-platform: Windows 10/11 and macOS
// =============================================================================

import { execSync } from "node:child_process";
import {
	chmodSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { get as httpsGet } from "node:https";
import { arch, homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_NEO4J = process.argv.includes("--skip-neo4j");
const SKIP_NEO4J_DOCKER = process.argv.includes("--skip-neo4j-docker");
const SKIP_CACHE_WARM = process.argv.includes("--skip-cache-warm");

/** npm packages that are launched via `npx -y` (no global install needed). */
const NPX_PACKAGES = [
	"@azure-devops/mcp@latest",
	"@modelcontextprotocol/server-sequential-thinking",
	"@modelcontextprotocol/server-memory@latest",
	"mongodb-mcp-server@latest",
	"mssql-mcp-server@latest",
];

/** GitHub release info for neo4j-mcp binary */
const NEO4J_GITHUB_API =
	"https://api.github.com/repos/neo4j/mcp/releases/latest";

/** Neo4j Docker configuration */
const NEO4J_DOCKER = {
	containerName: "neo4j-mcp-server",
	image: "neo4j:community",
	httpPort: 7474,
	boltPort: 7687,
	username: "neo4j",
	password: "neo4j-mcp-local",
	// APOC plugin is required by neo4j-mcp server
	plugins: '["apoc"]',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isWindows = platform() === "win32";
const isMac = platform() === "darwin";

const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
};

function log(message) {
	console.log(`${colors.green}  ✔${colors.reset} ${message}`);
}

function logStep(message) {
	console.log(`\n${colors.cyan}${colors.bold}▸ ${message}${colors.reset}`);
}

function logWarn(message) {
	console.log(`${colors.yellow}  ⚠${colors.reset} ${message}`);
}

function logError(message) {
	console.error(`${colors.red}  ✖${colors.reset} ${message}`);
}

function logDry(message) {
	console.log(`${colors.dim}  [dry-run] ${message}${colors.reset}`);
}

// ---------------------------------------------------------------------------
// Path resolution (cross-platform)
// ---------------------------------------------------------------------------

function getVSCodeUserConfigDir(variant = "Code") {
	const home = homedir();
	if (isWindows) {
		const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
		return join(appData, variant, "User");
	}
	if (isMac) {
		return join(home, "Library", "Application Support", variant, "User");
	}
	// Linux fallback
	return join(home, ".config", variant, "User");
}

function getNeo4jInstallDir() {
	const home = homedir();
	if (isWindows) {
		const localAppData =
			process.env.LOCALAPPDATA || join(home, "AppData", "Local");
		return join(localAppData, "Programs", "neo4j-mcp");
	}
	// macOS / Linux -> ~/bin (user-local, no sudo needed)
	return join(home, "bin");
}

// ---------------------------------------------------------------------------
// neo4j-mcp binary download
// ---------------------------------------------------------------------------

function httpsGetJson(url) {
	return new Promise((resolve, reject) => {
		const options = {
			headers: { "User-Agent": "mcp-setup-script/1.0" },
		};
		httpsGet(url, options, (response) => {
			if (
				response.statusCode >= 300 &&
				response.statusCode < 400 &&
				response.headers.location
			) {
				httpsGetJson(response.headers.location).then(resolve, reject);
				return;
			}
			let data = "";
			response.on("data", (chunk) => (data += chunk));
			response.on("end", () => {
				try {
					resolve(JSON.parse(data));
				} catch (error) {
					reject(new Error(`Failed to parse JSON: ${error.message}`));
				}
			});
			response.on("error", reject);
		});
	});
}

function httpsDownload(url, destPath) {
	return new Promise((resolve, reject) => {
		const options = {
			headers: { "User-Agent": "mcp-setup-script/1.0" },
		};
		const follow = (currentUrl) => {
			httpsGet(currentUrl, options, (response) => {
				if (
					response.statusCode >= 300 &&
					response.statusCode < 400 &&
					response.headers.location
				) {
					follow(response.headers.location);
					return;
				}
				if (response.statusCode !== 200) {
					reject(
						new Error(`Download failed with status ${response.statusCode}`),
					);
					return;
				}
				const fileStream = createWriteStream(destPath);
				pipeline(response, fileStream).then(resolve, reject);
			});
		};
		follow(url);
	});
}

function getNeo4jAssetName() {
	const cpuArch = arch();
	if (isWindows) {
		const archSuffix = cpuArch === "arm64" ? "arm64" : "x86_64";
		return `neo4j-mcp_Windows_${archSuffix}.zip`;
	}
	if (isMac) {
		const archSuffix = cpuArch === "arm64" ? "arm64" : "x86_64";
		return `neo4j-mcp_Darwin_${archSuffix}.tar.gz`;
	}
	// Linux
	const archSuffix = cpuArch === "arm64" ? "arm64" : "x86_64";
	return `neo4j-mcp_Linux_${archSuffix}.tar.gz`;
}

async function installNeo4jMcp() {
	logStep("Installing neo4j-mcp binary");

	const installDir = getNeo4jInstallDir();
	const binaryName = isWindows ? "neo4j-mcp.exe" : "neo4j-mcp";
	const binaryPath = join(installDir, binaryName);

	if (existsSync(binaryPath)) {
		logWarn(`neo4j-mcp already exists at ${binaryPath} - overwriting`);
	}

	if (DRY_RUN) {
		logDry(`Would download neo4j-mcp binary to ${binaryPath}`);
		return binaryPath;
	}

	// Fetch latest release info
	log("Fetching latest release info from GitHub...");
	const releaseInfo = await httpsGetJson(NEO4J_GITHUB_API);
	const assetName = getNeo4jAssetName();
	const asset = releaseInfo.assets.find(
		(assetEntry) => assetEntry.name === assetName,
	);

	if (!asset) {
		throw new Error(
			`Could not find asset '${assetName}' in release ${releaseInfo.tag_name}`,
		);
	}

	log(`Downloading ${asset.name} (${releaseInfo.tag_name})...`);

	// Download archive
	const tempArchivePath = join(tmpdir(), asset.name);
	await httpsDownload(asset.browser_download_url, tempArchivePath);
	log(`Downloaded to ${tempArchivePath}`);

	// Create install directory
	mkdirSync(installDir, { recursive: true });

	// Extract
	if (isWindows) {
		// Use PowerShell to extract zip
		execSync(
			`powershell -NoProfile -Command "Expand-Archive -Path '${tempArchivePath}' -DestinationPath '${installDir}' -Force"`,
			{ stdio: "pipe" },
		);
	} else {
		// Use tar for .tar.gz
		execSync(`tar -xzf "${tempArchivePath}" -C "${installDir}"`, {
			stdio: "pipe",
		});
		chmodSync(binaryPath, 0o755);
	}

	// Cleanup temp file
	try {
		unlinkSync(tempArchivePath);
	} catch {
		/* ignore cleanup errors */
	}

	log(`Installed neo4j-mcp to ${binaryPath}`);

	// Check if the directory is in PATH
	const pathDirs = (process.env.PATH || "").split(isWindows ? ";" : ":");
	const isInPath = pathDirs.some(
		(directory) => directory.toLowerCase() === installDir.toLowerCase(),
	);

	if (!isInPath) {
		logWarn(
			`${installDir} is NOT in your PATH. Add it manually or use the full path.`,
		);
		if (isWindows) {
			logWarn(
				`  PowerShell: [Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";${installDir}", "User")`,
			);
		} else {
			logWarn(
				`  Add to ~/.zshrc or ~/.bashrc: export PATH="$PATH:${installDir}"`,
			);
		}
	}

	return binaryPath;
}

// ---------------------------------------------------------------------------
// Neo4j Docker container
// ---------------------------------------------------------------------------

function isDockerAvailable() {
	try {
		execSync("docker info", { stdio: "pipe", timeout: 15_000 });
		return true;
	} catch {
		return false;
	}
}

function isNeo4jContainerRunning() {
	try {
		const output = execSync(
			`docker inspect --format="{{.State.Running}}" ${NEO4J_DOCKER.containerName}`,
			{ stdio: "pipe", encoding: "utf-8" },
		).trim();
		return output === "true";
	} catch {
		return false;
	}
}

function doesNeo4jContainerExist() {
	try {
		execSync(
			`docker inspect ${NEO4J_DOCKER.containerName}`,
			{ stdio: "pipe" },
		);
		return true;
	} catch {
		return false;
	}
}

function startNeo4jDocker() {
	logStep("Setting up Neo4j Docker container");

	if (!isDockerAvailable()) {
		logError("Docker is not available. Please install Docker Desktop first.");
		logWarn("  https://www.docker.com/products/docker-desktop/");
		return false;
	}

	log("Docker is available");

	// Check if container already exists
	if (doesNeo4jContainerExist()) {
		if (isNeo4jContainerRunning()) {
			log(`Container '${NEO4J_DOCKER.containerName}' is already running`);
			return true;
		}

		// Container exists but is stopped – start it
		if (DRY_RUN) {
			logDry(`Would start existing container '${NEO4J_DOCKER.containerName}'`);
			return true;
		}

		log(`Starting existing container '${NEO4J_DOCKER.containerName}'...`);
		execSync(`docker start ${NEO4J_DOCKER.containerName}`, { stdio: "pipe" });
		log("Container started");
		return true;
	}

	// Create and start a new container
	if (DRY_RUN) {
		logDry(`Would create and start Neo4j container '${NEO4J_DOCKER.containerName}'`);
		logDry(`  Image: ${NEO4J_DOCKER.image}`);
		logDry(`  Ports: ${NEO4J_DOCKER.httpPort}:7474, ${NEO4J_DOCKER.boltPort}:7687`);
		logDry(`  Restart policy: always`);
		logDry(`  APOC plugin: enabled`);
		return true;
	}

	log(`Creating container '${NEO4J_DOCKER.containerName}'...`);

	const dockerRunCommand = [
		"docker run",
		"--detach",
		"--restart always",
		`--name ${NEO4J_DOCKER.containerName}`,
		`--publish ${NEO4J_DOCKER.httpPort}:7474`,
		`--publish ${NEO4J_DOCKER.boltPort}:7687`,
		`--env NEO4J_AUTH=${NEO4J_DOCKER.username}/${NEO4J_DOCKER.password}`,
		`--env NEO4J_PLUGINS=${isWindows ? `"${NEO4J_DOCKER.plugins.replace(/"/g, '\\"')}"` : `'${NEO4J_DOCKER.plugins}'`}`,
		"--volume neo4j-mcp-data:/data",
		"--volume neo4j-mcp-logs:/logs",
		NEO4J_DOCKER.image,
	].join(" ");

	execSync(dockerRunCommand, { stdio: "pipe" });

	log(`Container '${NEO4J_DOCKER.containerName}' created and started`);
	log(`  Neo4j Browser: http://localhost:${NEO4J_DOCKER.httpPort}`);
	log(`  Bolt URI:      bolt://localhost:${NEO4J_DOCKER.boltPort}`);
	log(`  Credentials:   ${NEO4J_DOCKER.username} / ${NEO4J_DOCKER.password}`);
	log(`  Restart policy: always (starts with Docker Desktop)`);
	log(`  APOC plugin:   enabled`);
	log(`  Data volume:   neo4j-mcp-data (persistent)`);

	return true;
}

// ---------------------------------------------------------------------------
// npx cache warming
// ---------------------------------------------------------------------------

function warmNpxCache() {
	logStep("Pre-warming npx cache (downloading packages for faster first use)");

	for (const packageName of NPX_PACKAGES) {
		if (DRY_RUN) {
			logDry(`Would pre-cache: ${packageName}`);
			continue;
		}

		try {
			log(`Caching ${packageName}...`);
			// Use npx with --yes to download and cache the package.
			// We call it with --help or a version flag that exits quickly.
			execSync(`npx -y ${packageName} --help`, {
				stdio: "pipe",
				timeout: 120_000,
				env: { ...process.env, NODE_NO_WARNINGS: "1" },
			});
			log(`Cached ${packageName}`);
		} catch {
			// Some packages don't support --help, that's OK – the download still happened
			log(`Cached ${packageName} (downloaded)`);
		}
	}
}

// ---------------------------------------------------------------------------
// mcp.json generation & merge
// ---------------------------------------------------------------------------

function buildMcpConfig(neo4jBinaryPath) {
	const neo4jCommand = neo4jBinaryPath || "neo4j-mcp";

	return {
		inputs: [
			{
				id: "ado_org",
				type: "promptString",
				description: "Azure DevOps organization name (e.g. 'myorg')",
			},
		],
		servers: {
			// ── Azure DevOps ──────────────────────────────────────────────
			"azure-devops": {
				type: "stdio",
				command: "npx",
				args: ["-y", "@azure-devops/mcp@latest", "${input:ado_org}"],
			},

			// ── Sequential Thinking ───────────────────────────────────────
			"sequential-thinking": {
				type: "stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
			},

			// ── Microsoft Learn Docs (remote HTTP – no install needed!) ──
			"microsoft-learn": {
				type: "http",
				url: "https://learn.microsoft.com/api/mcp",
			},

			// ── Knowledge Graph Memory ────────────────────────────────────
			memory: {
				type: "stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-memory@latest"],
			},

			// ── MongoDB ───────────────────────────────────────────────────
			mongodb: {
				type: "stdio",
				command: "npx",
				args: [
					"-y",
					"mongodb-mcp-server@latest",
					"--connectionString",
					"${env:MDB_MCP_CONNECTION_STRING}",
				],
			},

			// ── MSSQL ─────────────────────────────────────────────────────
			mssql: {
				type: "stdio",
				command: "npx",
				args: [
					"-y",
					"mssql-mcp-server@latest",
					"${env:MSSQL_MCP_CONNECTION_STRING}",
				],
				env: {
					MSSQL_CONNECTION_STRING: "${env:MSSQL_MCP_CONNECTION_STRING}",
				},
			},

			// ── Neo4j (native binary → local Docker container) ────────────
			neo4j: {
				type: "stdio",
				command: neo4jCommand,
				env: {
					NEO4J_URI: `bolt://localhost:${NEO4J_DOCKER.boltPort}`,
					NEO4J_USERNAME: NEO4J_DOCKER.username,
					NEO4J_PASSWORD: NEO4J_DOCKER.password,
				},
			},
		},
	};
}

function deepMerge(target, source) {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		if (
			result[key] &&
			typeof result[key] === "object" &&
			!Array.isArray(result[key]) &&
			typeof source[key] === "object" &&
			!Array.isArray(source[key])
		) {
			result[key] = deepMerge(result[key], source[key]);
		} else if (Array.isArray(result[key]) && Array.isArray(source[key])) {
			// Merge arrays by id (for inputs) – deduplicate by 'id' field
			const mergedArray = [...result[key]];
			for (const item of source[key]) {
				const existingIndex = mergedArray.findIndex(
					(existingItem) => existingItem.id && existingItem.id === item.id,
				);
				if (existingIndex >= 0) {
					mergedArray[existingIndex] = item;
				} else {
					mergedArray.push(item);
				}
			}
			result[key] = mergedArray;
		} else {
			result[key] = source[key];
		}
	}
	return result;
}

function writeMcpJson(configDir, newConfig) {
	const mcpJsonPath = join(configDir, "mcp.json");

	if (DRY_RUN) {
		logDry(`Would write/merge ${mcpJsonPath}`);
		return;
	}

	mkdirSync(configDir, { recursive: true });

	let finalConfig = newConfig;

	if (existsSync(mcpJsonPath)) {
		try {
			const existingContent = readFileSync(mcpJsonPath, "utf-8");
			const existingConfig = JSON.parse(existingContent);
			finalConfig = deepMerge(existingConfig, newConfig);
			log(`Merged with existing config at ${mcpJsonPath}`);
		} catch (parseError) {
			logWarn(
				`Could not parse existing ${mcpJsonPath} – creating backup and overwriting`,
			);
			const backupPath = `${mcpJsonPath}.backup.${Date.now()}`;
			writeFileSync(backupPath, readFileSync(mcpJsonPath));
			log(`Backup saved to ${backupPath}`);
		}
	}

	writeFileSync(mcpJsonPath, JSON.stringify(finalConfig, null, 2), "utf-8");
	log(`Written ${mcpJsonPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log(
		`\n${colors.bold}╔══════════════════════════════════════════════╗${colors.reset}`,
	);
	console.log(
		`${colors.bold}║     MCP Server Setup for VS Code             ║${colors.reset}`,
	);
	console.log(
		`${colors.bold}╚══════════════════════════════════════════════╝${colors.reset}\n`,
	);

	console.log(
		`  Platform: ${platform()} (${arch()})  |  Dry-run: ${DRY_RUN}\n`,
	);

	// ── Step 1: Pre-warm npx cache ──────────────────────────────────────────
	if (!SKIP_CACHE_WARM) {
		warmNpxCache();
	} else {
		logStep("Skipping npx cache warming (--skip-cache-warm)");
	}

	// ── Step 2: Start Neo4j Docker container ────────────────────────────────
	let neo4jDockerOk = false;
	if (!SKIP_NEO4J_DOCKER) {
		try {
			neo4jDockerOk = startNeo4jDocker();
		} catch (error) {
			logError(`Failed to start Neo4j Docker: ${error.message}`);
			logWarn("Continuing without Neo4j Docker. You can start it manually later.");
		}
	} else {
		logStep("Skipping Neo4j Docker container (--skip-neo4j-docker)");
	}

	// ── Step 3: Download neo4j-mcp binary ───────────────────────────────────
	let neo4jBinaryPath;
	if (!SKIP_NEO4J) {
		try {
			neo4jBinaryPath = await installNeo4jMcp();
		} catch (error) {
			logError(`Failed to install neo4j-mcp: ${error.message}`);
			logWarn(
				"Continuing without neo4j-mcp. You can install it manually later.",
			);
			logWarn("  Releases: https://github.com/neo4j/mcp/releases");
		}
	} else {
		logStep("Skipping neo4j-mcp download (--skip-neo4j)");
	}

	// ── Step 4: Build mcp.json config ───────────────────────────────────────
	logStep("Building MCP configuration");
	const mcpConfig = buildMcpConfig(neo4jBinaryPath);

	// Neo4j credentials are now hardcoded from the Docker setup – no input prompts needed

	log(`Configured ${Object.keys(mcpConfig.servers).length} MCP servers`);

	// ── Step 5: Write mcp.json for VS Code and VS Code Insiders ─────────────
	const variants = ["Code", "Code - Insiders"];

	for (const variant of variants) {
		logStep(`Configuring ${variant}`);
		const configDir = getVSCodeUserConfigDir(variant);
		writeMcpJson(configDir, mcpConfig);
	}

	// ── Summary ─────────────────────────────────────────────────────────────
	console.log(
		`\n${colors.bold}${colors.green}══════════════════════════════════════════════${colors.reset}`,
	);
	console.log(
		`${colors.bold}${colors.green}  Setup complete!${colors.reset}\n`,
	);
	console.log("  Configured MCP servers:");
	console.log("    1. azure-devops       (npx, stdio)");
	console.log("    2. sequential-thinking (npx, stdio)");
	console.log("    3. microsoft-learn     (remote HTTP – no install needed)");
	console.log("    4. memory              (npx, stdio)");
	console.log(
		"    5. mongodb             (npx, stdio, --connectionString via env)",
	);
	console.log(
		"    6. mssql               (npx, stdio, connection via env)",
	);
	console.log(
		`    7. neo4j               (binary${neo4jBinaryPath ? ` @ ${neo4jBinaryPath}` : " – skipped/failed"})`,
	);
	console.log(
		`       neo4j-docker        (${neo4jDockerOk ? `running → bolt://localhost:${NEO4J_DOCKER.boltPort}` : "skipped/failed"})`,
	);
	console.log("\n  Locations:");
	for (const variant of variants) {
		const configDir = getVSCodeUserConfigDir(variant);
		console.log(`    ${variant}: ${join(configDir, "mcp.json")}`);
	}

	console.log(`\n${colors.yellow}  Next steps:${colors.reset}`);
	console.log("    1. Restart VS Code / VS Code Insiders");
	console.log("    2. Open Copilot Chat in Agent Mode");
	console.log('    3. Click "Select Tools" and enable MCP servers');
	console.log(
		"    4. On first use, ADO server will prompt for organization name",
	);
	console.log(
		`    5. Neo4j Browser: http://localhost:${NEO4J_DOCKER.httpPort} (user: ${NEO4J_DOCKER.username})`,
	);
	console.log("");
}

main().catch((error) => {
	logError(`Fatal error: ${error.message}`);
	process.exit(1);
});
