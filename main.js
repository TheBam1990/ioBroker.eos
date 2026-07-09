"use strict";

const { execFile } = require("node:child_process");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const nodeProcess = require("node:process");
const { promisify } = require("node:util");
const utils = require("@iobroker/adapter-core");

const execFileAsync = promisify(execFile);

class EosAdapter extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: "eos",
        });

        this.pollTimer = null;
        this.sourceProcess = null;
        this.installProcess = null;
        this.subscribedMeasurementMappings = [];

        this.on("ready", () => this.onReady());
        this.on("stateChange", (id, state) => this.onStateChange(id, state));
        this.on("unload", callback => this.onUnload(callback));
    }

    get cfg() {
        return {
            enabled: this.config.enabled !== false,
            installMode: String(this.config.installMode || "managed-docker"),
            baseUrl: String(this.config.baseUrl || "http://127.0.0.1:8503").replace(/\/+$/, ""),
            autoInstall: this.config.autoInstall !== false,
            autoStart: this.config.autoStart !== false,
            dockerImage: String(this.config.dockerImage || "akkudoktor/eos:latest"),
            dockerContainerName: String(this.config.dockerContainerName || "iobroker-eos"),
            sourceRepo: String(this.config.sourceRepo || "https://github.com/Akkudoktor-EOS/EOS.git"),
            sourceDirectory: String(this.config.sourceDirectory || "/opt/iobroker/iobroker-data/eos-managed"),
            pythonCommand: String(this.config.pythonCommand || "python3"),
            apiPort: Number(this.config.apiPort || 8503),
            dashboardPort: Number(this.config.dashboardPort || 8504),
            pollIntervalSec: Math.max(Number(this.config.pollIntervalSec || 60), 10),
            requestTimeoutMs: Math.max(Number(this.config.requestTimeoutMs || 10000), 1000),
            pollHealth: this.config.pollHealth !== false,
            pollPlan: this.config.pollPlan !== false,
            pollSolution: this.config.pollSolution !== false,
            pollPredictionKeys: this.config.pollPredictionKeys !== false,
            pollMeasurementKeys: this.config.pollMeasurementKeys !== false,
            autoUpdatePredictions: this.config.autoUpdatePredictions === true || this.config.autoUpdatePredictions === "true",
            predictionKeys: this.parseList(this.config.predictionKeys),
            measurementKeys: this.parseList(this.config.measurementKeys),
            resourceStatuses: this.parseRows(this.config.resourceStatuses),
            measurementMappings: this.parseRows(this.config.measurementMappings),
        };
    }

    async onReady() {
        await this.initObjects();
        await this.subscribeStatesAsync("commands.*");
        await this.setStateAsync("info.connection", false, true);
        await this.setStateAsync("info.lastError", "", true);

        if (!this.cfg.enabled) {
            this.log.info("EOS adapter is disabled in configuration");
            return;
        }

        try {
            await this.ensureManagedEos();
        } catch (error) {
            await this.setStateAsync("info.connection", false, true);
            await this.setStateAsync("info.lastError", error.message, true);
            this.log.error(`Managed EOS setup failed: ${error.message}`);
            if (this.cfg.installMode === "managed-docker") return;
        }
        await this.subscribeMeasurementMappings();
        await this.pollOnce();
        this.pollTimer = this.setInterval(() => void this.pollOnce(), this.cfg.pollIntervalSec * 1000);
    }

    onUnload(callback) {
        try {
            if (this.pollTimer) {
                this.clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
            if (this.sourceProcess && !this.sourceProcess.killed) {
                this.sourceProcess.kill("SIGTERM");
                this.sourceProcess = null;
            }
            if (this.installProcess && !this.installProcess.killed) {
                this.installProcess.kill("SIGTERM");
                this.installProcess = null;
            }
            callback();
        } catch {
            callback();
        }
    }

    async initObjects() {
        await this.setObjectNotExistsAsync("info", { type: "channel", common: { name: "Information" }, native: {} });
        await this.ensureState("info.connection", "Connection", "boolean", "indicator.connected", true, false);
        await this.ensureState("info.lastError", "Last error", "string", "text", true, false);
        await this.ensureState("info.lastUpdate", "Last update", "string", "date", true, false);
        await this.ensureState("info.installMode", "Installation mode", "string", "text", true, false);

        await this.setObjectNotExistsAsync("commands", { type: "channel", common: { name: "Commands" }, native: {} });
        await this.ensureState("commands.refresh", "Refresh now", "boolean", "button", true, true);
        await this.ensureState("commands.updatePredictions", "Update EOS predictions", "boolean", "button", true, true);
        await this.ensureState("commands.install", "Install managed EOS", "boolean", "button", true, true);
        await this.ensureState("commands.start", "Start managed EOS", "boolean", "button", true, true);
        await this.ensureState("commands.stop", "Stop managed EOS", "boolean", "button", true, true);
        await this.ensureState("commands.restart", "Restart managed EOS", "boolean", "button", true, true);

        await this.setObjectNotExistsAsync("managed", { type: "channel", common: { name: "Managed EOS" }, native: {} });
        await this.ensureState("managed.enabled", "Managed EOS enabled", "boolean", "indicator", true, false);
        await this.ensureState("managed.installed", "EOS container installed", "boolean", "indicator", true, false);
        await this.ensureState("managed.running", "EOS container running", "boolean", "indicator", true, false);
        await this.ensureState("managed.image", "Docker image", "string", "text", true, false);
        await this.ensureState("managed.containerName", "Docker container name", "string", "text", true, false);
        await this.ensureState("managed.sourceDirectory", "Source directory", "string", "text", true, false);
        await this.ensureState("managed.dashboardUrl", "EOS dashboard URL", "string", "text.url", true, false);
        await this.ensureState("managed.lastAction", "Last managed action", "string", "text", true, false);
        await this.ensureState("managed.lastProcessOutput", "Last EOS process output", "string", "text", true, false);

        await this.setObjectNotExistsAsync("health", { type: "channel", common: { name: "Health" }, native: {} });
        await this.ensureState("health.raw", "Raw health response", "string", "json", true, false);

        await this.setObjectNotExistsAsync("plan", { type: "channel", common: { name: "Energy management plan" }, native: {} });
        await this.ensureState("plan.raw", "Raw energy management plan", "string", "json", true, false);

        await this.setObjectNotExistsAsync("optimization", { type: "channel", common: { name: "Optimization" }, native: {} });
        await this.ensureState("optimization.solution.raw", "Raw optimization solution", "string", "json", true, false);

        await this.setObjectNotExistsAsync("predictions", { type: "channel", common: { name: "Predictions" }, native: {} });
        await this.ensureState("predictions.keys", "Available prediction keys", "string", "json", true, false);
        await this.ensureState("predictions.providers", "Available prediction providers", "string", "json", true, false);

        await this.setObjectNotExistsAsync("measurements", { type: "channel", common: { name: "Measurements" }, native: {} });
        await this.ensureState("measurements.keys", "Available measurement keys", "string", "json", true, false);

        await this.setObjectNotExistsAsync("resources", { type: "channel", common: { name: "Resources" }, native: {} });
    }

    async ensureState(id, name, type, role, read, write, unit = undefined) {
        await this.setObjectNotExistsAsync(id, {
            type: "state",
            common: {
                name,
                type,
                role,
                read,
                write,
                ...(unit ? { unit } : {}),
            },
            native: {},
        });
    }

    async pollOnce() {
        const cfg = this.cfg;
        try {
            const warnings = [];
            if (cfg.pollHealth) await this.pollJsonToState("/v1/health", "health.raw", "health");
            if (cfg.autoUpdatePredictions) await this.pollOptional(() => this.updatePredictions(), warnings);
            if (cfg.pollPlan) await this.pollOptionalJsonToState("/v1/energy-management/plan", "plan.raw", "plan", warnings);
            if (cfg.pollSolution) await this.pollOptionalJsonToState("/v1/energy-management/optimization/solution", "optimization.solution.raw", "optimization.solution", warnings);
            if (cfg.pollPredictionKeys) await this.pollOptionalJsonToState("/v1/prediction/keys", "predictions.keys", "predictions.availableKeys", warnings);
            await this.pollOptionalJsonToState("/v1/prediction/providers", "predictions.providers", "predictions.providersData", warnings);
            if (cfg.pollMeasurementKeys) await this.pollOptionalJsonToState("/v1/measurement/keys", "measurements.keys", "measurements.availableKeys", warnings);
            for (const key of cfg.predictionKeys) await this.pollOptional(() => this.pollPrediction(key), warnings);
            for (const key of cfg.measurementKeys) await this.pollOptional(() => this.pollMeasurement(key), warnings);
            for (const row of cfg.resourceStatuses) await this.pollOptional(() => this.pollResourceStatus(row), warnings);
            await this.setStateAsync("info.connection", true, true);
            await this.setStateAsync("info.lastError", warnings.join(" | "), true);
            await this.setStateAsync("info.lastUpdate", new Date().toISOString(), true);
        } catch (error) {
            await this.setStateAsync("info.connection", false, true);
            await this.setStateAsync("info.lastError", error.message, true);
            this.log.warn(`EOS polling failed: ${error.message}`);
        }
    }

    async pollOptional(fn, warnings) {
        try {
            return await fn();
        } catch (error) {
            warnings.push(error.message);
            this.log.debug(`Optional EOS polling failed: ${error.message}`);
            return null;
        }
    }

    async pollOptionalJsonToState(path, stateId, flattenRoot, warnings) {
        return this.pollOptional(async () => this.pollJsonToState(path, stateId, flattenRoot), warnings);
    }

    async ensureManagedEos() {
        const cfg = this.cfg;
        await this.setStateAsync("info.installMode", cfg.installMode, true);
        await this.setStateAsync("managed.enabled", cfg.installMode === "managed-docker" || cfg.installMode === "managed-source", true);
        await this.setStateAsync("managed.image", cfg.dockerImage, true);
        await this.setStateAsync("managed.containerName", cfg.dockerContainerName, true);
        await this.setStateAsync("managed.sourceDirectory", cfg.sourceDirectory, true);
        await this.setStateAsync("managed.dashboardUrl", `http://127.0.0.1:${cfg.dashboardPort}`, true);
        if (cfg.installMode === "managed-source") {
            this.config.baseUrl = `http://127.0.0.1:${cfg.apiPort}`;
            await this.refreshManagedStatus();
            const installed = (await this.getStateAsync("managed.installed"))?.val === true;
            const running = (await this.getStateAsync("managed.running"))?.val === true;
            if (!installed && cfg.autoInstall) await this.installManagedSource();
            if (!running && cfg.autoStart) await this.startManagedSource();
            await this.refreshManagedStatus();
            if (cfg.autoStart) await this.waitForManagedHealth();
            return;
        }
        if (cfg.installMode !== "managed-docker") return;

        this.config.baseUrl = `http://127.0.0.1:${cfg.apiPort}`;
        await this.refreshManagedStatus();
        const installed = (await this.getStateAsync("managed.installed"))?.val === true;
        const running = (await this.getStateAsync("managed.running"))?.val === true;

        if (!installed && cfg.autoInstall) await this.installManagedDocker();
        if (!running && cfg.autoStart) await this.startManagedDocker();
        await this.refreshManagedStatus();
        if (cfg.autoStart) await this.waitForManagedHealth();
    }

    async refreshManagedStatus() {
        const cfg = this.cfg;
        if (cfg.installMode === "managed-source") {
            const installed = await this.fileExists(path.join(cfg.sourceDirectory, ".iobroker-eos-installed"));
            await this.setStateAsync("managed.installed", installed, true);
            await this.setStateAsync("managed.running", Boolean(this.sourceProcess && !this.sourceProcess.killed), true);
            return;
        }
        if (cfg.installMode !== "managed-docker") {
            await this.setStateAsync("managed.installed", false, true);
            await this.setStateAsync("managed.running", false, true);
            return;
        }
        try {
            const { stdout } = await this.runCommand("docker", ["inspect", cfg.dockerContainerName]);
            const info = JSON.parse(stdout);
            const running = Boolean(info?.[0]?.State?.Running);
            await this.setStateAsync("managed.installed", true, true);
            await this.setStateAsync("managed.running", running, true);
        } catch {
            await this.setStateAsync("managed.installed", false, true);
            await this.setStateAsync("managed.running", false, true);
        }
    }

    async installManagedDocker() {
        const cfg = this.cfg;
        await this.setStateAsync("managed.lastAction", `Pulling ${cfg.dockerImage}`, true);
        this.log.info(`Pulling EOS Docker image ${cfg.dockerImage}`);
        await this.runCommand("docker", ["pull", cfg.dockerImage], 10 * 60 * 1000);

        await this.setStateAsync("managed.lastAction", `Creating ${cfg.dockerContainerName}`, true);
        this.log.info(`Creating EOS Docker container ${cfg.dockerContainerName}`);
        await this.runCommand("docker", [
            "run",
            "-d",
            "--name",
            cfg.dockerContainerName,
            "-p",
            `${cfg.apiPort}:8503`,
            "-p",
            `${cfg.dashboardPort}:8504`,
            "-e",
            "OPENBLAS_NUM_THREADS=1",
            "-e",
            "OMP_NUM_THREADS=1",
            "-e",
            "MKL_NUM_THREADS=1",
            "-e",
            "EOS_SERVER__HOST=0.0.0.0",
            "-e",
            "EOS_SERVER__EOSDASH_HOST=0.0.0.0",
            "-e",
            `EOS_SERVER__EOSDASH_PORT=8504`,
            "--restart",
            "unless-stopped",
            cfg.dockerImage,
        ], 60 * 1000);
        await this.setStateAsync("managed.lastAction", "Installed", true);
    }

    async startManagedDocker() {
        const cfg = this.cfg;
        await this.refreshManagedStatus();
        const installed = (await this.getStateAsync("managed.installed"))?.val === true;
        if (!installed) {
            if (!cfg.autoInstall) throw new Error("Managed EOS is not installed and autoInstall is disabled");
            await this.installManagedDocker();
            return;
        }
        await this.setStateAsync("managed.lastAction", "Starting container", true);
        await this.runCommand("docker", ["start", cfg.dockerContainerName]);
    }

    async stopManagedDocker() {
        const cfg = this.cfg;
        await this.setStateAsync("managed.lastAction", "Stopping container", true);
        await this.runCommand("docker", ["stop", cfg.dockerContainerName]);
        await this.refreshManagedStatus();
    }

    async stopManagedSource() {
        await this.setStateAsync("managed.lastAction", "Stopping EOS source server", true);
        if (this.sourceProcess && !this.sourceProcess.killed) {
            this.sourceProcess.kill("SIGTERM");
            this.sourceProcess = null;
        }
        await this.setStateAsync("managed.running", false, true);
    }

    async restartManagedDocker() {
        const cfg = this.cfg;
        await this.setStateAsync("managed.lastAction", "Restarting container", true);
        await this.runCommand("docker", ["restart", cfg.dockerContainerName]);
        await this.refreshManagedStatus();
        await this.waitForManagedHealth();
    }

    async installManagedSource() {
        const cfg = this.cfg;
        await this.setStateAsync("managed.lastAction", `Preparing source directory ${cfg.sourceDirectory}`, true);
        await fs.mkdir(path.dirname(cfg.sourceDirectory), { recursive: true });

        if (!(await this.fileExists(path.join(cfg.sourceDirectory, "pyproject.toml")))) {
            await this.setStateAsync("managed.lastAction", `Cloning ${cfg.sourceRepo}`, true);
            await this.runCommand("git", ["clone", "--depth", "1", cfg.sourceRepo, cfg.sourceDirectory], 10 * 60 * 1000);
        } else {
            await this.setStateAsync("managed.lastAction", "Updating EOS source", true);
            await this.runCommand("git", ["-C", cfg.sourceDirectory, "pull", "--ff-only"], 10 * 60 * 1000);
        }

        const versionFile = path.join(cfg.sourceDirectory, "version.txt");
        if (!(await this.fileExists(versionFile))) await fs.writeFile(versionFile, "0.0.0\n");

        await this.ensurePythonPip(cfg);

        await this.setStateAsync("managed.lastAction", "Reading EOS Python dependencies", true);
        const requirements = await this.readSourceRequirements(cfg.sourceDirectory, cfg.pythonCommand);
        await fs.writeFile(path.join(cfg.sourceDirectory, ".iobroker-requirements.txt"), `${requirements.join("\n")}\n`);

        await this.setStateAsync("managed.lastAction", "Installing EOS Python dependencies", true);
        await fs.rm(path.join(cfg.sourceDirectory, ".iobroker-deps"), { recursive: true, force: true });
        await this.runStreamingCommand(cfg.pythonCommand, [
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--break-system-packages",
            "--progress-bar",
            "off",
            "--upgrade",
            "--prefer-binary",
            "--target",
            ".iobroker-deps",
            "-r",
            ".iobroker-requirements.txt",
        ], 30 * 60 * 1000, cfg.sourceDirectory, "pip install");
        await fs.writeFile(path.join(cfg.sourceDirectory, ".iobroker-eos-installed"), new Date().toISOString());
        await this.setStateAsync("managed.lastAction", "Installed from source", true);
    }

    async ensurePythonPip(cfg) {
        await this.setStateAsync("managed.lastAction", "Checking Python pip", true);
        try {
            await this.runCommand(cfg.pythonCommand, ["-m", "pip", "--version"], 30000, cfg.sourceDirectory);
            return;
        } catch {
            // Continue with bootstrapping below.
        }

        await this.setStateAsync("managed.lastAction", "Bootstrapping Python pip with ensurepip", true);
        try {
            await this.runCommand(cfg.pythonCommand, ["-m", "ensurepip", "--user", "--upgrade"], 5 * 60 * 1000, cfg.sourceDirectory);
            await this.runCommand(cfg.pythonCommand, ["-m", "pip", "--version"], 30000, cfg.sourceDirectory);
            return;
        } catch (ensureError) {
            await this.setStateAsync("managed.lastProcessOutput", `ensurepip failed: ${ensureError.message}`, true);
        }

        await this.setStateAsync("managed.lastAction", "Bootstrapping Python pip with get-pip.py", true);
        const getPipScript = "import urllib.request; exec(urllib.request.urlopen('https://bootstrap.pypa.io/get-pip.py', timeout=60).read())";
        await this.runStreamingCommand(cfg.pythonCommand, ["-c", getPipScript, "--user", "--break-system-packages"], 10 * 60 * 1000, cfg.sourceDirectory, "get-pip.py");
        await this.runCommand(cfg.pythonCommand, ["-m", "pip", "--version"], 30000, cfg.sourceDirectory);
    }

    async readSourceRequirements(sourceDirectory, pythonCommand) {
        const script = "import pathlib, tomllib; data=tomllib.loads(pathlib.Path('pyproject.toml').read_text()); print('\\n'.join(data['project']['dependencies']))";
        const { stdout } = await this.runCommand(pythonCommand, ["-c", script], 30000, sourceDirectory);
        const requirements = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (!requirements.length) throw new Error("No EOS dependencies found in pyproject.toml");
        return requirements;
    }

    async startManagedSource() {
        const cfg = this.cfg;
        await this.refreshManagedStatus();
        const installed = (await this.getStateAsync("managed.installed"))?.val === true;
        if (!installed) {
            if (!cfg.autoInstall) throw new Error("Managed EOS source is not installed and autoInstall is disabled");
            await this.installManagedSource();
        }
        if (this.sourceProcess && !this.sourceProcess.killed) return;

        const python = cfg.pythonCommand;
        await this.setStateAsync("managed.lastAction", "Starting EOS source server", true);
        const stdoutLog = path.join(cfg.sourceDirectory, "iobroker-eos.stdout.log");
        const stderrLog = path.join(cfg.sourceDirectory, "iobroker-eos.stderr.log");
        const stdoutHandle = await fs.open(stdoutLog, "a");
        const stderrHandle = await fs.open(stderrLog, "a");
        this.sourceProcess = spawn(python, [
            "-m",
            "akkudoktoreos.server.eos",
            "--host",
            "0.0.0.0",
            "--port",
            String(cfg.apiPort),
            "--log_level",
            "info",
            "--startup_eosdash",
            "true",
        ], {
            cwd: cfg.sourceDirectory,
            env: {
                ...nodeProcess.env,
                EOS_DIR: cfg.sourceDirectory,
                EOS_SERVER__HOST: "0.0.0.0",
                EOS_SERVER__PORT: String(cfg.apiPort),
                EOS_SERVER__EOSDASH_HOST: "0.0.0.0",
                EOS_SERVER__EOSDASH_PORT: String(cfg.dashboardPort),
                PYTHONPATH: [
                    path.join(cfg.sourceDirectory, ".iobroker-deps"),
                    path.join(cfg.sourceDirectory, "src"),
                    nodeProcess.env.PYTHONPATH || "",
                ].filter(Boolean).join(path.delimiter),
            },
            stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
        });
        this.sourceProcess.on("error", error => {
            void this.setStateAsync("managed.lastProcessOutput", error.message, true);
            void this.setStateAsync("managed.lastAction", `EOS source process error: ${error.message}`, true);
        });
        this.sourceProcess.on("exit", async code => {
            await stdoutHandle.close().catch(() => {});
            await stderrHandle.close().catch(() => {});
            await this.captureSourceProcessLog(stdoutLog, stderrLog);
            this.log.warn(`EOS source process exited with code ${code}`);
            this.sourceProcess = null;
            void this.setStateAsync("managed.running", false, true);
            void this.setStateAsync("managed.lastAction", `EOS source process exited with code ${code}`, true);
        });
        await this.setStateAsync("managed.running", true, true);
    }

    async captureSourceProcessLog(stdoutLog, stderrLog) {
        const stderr = await this.readTail(stderrLog);
        const stdout = await this.readTail(stdoutLog);
        const text = `${stderr}\n${stdout}`.trim();
        if (!text) return;
        this.log.warn(`[EOS] ${text}`);
        await this.setStateAsync("managed.lastProcessOutput", text.slice(-5000), true);
    }

    async readTail(filename) {
        try {
            const content = await fs.readFile(filename, "utf8");
            return content.slice(-5000);
        } catch {
            return "";
        }
    }

    async waitForManagedHealth() {
        for (let attempt = 1; attempt <= 30; attempt++) {
            try {
                await this.requestJson("GET", "/v1/health");
                await this.setStateAsync("managed.running", true, true);
                return;
            } catch (error) {
                if (attempt === 30) throw error;
                await this.delay(2000);
            }
        }
    }

    async runCommand(command, args, timeout = 120000, cwd = undefined) {
        try {
            return await execFileAsync(command, args, {
                timeout,
                cwd,
                maxBuffer: 1024 * 1024 * 10,
            });
        } catch (error) {
            const stderr = error.stderr ? String(error.stderr).trim() : "";
            const stdout = error.stdout ? String(error.stdout).trim() : "";
            throw new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout || error.message}`);
        }
    }

    async runStreamingCommand(command, args, timeout, cwd, label) {
        return new Promise((resolve, reject) => {
            let output = "";
            let finished = false;
            const append = data => {
                output = `${output}${String(data)}`.slice(-5000);
            };
            const publish = () => {
                if (output.trim()) void this.setStateAsync("managed.lastProcessOutput", output.trim(), true);
            };
            const timer = this.setTimeout(() => {
                if (finished) return;
                finished = true;
                if (this.installProcess && !this.installProcess.killed) this.installProcess.kill("SIGTERM");
                publish();
                reject(new Error(`${label} timed out after ${timeout} ms`));
            }, timeout);
            const publishTimer = this.setInterval(publish, 5000);

            this.installProcess = spawn(command, args, {
                cwd,
                env: nodeProcess.env,
                stdio: ["ignore", "pipe", "pipe"],
            });
            this.installProcess.stdout.on("data", append);
            this.installProcess.stderr.on("data", append);
            this.installProcess.on("error", error => {
                if (finished) return;
                finished = true;
                this.clearTimeout(timer);
                this.clearInterval(publishTimer);
                this.installProcess = null;
                publish();
                reject(error);
            });
            this.installProcess.on("close", code => {
                if (finished) return;
                finished = true;
                this.clearTimeout(timer);
                this.clearInterval(publishTimer);
                this.installProcess = null;
                publish();
                if (code === 0) resolve();
                else reject(new Error(`${label} failed with exit code ${code}: ${output.trim().slice(-1000)}`));
            });
        });
    }

    delay(ms) {
        return new Promise(resolve => this.setTimeout(resolve, ms));
    }

    async fileExists(filename) {
        try {
            await fs.access(filename);
            return true;
        } catch {
            return false;
        }
    }

    async pollJsonToState(path, stateId, flattenRoot) {
        const data = await this.requestJson("GET", path);
        await this.setStateAsync(stateId, JSON.stringify(data), true);
        await this.writeFlattened(flattenRoot, data);
        return data;
    }

    async pollPrediction(key) {
        const safeKey = this.safeId(key);
        await this.setObjectNotExistsAsync(`predictions.${safeKey}`, { type: "channel", common: { name: key }, native: { key } });
        await this.ensureState(`predictions.${safeKey}.list`, `Prediction list ${key}`, "string", "json", true, false);
        const data = await this.requestJson("GET", `/v1/prediction/list?key=${encodeURIComponent(key)}`);
        await this.setStateAsync(`predictions.${safeKey}.list`, JSON.stringify(data), true);
        const firstValue = this.firstNumericValue(data);
        if (firstValue !== null) {
            await this.ensureState(`predictions.${safeKey}.nextValue`, `Next prediction value ${key}`, "number", "value", true, false);
            await this.setStateAsync(`predictions.${safeKey}.nextValue`, firstValue, true);
        }
    }

    async pollMeasurement(key) {
        const safeKey = this.safeId(key);
        await this.setObjectNotExistsAsync(`measurements.${safeKey}`, { type: "channel", common: { name: key }, native: { key } });
        await this.ensureState(`measurements.${safeKey}.series`, `Measurement series ${key}`, "string", "json", true, false);
        const data = await this.requestJson("GET", `/v1/measurement/series?key=${encodeURIComponent(key)}`);
        await this.setStateAsync(`measurements.${safeKey}.series`, JSON.stringify(data), true);
        const firstValue = this.firstNumericValue(data);
        if (firstValue !== null) {
            await this.ensureState(`measurements.${safeKey}.latestValue`, `Latest measurement value ${key}`, "number", "value", true, false);
            await this.setStateAsync(`measurements.${safeKey}.latestValue`, firstValue, true);
        }
    }

    async pollResourceStatus(row) {
        if (!row || row.enabled === false || row.enabled === "false" || !row.resourceId) return;
        const resourceId = String(row.resourceId).trim();
        const actuatorId = String(row.actuatorId || "").trim();
        const id = this.safeId(`${resourceId}${actuatorId ? `_${actuatorId}` : ""}`);
        const query = new URLSearchParams({ resource_id: resourceId });
        if (actuatorId) query.set("actuator_id", actuatorId);
        const data = await this.requestJson("GET", `/v1/resource/status?${query.toString()}`);
        await this.setObjectNotExistsAsync(`resources.${id}`, { type: "channel", common: { name: `${resourceId}${actuatorId ? ` / ${actuatorId}` : ""}` }, native: { resourceId, actuatorId } });
        await this.ensureState(`resources.${id}.raw`, "Raw resource status", "string", "json", true, false);
        await this.setStateAsync(`resources.${id}.raw`, JSON.stringify(data), true);
        await this.writeFlattened(`resources.${id}`, data);
    }

    async updatePredictions() {
        await this.requestJson("POST", "/v1/prediction/update");
    }

    async onStateChange(id, state) {
        if (!state || state.ack || !this.cfg.enabled) return;

        if (id === `${this.namespace}.commands.refresh`) {
            await this.setStateAsync("commands.refresh", false, true);
            await this.pollOnce();
            return;
        }
        if (id === `${this.namespace}.commands.updatePredictions`) {
            await this.setStateAsync("commands.updatePredictions", false, true);
            await this.updatePredictions();
            await this.pollOnce();
            return;
        }
        if (id === `${this.namespace}.commands.install`) {
            await this.setStateAsync("commands.install", false, true);
            if (this.cfg.installMode === "managed-source") await this.installManagedSource();
            else await this.installManagedDocker();
            await this.refreshManagedStatus();
            return;
        }
        if (id === `${this.namespace}.commands.start`) {
            await this.setStateAsync("commands.start", false, true);
            if (this.cfg.installMode === "managed-source") await this.startManagedSource();
            else await this.startManagedDocker();
            await this.refreshManagedStatus();
            return;
        }
        if (id === `${this.namespace}.commands.stop`) {
            await this.setStateAsync("commands.stop", false, true);
            if (this.cfg.installMode === "managed-source") await this.stopManagedSource();
            else await this.stopManagedDocker();
            return;
        }
        if (id === `${this.namespace}.commands.restart`) {
            await this.setStateAsync("commands.restart", false, true);
            if (this.cfg.installMode === "managed-source") {
                if (this.sourceProcess && !this.sourceProcess.killed) this.sourceProcess.kill("SIGTERM");
                this.sourceProcess = null;
                await this.startManagedSource();
                await this.waitForManagedHealth();
            } else {
                await this.restartManagedDocker();
            }
            return;
        }

        for (const mapping of this.subscribedMeasurementMappings) {
            if (id === mapping.source) {
                await this.writeMeasurementValue(mapping, state.val);
            }
        }
    }

    async subscribeMeasurementMappings() {
        this.subscribedMeasurementMappings = [];
        for (const row of this.cfg.measurementMappings) {
            if (!row || row.enabled === false || row.enabled === "false") continue;
            const source = String(row.source || "").trim();
            const key = String(row.key || "").trim();
            if (!source || !key) continue;
            const mapping = { source, key };
            this.subscribedMeasurementMappings.push(mapping);
            await this.subscribeForeignStatesAsync(source);
            this.log.info(`EOS measurement mapping active: ${source} -> ${key}`);
        }
    }

    async writeMeasurementValue(mapping, value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            this.log.warn(`Cannot send non-numeric value from ${mapping.source} to EOS measurement ${mapping.key}`);
            return;
        }
        const query = new URLSearchParams({
            datetime: new Date().toISOString(),
            key: mapping.key,
            value: String(numericValue),
        });
        await this.requestJson("PUT", `/v1/measurement/value?${query.toString()}`);
        this.log.debug(`Sent EOS measurement ${mapping.key}=${numericValue}`);
    }

    async requestJson(method, path, body = undefined) {
        const controller = new AbortController();
        const timeout = this.setTimeout(() => controller.abort(), this.cfg.requestTimeoutMs);
        const url = `${this.cfg.baseUrl}${path}`;
        try {
            const response = await fetch(url, {
                method,
                headers: body === undefined ? undefined : { "content-type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal,
            });
            const text = await response.text();
            if (!response.ok) throw new Error(`${method} ${url} failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
            if (!text) return {};
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }
        } finally {
            this.clearTimeout(timeout);
        }
    }

    async writeFlattened(root, value) {
        const entries = [];
        this.collectFlattened(root, value, entries, 0);
        for (const entry of entries.slice(0, 250)) {
            await this.ensureState(entry.id, entry.name, entry.type, entry.role, true, false);
            await this.setStateAsync(entry.id, entry.value, true);
        }
    }

    collectFlattened(prefix, value, entries, depth) {
        if (depth > 4 || value === null || value === undefined) return;
        if (Array.isArray(value)) {
            if (value.length > 0 && typeof value[0] !== "object") {
                entries.push(this.flatEntry(prefix, prefix, JSON.stringify(value)));
            }
            return;
        }
        if (typeof value === "object") {
            for (const [key, child] of Object.entries(value)) {
                const id = `${prefix}.${this.safeId(key)}`;
                if (child !== null && typeof child === "object") this.collectFlattened(id, child, entries, depth + 1);
                else entries.push(this.flatEntry(id, key, child));
            }
            return;
        }
        entries.push(this.flatEntry(prefix, prefix, value));
    }

    flatEntry(id, name, value) {
        if (typeof value === "boolean") return { id, name, value, type: "boolean", role: "indicator" };
        if (typeof value === "number") return { id, name, value, type: "number", role: "value" };
        return { id, name, value: value === undefined || value === null ? "" : String(value), type: "string", role: "text" };
    }

    firstNumericValue(data) {
        if (typeof data === "number" && Number.isFinite(data)) return data;
        if (Array.isArray(data)) {
            for (const item of data) {
                const value = this.firstNumericValue(item);
                if (value !== null) return value;
            }
            return null;
        }
        if (data && typeof data === "object") {
            for (const value of Object.values(data)) {
                const result = this.firstNumericValue(value);
                if (result !== null) return result;
            }
        }
        return null;
    }

    parseList(value) {
        if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
        return String(value || "")
            .split(/\r?\n|,/)
            .map(item => item.trim())
            .filter(Boolean);
    }

    parseRows(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        try {
            const parsed = JSON.parse(String(value));
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    safeId(value) {
        return String(value || "value")
            .trim()
            .replace(/[^a-zA-Z0-9_-]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 80) || "value";
    }
}

if (require.main !== module) {
    module.exports = options => new EosAdapter(options);
} else {
    new EosAdapter();
}
