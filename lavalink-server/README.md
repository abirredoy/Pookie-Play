# Pookie Play — standalone private Lavalink

This directory runs Lavalink separately from the GitHub Actions bot runner.

## Target design

- Oracle Cloud Always Free Ampere A1 VM (subject to account approval and regional capacity).
- Ubuntu ARM64.
- Tailscale private network between the VM and the GitHub Actions runner.
- Lavalink listens only on the VM's Tailscale IPv4 address; do not open TCP 2333 to the public internet.
- GitHub Actions bot connects to `TAILSCALE_IPV4:2333`.

## VM preparation

1. Install Docker Engine and the Docker Compose plugin using Docker's official Ubuntu instructions.
2. Install Tailscale on the VM and join the same private tailnet that the GitHub Actions runner will join.
3. Read the VM's Tailscale IPv4 address with `tailscale ip -4`.
4. In this directory, copy `.env.example` to `.env`, set `LAVALINK_BIND_IP` to that Tailscale IPv4 address, and set a newly generated long random `LAVALINK_SERVER_PASSWORD`.
5. Keep the real `.env` file private. Do not commit it or paste its contents into chat.
6. Configure the VM firewall so TCP 2333 is allowed only on the `tailscale0` interface. Keep TCP 2333 closed in the Oracle Cloud public ingress rules.
7. Start Lavalink with `docker compose up -d`.
8. Check logs with `docker compose logs -f lavalink`.

## GitHub Actions connection

After the VM and Tailscale network are ready, add these GitHub Actions repository secrets:

- `LAVALINK_HOST`: `TAILSCALE_IPV4:2333`
- `LAVALINK_PASSWORD`: the same Lavalink password used in the VM's private `.env`
- Tailscale authentication secret(s), according to the chosen GitHub Actions Tailscale authentication method.

The workflow must join the same Tailscale network before starting the bot. Set `LAVALINK_SECURE=false` because Tailscale encrypts traffic inside its WireGuard network. Do not expose Lavalink publicly.

## Important

Oracle Always Free capacity is not guaranteed in every region. Oracle documents 2 OCPUs and 12 GB RAM total for Ampere A1 Always Free, but may show an out-of-host-capacity error. Always Free instances can also be reclaimed if they meet Oracle's idle criteria. A separate VM can improve separation and uptime, but it cannot guarantee that every YouTube track will play; source-side login, bot checks, copyright restrictions, and unavailable tracks can still cause failures.
