# Installing GEMI

[← README](../README.md)

Download the installer for your system from the [releases page](https://github.com/GEMINI-Breeding/GEMINI-App/releases) and open GEMI.

If macOS says the app cannot be opened, allow it under System Settings → Privacy & Security → Open Anyway.

## Where the processing runs

The heavy processing (orthomosaics, stitching, models) runs in a **processing stack**: a database, file storage and workers. GEMI needs one of these:

| Where the processing runs | What you need | Good for |
|---|---|---|
| **This computer** | [Docker Desktop](https://www.docker.com/products/docker-desktop/). GEMI downloads it and opens its installer for you (your system asks you to approve it), and starts it when it is installed but not running. On Linux it shows the terminal commands instead. | Small data sets, trying things out |
| **A cluster (HPC)** | A Slurm cluster with Apptainer that you can log in to with an SSH key (no password or two-factor prompt) | Whole fields and seasons |

Nothing has to be installed on the cluster beforehand: GEMI sets it up from this computer (see [Clusters](CLUSTERS.md)).

**On this computer, the first start** downloads GEMI's core services (about 2 GB) and opens. The processing workers (about 6 GB more) follow in the background; a job started before its worker is up waits for it. Altogether the services take about 18 GB on the drive Docker keeps its programs on. The screen where you choose the data folder shows the free space on both drives.

With an NVIDIA graphics card that Docker can use (Windows with WSL 2, or Linux with the NVIDIA container toolkit), models run on the card; otherwise on the processor.

## What GEMI installs for you

The programs a new computer may be missing can be installed from inside the app, where it asks for them (the first-run walkthrough, the Docker screen, the model setup):

| Program | Needed for | What the button does |
|---|---|---|
| **Docker Desktop** | Processing on this computer | **Windows / macOS:** downloads the official installer and opens it; your system asks you to approve it (on Windows it may also ask to restart for WSL 2). **Install Docker Desktop** becomes **Start Docker** once it is installed, and GEMI carries on when Docker is up. **Linux:** Docker needs administrator rights to install, so GEMI shows the terminal commands to copy, then notices Docker by itself. |
| **Git for Windows** | Windows only, for a cluster: the bash and ssh the cluster tools run with | Installs it for your user, silently, no administrator rights (the latest official release). Offered when you choose a cluster, and in Settings → Compute. |
| **Ollama** | An open language model on this computer, for the agent | Installs it for your user, no administrator rights: **Windows** the official installer run silently; **macOS** the app unpacked into `~/Applications`; **Linux** the official archive unpacked into `~/.local/share/gemi/ollama` (needs the `zstd` program, present on standard Ubuntu installs). Then starts it. |

Each step shows its progress and the time left. Downloads come only from docker.com, ollama.com and the Git for Windows releases on GitHub, and installs are only started by the app on the same computer. Every screen keeps a "download it yourself" link.

## First run

A short walkthrough asks three things, each changeable later in Settings:

1. **Where the processing runs**: this computer or a cluster.
2. **How you want to work**: with the agent, or by hand. By hand needs no language model; every step can be done in the app.
3. **Which model the agent uses** (only with the agent; see [The agent](AGENT.md)).

The app signs in by itself with the account of its own stack. To require a login (shared computers, several people), turn it on under Settings → Sign-in.
