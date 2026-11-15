# 🌱 Garden Planner

A self-hosted garden layout planner for your Unraid server. Draw your plot and beds to scale, drop in crops at their real spacing, and see how many plants fit. Several people can work on the same plan at once and see each other's changes and cursors live.

## Features

- **To-scale layout** – set the plot size in feet; grid, rulers, snapping (1″ to 1 ft), zoom and pan, touch pinch-zoom.
- **170 built-in plants**: 47 vegetables, 11 herbs, 77 flowers (annuals, perennials and spring bulbs), 30 fruit trees and more, each with in-row and between-row spacing, plant family, days to maturity and sowing times. Add your own custom plants.
- **Spacing you can see** – drag a plant over an area and it fills with plants at the right spacing, each drawn as its real footprint. Plant counts update as you resize.
- **Traditional rows or square-foot** spacing per plan.
- **Beds and objects** – raised beds, in-ground beds, pots, paths, fences, trellises, trees, sheds, water and text labels.
- **Companion planting hints** – a red badge flags plants next to a bad neighbour; the side panel lists good and bad neighbours. Overlapping plantings are outlined in red.
- **Frost dates from your ZIP code**: the server works out your average last spring and first fall frost from 30 years of local daily lows (Open-Meteo, 32°F, the same 50% definition NOAA uses) and shows your USDA hardiness zone. Results are cached.
- **Planting calendar** from your last and first frost dates: start-indoors, transplant, direct-sow and harvest windows plus a dated to-do list.
- **Seed starting tracker** (Seeds tab): pulls every plant and variety from the layout with how many to sow (plus ~30% for germination losses), shows each variety's sowing window from your frost dates and flags late ones, and lets you log sown date, how many sprouted and how many were planted out. Shows germination rate overall; download as CSV.
- **Plant list** with totals per variety; download as CSV.
- **Copy for next year** – duplicate a plan with just the beds, ready for crop rotation.
- **Export** the layout as PNG or SVG, or print it.
- **Accounts** – each user has their own plans. Share a plan with other users as *editor* or *viewer*. The first account is the admin and can add or remove users, reset passwords and turn self sign-up off.
- **Live collaboration** – changes are written to SQL (SQLite) and pushed to everyone on the plan instantly via Server-Sent Events. Undo/redo is per user.

No npm packages are needed: the server uses Node 22's built-in `node:sqlite`, so the image is small and has nothing to patch.

---

## 1. Put it on GitHub

```bash
cd garden-planner
git init -b main
git add .
git commit -m "Garden Planner"
# create an empty repo called garden-planner on github.com first, then:
git remote add origin https://github.com/trev9575/garden-planner.git
git push -u origin main
```

Every push to `main` runs **.github/workflows/docker.yml**, which builds the image for amd64 and arm64 and publishes it to
`ghcr.io/trev9575/garden-planner:latest`.

> The first time it builds, open your GitHub profile → **Packages → garden-planner → Package settings** and set visibility to **Public** so Unraid can pull it without logging in.

Replace `trev9575` in `unraid/garden-planner.xml` and `docker-compose.yml` with your username.

## 2. Install on Unraid

**Option A – template (recommended)**

1. Copy `unraid/garden-planner.xml` to your flash drive at `/boot/config/plugins/dockerMan/templates-user/my-garden-planner.xml`.
2. In Unraid go to **Docker → Add Container**, choose **garden-planner** from the template list, check the port and the data path (`/mnt/user/appdata/garden-planner`), and click **Apply**.

**Option B – by hand**

Docker → Add Container:

| Field | Value |
|---|---|
| Repository | `ghcr.io/trev9575/garden-planner:latest` |
| Port | container `3000` → host `3000` (or any free port) |
| Path | container `/data` → host `/mnt/user/appdata/garden-planner` |
| Variable (optional) | `ALLOW_REGISTRATION` = `true` or `false` |

Then open `http://YOUR-UNRAID-IP:3000`. **The first account you create becomes the admin.**

## 3. Updating

Push changes to GitHub → wait for the Action to finish (a couple of minutes) → in Unraid click **Check for Updates** on the Docker tab, then **Apply update**. Your data in `/mnt/user/appdata/garden-planner` is untouched; database changes migrate automatically on start.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port inside the container |
| `DATA_DIR` | `/data` | Where `garden.db` is stored |
| `ALLOW_REGISTRATION` | `true` | Initial value for self sign-up. The admin can change it in **Account → Manage users**; that setting wins afterwards. |
| `TRUST_PROXY` | `false` | Set `true` behind Nginx Proxy Manager, SWAG or a Cloudflare tunnel so client IPs and HTTPS are detected. |
| `COOKIE_SECURE` | `false` | Set `true` if you only access the app over HTTPS. |
| `SESSION_DAYS` | `30` | How long a sign-in lasts. |

### Reverse proxy note
Live updates use Server-Sent Events. Nginx Proxy Manager works out of the box (the app sends `X-Accel-Buffering: no`). If you use a custom nginx config, make sure `proxy_buffering off;` is set for this host.

### Internet access
The ZIP lookup is the only feature that calls out to the internet (api.zippopotam.us, phzmapi.org and archive-api.open-meteo.com, all free with no key). Everything else works offline, and you can always type frost dates in by hand.

### Backups
Everything is in one SQLite file, `garden.db` (plus `-wal`/`-shm` while running). The Appdata Backup plugin covers it, or stop the container and copy the folder.

## Running locally without Docker

Needs Node.js 22.5 or newer.

```bash
npm run dev      # http://localhost:3000, data in ./data
```

## How to use

- **Plants tab** – click a plant, then click in the garden for one plant or drag to fill an area. Keep clicking/dragging to plant more; press `Esc` to stop.
- **Beds & objects tab** – click an object, then click or drag to place it.
- **Select** – click to select, drag to move, drag the handles to resize, `Shift`+click to select several, drag on empty ground to box-select.
- `Alt` while dragging turns snapping off. `Space`+drag pans. Mouse wheel zooms. `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo, `Ctrl+D` duplicate, `Ctrl+C`/`Ctrl+V` copy and paste (also between plans), arrow keys nudge.
- **Lock** a bed in the side panel so it doesn't move while you plant in it.

## Project layout

```
server.js              HTTP API, auth, live-update hub
src/db.js              SQLite schema and migrations
src/crops.js           Built-in plant library and companion data
public/                Front end (plain HTML/CSS/JS, no build step)
Dockerfile             Container image
unraid/                Unraid template
.github/workflows/     Builds and publishes the image to GHCR
```

Spacing and timing data are typical values for temperate gardens; adjust per variety in the side panel or with a custom plant.
