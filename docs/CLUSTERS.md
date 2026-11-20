# Running on a cluster

[← README](../README.md)

With a cluster, the whole stack runs as Slurm jobs, driven from this computer over SSH. In the app, give the agent your SSH login command and it sets things up with you; each step that changes something on the cluster asks first.

- **One gate.** Every action on the cluster goes through one script there (`hpc/remote/gemi-gate`): a fixed menu confined to GEMI's own folder, with job size limits and a log of every call.
- **No idle jobs.** Workers stop themselves when no job needs them (GPU workers after 5 minutes, others after 20) and the cluster model after 30 minutes without a request; they start again when work arrives. Set per cluster in its `launch.conf`.
- **The cluster's own rules.** Where the administrators publish rules for AI agents, the agent reads them before any cluster action and follows them over its own defaults.
- **Updates reach every session.** A core that starts on newer code brings its database up to date by itself, after saving a copy.
- **Nothing open to other users.** Map tiles, the ODM server and the database need the session's own keys; passwords are kept off process command lines. Sharing a session with your group gives members a workers' login that changes at every core start, never your own keys.

These are speed bumps against an agent running away with shared compute without you noticing, not a wall against someone who sets out to get around them.

## From a terminal

With the repository checked out:

```bash
# once: copy hpc/clusters/launch.conf.example to hpc/clusters/<name>/launch.conf and edit it
bash hpc/gemi-hpc sync && bash hpc/gemi-hpc pull     # code and container images
bash hpc/gemi-hpc up          # start a session (database, storage, API)
bash hpc/gemi-hpc app         # tunnels + agent + app on this computer; prints the address
bash hpc/gemi-hpc llm up      # optional: an open model on a GPU
bash hpc/gemi-hpc down        # end the session
bash hpc/gemi-hpc doctor      # check the connection, the gate and the limits
```

`bash hpc/gemi-hpc` with no command lists the rest (workers, sharing a session with your group, the keeper that starts the core for the group, online storage copies). Details: [agent/SETUP.md](../agent/SETUP.md), sections 5 and 6.

## From a second computer

A laptop can use a stack that already runs elsewhere without installing Docker, images or a model. It needs this repository, Node.js (`npm install` in `frontend/`), Python 3, and an SSH key the other machine accepts. Either way the agent service runs on the laptop, so the agent can upload files from it.

- **A cluster set up from another computer.** Copy its settings (from the cluster's last sync) once, then open the app as usual:

  ```bash
  bash hpc/gemi-hpc join [-i ~/.ssh/your_key] you@cluster.example.edu /path/to/GEMI/folder/on/the/cluster [name]
  bash hpc/gemi-hpc status && bash hpc/gemi-hpc app
  ```

  Without `-i`, `join` uses the first of `~/.ssh/id_ed25519`, `id_rsa`, `id_ecdsa`. The key can be changed later in Settings → Compute (it is checked against the login before it is saved).

- **A stack running on another computer** (Docker there, or the desktop app). That computer keeps its ports on 127.0.0.1; they are forwarded over SSH, so it needs an SSH server (Remote Login on macOS, `sshd` on Linux, "OpenSSH Server" on Windows):

  ```bash
  bash scripts/dev-remote.sh you@other-computer [api_port=7777] [tiles_port=8091]
  ```
