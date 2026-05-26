# Hermes Switch UI — Landing & Docs Workspace

Welcome to the official web repository for the **Hermes Switch UI** landing site and documentation portal.

Hermes Switch UI is a browser-based, terminal-native shell for the **Hermes Agent** runtime—enabling chat streams, terminal session management, local file browsing, memory inspection, and skill authoring directly on your own machine.

---

## 🏗️ Architecture at a Glance

The workspace operates as two paired local processes:
- **Hermes Switch UI (Port 3000)**: The front-end user interface built using [Astro](https://astro.build) and optimized with a futuristic, responsive Matrix-dark aesthetic.
- **Hermes Agent (Port 8642)**: The backend gateway handle that connects to AI providers, persistent local files, and Model Context Protocol (MCP) server endpoints.

---

## ⚡ Key Features

- **Integrated Welcome Docs**: An interactive documentation portal hosted directly at `/docs/welcome` outlining architecture workflows and platform capability degradation.
- **Core App Previews**: High-fidelity CSS/HTML interactive mockup of the active streaming chat and console structure.
- **Resource Optimized Matrix Hero**: Smooth, flicker-free GPU-friendly canvas-drawn digital rain hero header for an immersive visual experience.
- **Zero-Dependency Core**: Configured for static compile formats with directory indexing supported natively by Apache/Nginx.

---

## 🛠️ Local Development

### 1. Installation
Install project dependencies:
```bash
npm install
```

### 2. Run Dev Server
Launch the local Astro development server:
```bash
npm run dev
```
Open `http://localhost:3000` inside your browser to interact with the environment.

### 3. Production Compilation
Compile a optimized static build of the website:
```bash
npm run build
```
The static pages, directory indexes, and CSS modules will be outputted directly inside the `./dist/` directory.

---

## 🚀 Virtualmin / Apache Deployment

This project is configured to run fully static, requiring **no server-side Node.js or SSR processes** to host.

1. Compile the website using `npm run build`.
2. Extract or upload the contents of the generated `dist/` directory directly into your Virtualmin domain's main public root folder:
   ```bash
   /home/<virtualmin_username>/public_html/
   ```
3. Ensure directory structures are preserved (so that `docs/welcome/index.html` resolves clean pretty URLs like `domain.com/docs/welcome` under Apache).

---

## 📄 Version & Changelog

- Current Version: `v2.3.0` stable.
- Complete feature adjustments and historical fixes can be reviewed in the [CHANGELOG.md](./CHANGELOG.md).
