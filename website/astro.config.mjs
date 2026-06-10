import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rehypeRewriteDocsLinksAndAssets } from './src/lib/docs-rewrites.mjs';

const siteBase = process.env.SITE_BASE || '/';
const normalizedBase = siteBase === '/' ? '' : siteBase.replace(/\/$/, '');
const rootPackageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);
const publicSiteVersion = process.env.PUBLIC_SITE_VERSION || rootPackageJson.version;
const mermaidScript = `
  import mermaid from '${normalizedBase}/vendor/mermaid/mermaid.esm.min.mjs';

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: prefersDark ? 'dark' : 'default',
  });

  const renderMermaid = async () => {
    const nodes = Array.from(document.querySelectorAll('.mermaid[data-mermaid-source]'));
    if (nodes.length === 0) return;
    await mermaid.run({ nodes });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderMermaid, { once: true });
  } else {
    renderMermaid();
  }
`;

function collapseSidebarGroups(items) {
  return items.map((item) => {
    if ('items' in item) {
      return {
        ...item,
        collapsed: true,
        items: collapseSidebarGroups(item.items),
      };
    }
    return item;
  });
}

export default defineConfig({
  site: 'https://hermes-switchui.zi0n.space',
  srcDir: './src',
  outDir: './dist',
  publicDir: './public',
  base: siteBase,
  vite: {
    define: {
      'import.meta.env.PUBLIC_SITE_VERSION': JSON.stringify(publicSiteVersion),
    },
    build: {
      cssMinify: false,
    },
  },
  integrations: [
    starlight({
      title: 'Hermes Switch UI',
      description: 'Documentation for Hermes Switch UI — the browser-based shell for the Hermes Agent runtime.',
      customCss: ['/src/styles/starlight-docs.css'],
      components: {
        SiteTitle: './src/components/StarlightSiteTitle.astro',
      },
      head: [
        {
          tag: 'script',
          attrs: { type: 'module' },
          content: mermaidScript,
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/Interstellar-code/hermes-switchui/edit/main/website/',
      },
      sidebar: collapseSidebarGroups([
        {
          label: 'Getting Started',
          items: [
            { label: 'Welcome', slug: 'welcome' },
            { label: 'Install', slug: 'getting-started/install' },
            { label: 'Connect a Provider', slug: 'getting-started/connecting-provider' },
            { label: 'Your First Chat', slug: 'getting-started/first-chat' },
            { label: 'Themes', slug: 'getting-started/theme' },
            { label: 'Authoring Docs', slug: 'getting-started/authoring-docs' },
          ],
        },
        {
          label: 'Core Features',
          items: [
            { label: 'Chat', slug: 'main/chat' },
            { label: 'Composer', slug: 'main/chat/composer' },
            { label: 'Sessions', slug: 'main/chat/sessions' },
            { label: 'Context Window', slug: 'main/chat/context-window' },
            { label: 'Files in Chat', slug: 'main/chat/files' },
            { label: 'Slash Commands', slug: 'main/chat/slash-commands' },
            { label: 'Keyboard Shortcuts', slug: 'main/chat/shortcuts' },
            { label: 'Dashboard', slug: 'main/dashboard' },
            { label: 'Files', slug: 'main/files' },
            { label: 'Terminal', slug: 'main/terminal' },
            { label: 'Boards', slug: 'main/boards' },
            { label: 'Jobs', slug: 'main/jobs' },
            { label: 'Tasks', slug: 'main/tasks' },
            { label: 'Conductor', slug: 'main/conductor' },
            { label: 'Operations', slug: 'main/operations' },
            { label: 'Matrix3D', slug: 'main/matrix3d' },
          ],
        },
        {
          label: 'Workflows',
          items: [
            { label: 'Overview', slug: 'main/workflows/overview' },
            { label: 'Editing', slug: 'main/workflows/editing' },
            { label: 'Running', slug: 'main/workflows/running' },
            { label: 'Output', slug: 'main/workflows/output' },
          ],
        },
        {
          label: 'Settings',
          items: [
            { label: 'Sidebar', slug: 'settings/sidebar' },
            { label: 'Preferences', slug: 'settings/preferences' },
            { label: 'Themes', slug: 'settings/themes' },
            { label: 'Profiles', slug: 'settings/profiles' },
            { label: 'Workflows Backend', slug: 'settings/workflows-backend-toggle' },
          ],
        },
        {
          label: 'Providers',
          items: [
            { label: 'Built-in Providers', slug: 'settings/providers/built-in' },
            { label: 'API Keys', slug: 'settings/providers/api-keys' },
            { label: 'Custom Endpoint', slug: 'settings/providers/custom-endpoint' },
            { label: 'Switching Models', slug: 'settings/providers/switching-models' },
          ],
        },
        {
          label: 'Skills',
          items: [
            { label: 'What are Skills', slug: 'settings/skills/what-are-skills' },
            { label: 'Installing a Skill', slug: 'settings/skills/installing-skill' },
            { label: 'Building a Skill', slug: 'settings/skills/building-skill' },
            { label: 'Skills Overview', slug: 'settings/skills' },
          ],
        },
        {
          label: 'MCP',
          items: [
            { label: 'Overview', slug: 'settings/mcp' },
            { label: 'Installing MCP Servers', slug: 'settings/mcp/installing' },
            { label: 'Connecting MCP Servers', slug: 'settings/mcp/connecting' },
          ],
        },
        {
          label: 'Plugins',
          items: [
            { label: 'Overview', slug: 'plugins/overview' },
            { label: 'A2A Fleet', slug: 'plugins/a2a-fleet' },
            { label: 'Workflow Engine', slug: 'plugins/workflow-engine' },
            { label: 'Lazy Load MCP', slug: 'plugins/lazy-load-mcp' },
            { label: 'Matrix Coder', slug: 'plugins/matrix-coder' },
          ],
        },
        {
          label: 'Knowledge',
          items: [{ label: 'Memory', slug: 'knowledge/memory' }],
        },
        {
          label: 'How-to Guides',
          items: [
            { label: 'Connect to Telegram', slug: 'how-to/connect-hermes-to-telegram-and-configure-topics' },
            { label: 'Long-term Memory with Hindsight', slug: 'how-to/give-your-agent-long-term-memory-with-hindsight' },
            { label: 'Reduce LLM Costs with Manifest', slug: 'how-to/use-the-manifest-provider-to-reduce-llm-costs' },
          ],
        },
        {
          label: 'Tips',
          items: [
            { label: 'Composer Tricks', slug: 'tips/composer-tricks' },
            { label: 'Search', slug: 'tips/search' },
            { label: 'Shortcuts', slug: 'tips/shortcuts' },
          ],
        },
        {
          label: 'Deployment',
          items: [{ label: 'Unraid', slug: 'deployment/unraid' }],
        },
        {
          label: 'Troubleshooting',
          items: [
            { label: 'Agent Connection', slug: 'troubleshooting/agent-connect' },
            { label: 'Crash Recovery', slug: 'troubleshooting/crash-recovery' },
            { label: 'Models', slug: 'troubleshooting/models' },
            { label: 'Sessions', slug: 'troubleshooting/sessions' },
            { label: 'Telegram', slug: 'troubleshooting/telegram' },
          ],
        },
        {
          label: 'FAQ',
          items: [{ label: 'FAQ', slug: 'faq' }],
        },
      ]),
    }),
  ],
  markdown: {
    rehypePlugins: [rehypeRewriteDocsLinksAndAssets],
  },
});
