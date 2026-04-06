// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'AgentLint',
  tagline: '33 checks for AI-ready repos. Every one backed by data.',
  url: 'https://docs.agentlint.app',
  baseUrl: '/',
  organizationName: '0xmariowu',
  projectName: 'AgentLint',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  trailingSlash: false,

  presets: [
    [
      '@docusaurus/preset-classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          path: 'content',
          editUrl: 'https://github.com/0xmariowu/AgentLint/edit/main/docs/content/',
        },
        blog: false,
        theme: {
          customCss: './src/styles/custom.scss',
        },
      }),
    ],
  ],

  plugins: ['docusaurus-plugin-sass'],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      metadata: [
        { name: 'og:image', content: 'https://docs.agentlint.app/img/report-example.png' },
        { name: 'og:type', content: 'website' },
        { name: 'og:site_name', content: 'AgentLint Docs' },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
      navbar: {
        hideOnScroll: true,
        logo: {
          alt: 'AgentLint',
          src: '/logos/agentlint-dark.svg',
          srcDark: '/logos/agentlint-light.svg',
          href: '/',
          target: '_self',
          width: 139,
          height: 28,
        },
        items: [
          {
            type: 'doc',
            docId: 'intro',
            label: 'Docs',
            position: 'left',
          },
          {
            type: 'doc',
            docId: 'checks',
            label: 'Checks',
            position: 'left',
          },
          {
            type: 'doc',
            docId: 'scoring',
            label: 'Scoring',
            position: 'left',
          },
          {
            type: 'doc',
            docId: 'changelog',
            label: 'Changelog',
            position: 'left',
          },
          {
            type: 'html',
            position: 'right',
            value: '<div class="separator" aria-hidden></div>',
          },
          {
            href: 'https://www.agentlint.app',
            label: 'Website',
            position: 'right',
          },
          {
            href: 'https://github.com/0xmariowu/AgentLint',
            position: 'right',
            className: 'icon-link icon-link-mask icon-link-github',
            'aria-label': 'GitHub repository',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              { label: 'Introduction', to: '/' },
              { label: 'Check Reference', to: '/checks' },
              { label: 'Scoring Algorithm', to: '/scoring' },
            ],
          },
          {
            title: 'Project',
            items: [
              { label: 'Contributing', to: '/contributing' },
              { label: 'Security Policy', to: '/security' },
              { label: 'Changelog', to: '/changelog' },
            ],
          },
          {
            title: 'Community',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/0xmariowu/AgentLint',
              },
              {
                label: 'Issues',
                href: 'https://github.com/0xmariowu/AgentLint/issues',
              },
              {
                label: 'npm',
                href: 'https://www.npmjs.com/package/@0xmariowu/agent-lint',
              },
            ],
          },
        ],
        copyright: 'AgentLint — MIT License',
      },
      colorMode: {
        defaultMode: 'light',
        respectPrefersColorScheme: true,
      },
      prism: {
        theme: { plain: {}, styles: [] },
        additionalLanguages: ['bash', 'json', 'diff'],
      },
    }),
};

export default config;
