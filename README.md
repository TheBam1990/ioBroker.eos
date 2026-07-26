# ioBroker Akkudoktor EOS Adapter

This adapter installs and connects the Akkudoktor EOS energy manager from ioBroker.
EOS can be installed by the adapter after explicit user confirmation or connected as an already running external service.

German documentation is available here: [README.de.md](README.de.md).

The default mode is `Managed source/Python installation`. This mode was chosen because it works on hosts without Docker.
The adapter downloads the EOS source code, installs the required Python runtime packages into a private adapter directory and starts EOS from ioBroker.

Important: automatic EOS installation is disabled by default. A new instance does not immediately download or install EOS. Enable `Install EOS automatically` or press `commands.install` only after checking the host requirements below.

## Features

- Optional EOS installation from the official Akkudoktor EOS Git repository after user confirmation.
- Automatic pip bootstrap if the host has Python but no `pip` module.
- PEP 668 handling for Debian/Ubuntu Python installations.
- Private Python dependency directory `.iobroker-deps`; no EOS Python packages are installed into the ioBroker Node.js directory.
- Optional Docker mode using `akkudoktor/eos:latest`.
- Optional external mode for an already running EOS server.
- EOS dashboard instance link in ioBroker Admin.
- Health polling with `info.connection`.
- Raw JSON states for health, energy plan, optimization solution, predictions, measurements and resource statuses.
- Optional mapping from ioBroker states into EOS measurements.
- Custom EOS API requests for additional data points and functions that are not built into the adapter yet.
- Manual command states for install, start, stop, restart, refresh and prediction update.

## Requirements

### Recommended host size

EOS is a Python application with many scientific and web dependencies. The first managed source installation can be heavy because packages such as `numpy`, `scipy`, `pandas`, `matplotlib`, `h5py`, `fastapi` and related dependencies are downloaded and installed.

Recommended minimum for managed source mode:

| Resource | Recommendation |
| --- | --- |
| CPU | 2 cores or more |
| Memory | 2 GB RAM minimum, 4 GB RAM recommended |
| Disk space | At least 2 GB free for source, dependencies and logs |
| Network | Stable internet access to GitHub and PyPI during installation |

Very small hosts with about 1 GB RAM can install slowly, swap heavily or become temporarily unresponsive during the first installation. For weak systems, use the external mode and run EOS on a stronger host.

### Managed source mode

The ioBroker host needs:

- `git`
- `python3`
- network access to GitHub and PyPI
- enough disk space for EOS and Python dependencies

The adapter can bootstrap `pip` when `python3 -m pip` is missing.
It cannot install missing system packages such as `git` or `python3` because that would require distribution-specific root package management.

The adapter stores EOS data here by default:

```text
/opt/iobroker/iobroker-data/eos-managed
```

Inside that directory the adapter creates:

```text
.iobroker-deps/
.iobroker-requirements.txt
.iobroker-eos-installed
iobroker-eos.stdout.log
iobroker-eos.stderr.log
```

### Installation duration

The first managed source installation usually takes several minutes. On a typical small x64 VM it may take about 5 to 15 minutes. On weak hosts, slow SD cards or slow internet connections it can take 20 minutes or longer.

During this time the adapter:

1. Clones or updates the EOS Git repository.
2. Checks whether Python and pip are usable.
3. Bootstraps pip if needed.
4. Installs EOS Python dependencies into `.iobroker-deps`.
5. Writes the installation marker.
6. Starts the EOS API and dashboard if automatic start is enabled.

The adapter does not install operating system packages such as `git` or `python3`. These must already exist on the ioBroker host.

### Managed Docker mode

Docker mode needs a working `docker` command on the ioBroker host.
The adapter pulls and runs `akkudoktor/eos:latest`.

### External mode

External mode needs an EOS API server that is already reachable from ioBroker, for example:

```text
http://192.168.2.50:8503
```

## Default Ports

| Service | Default URL |
| --- | --- |
| EOS API | `http://127.0.0.1:8503` |
| EOS dashboard | `http://<ioBroker-IP>:8504` |

The Admin instance link opens the dashboard port.

## Quick Start

1. Install the adapter in ioBroker.
2. Create or start instance `eos.0`.
3. Check that the host meets the recommended size and system requirements.
4. Keep `EOS mode` set to `Managed source/Python installation` or choose Docker/external mode.
5. Enable `Install EOS automatically` if the adapter should install EOS on this host, or leave it disabled and press `eos.0.commands.install` later.
6. Keep `Start EOS automatically` enabled if EOS should start after installation and on adapter start.
7. Wait for the first installation. It can take several minutes because EOS has many Python dependencies.
8. Check `eos.0.info.connection`.
9. Open the instance link in ioBroker Admin or browse to `http://<ioBroker-IP>:8504`.

During first installation, watch:

```text
eos.0.managed.lastAction
eos.0.managed.lastProcessOutput
eos.0.info.lastError
```

When installation is complete and EOS is running, the following states should be true:

```text
eos.0.managed.installed = true
eos.0.managed.running = true
eos.0.info.connection = true
```

## Configuration

### Installation

| Setting | Description |
| --- | --- |
| `Enable adapter` | Enables the adapter logic. |
| `EOS mode` | Select `Managed source/Python installation`, `Managed Docker installation` or `External EOS server`. |
| `Install EOS automatically` | Disabled by default. Installs EOS when the managed installation is missing. Enable only after checking the host requirements. |
| `Start EOS automatically` | Starts EOS when the adapter starts. |
| `EOS Git repository` | Git repository used by managed source mode. Default: `https://github.com/Akkudoktor-EOS/EOS.git`. |
| `EOS source directory` | Directory for the managed EOS checkout and private dependency directory. |
| `Python command` | Python executable used to install and run EOS. Default: `python3`. |
| `Docker image` | Docker image used in managed Docker mode. Default: `akkudoktor/eos:latest`. |
| `Container name` | Docker container name. Default: `iobroker-eos`. |
| `Local API port` | Local API port. Default: `8503`. |
| `Local dashboard port` | Local dashboard port. Default: `8504`. |
| `External EOS API URL` | API URL used in external mode. |

### Polling

| Setting | Description |
| --- | --- |
| `Polling interval seconds` | Interval for API polling. Minimum is 10 seconds. |
| `Request timeout ms` | Timeout per HTTP request. |
| `Poll health` | Reads `/v1/health`. This determines `info.connection`. |
| `Poll energy plan` | Reads `/v1/energy-management/plan`. |
| `Poll optimization solution` | Reads `/v1/energy-management/optimization/solution`. |
| `Poll prediction keys` | Reads `/v1/prediction/keys`. |
| `Poll measurement keys` | Reads `/v1/measurement/keys`. |
| `Trigger prediction update before polling` | Calls `/v1/prediction/update` before polling. |
| `Prediction keys` | Comma or newline separated keys for `/v1/prediction/list`. |
| `Measurement keys` | Comma or newline separated keys for `/v1/measurement/series`. |

Plan and optimization endpoints can return 404 while EOS is not configured yet.
The adapter treats these as optional warnings and keeps `info.connection = true` as long as `/v1/health` is alive.

### Resource Statuses

Add resource rows when EOS resources should be polled via:

```text
/v1/resource/status?resource_id=<resourceId>&actuator_id=<actuatorId>
```

The adapter writes the raw response and flattened primitive values below:

```text
eos.0.resources.*
```

### Measurements

Measurement mappings subscribe to ioBroker states and send numeric values to EOS.
Each row needs:

| Field | Description |
| --- | --- |
| `ioBroker state` | Source state to subscribe to. |
| `EOS measurement key` | EOS measurement key to update. |

The adapter writes changes via:

```text
PUT /v1/measurement/value
```

Non-numeric values are ignored and logged.

### Custom EOS API Requests

EOS may expose more API endpoints than the adapter has built-in states for. The `Custom API` tab can be used to add these endpoints without changing the adapter code.

Each row creates states below:

```text
eos.0.custom.<id>.execute
eos.0.custom.<id>.raw
eos.0.custom.<id>.lastError
eos.0.custom.<id>.lastUpdate
```

JSON responses are also flattened into readable primitive states below `eos.0.custom.<id>.*` where possible.

| Field | Description |
| --- | --- |
| `State ID` | ioBroker-safe identifier below `custom`. |
| `Name` | Display name for the channel. |
| `Method` | HTTP method: `GET`, `POST`, `PUT`, `PATCH` or `DELETE`. |
| `API path` | EOS API path, for example `/v1/health` or `/v1/prediction/keys`. |
| `Poll GET` | Polls `GET` requests automatically on the adapter polling interval. |
| `JSON body` | Optional JSON body for non-GET requests. |

This makes it possible to expose data and functions that are also used by Home Assistant, Node-RED or the EOS dashboard, as long as the function is available through the local EOS HTTP API.

## States

### Information

| State | Meaning |
| --- | --- |
| `info.connection` | True when EOS health endpoint is reachable. |
| `info.lastError` | Last connection error or optional polling warnings. |
| `info.lastUpdate` | Timestamp of the last successful health-based polling cycle. |
| `info.installMode` | Active installation mode. |

### Managed Installation

| State | Meaning |
| --- | --- |
| `managed.enabled` | True in managed source or Docker mode. |
| `managed.installed` | True when the managed installation marker/container exists. |
| `managed.running` | True when the adapter-started EOS process/container is running. |
| `managed.image` | Docker image. |
| `managed.containerName` | Docker container name. |
| `managed.sourceDirectory` | Source installation directory. |
| `managed.dashboardUrl` | Dashboard URL from the adapter perspective. |
| `managed.lastAction` | Current or last installer/start action. |
| `managed.lastProcessOutput` | Last pip/EOS process output for troubleshooting. |

### Custom API

| State | Meaning |
| --- | --- |
| `custom.<id>.execute` | Executes the configured EOS API request. |
| `custom.<id>.raw` | Raw JSON/text response from EOS. |
| `custom.<id>.lastError` | Last request error. |
| `custom.<id>.lastUpdate` | Timestamp of the last successful request. |

### Commands

| State | Action |
| --- | --- |
| `commands.install` | Install or update managed EOS. |
| `commands.start` | Start managed EOS. |
| `commands.stop` | Stop managed EOS. |
| `commands.restart` | Restart managed EOS. |
| `commands.refresh` | Poll EOS immediately. |
| `commands.updatePredictions` | Trigger EOS prediction update and then poll. |

## Troubleshooting

### `python3: No module named pip`

The adapter tries to install pip automatically.
Progress appears in:

```text
eos.0.managed.lastAction
eos.0.managed.lastProcessOutput
```

### `externally-managed-environment`

Some Debian/Ubuntu Python installations use PEP 668.
The adapter passes `--break-system-packages` only for its user/bootstrap and target-directory installation flow.
EOS dependencies are installed into `.iobroker-deps`, not into the system Python package directory.

### `git` or `python3` missing

Install the missing system package on the ioBroker host.
The adapter cannot safely install operating system packages by itself.

### Energy plan returns HTTP 404

This is normal until EOS is configured for automatic optimization.
The adapter keeps the connection alive when `/v1/health` is reachable.

### Dashboard link does not open

Check:

```text
eos.0.managed.running
eos.0.managed.dashboardUrl
```

Also verify that the dashboard port is reachable from your browser.
The default dashboard port is `8504`.

### Reinstall managed source mode

Stop the adapter and remove the managed source directory if a clean reinstall is required:

```text
/opt/iobroker/iobroker-data/eos-managed
```

Then start the adapter again.

## Changelog

### 0.1.14

- Add signed npm release workflow, compact mode metadata and checker-compatible integration logs.

### 0.1.13

- Mark EOS as connected when health is alive and treat unconfigured plan endpoints as optional warnings.

### 0.1.12

- Bootstrap pip automatically on hosts where Python is installed without pip.

### 0.1.10

- Stream managed source installation output to `managed.lastProcessOutput`.

### 0.1.8

- Add dashboard instance link and update the adapter icon.

### 0.1.2

- Add managed source/Python installation for systems without Docker.

### 0.1.0

- Initial adapter with managed Docker installation and EOS API integration.

Older entries are stored in [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

[Older changelogs can be found there](CHANGELOG_OLD.md)

## License

MIT

Copyright (c) 2026 TheBam1990
