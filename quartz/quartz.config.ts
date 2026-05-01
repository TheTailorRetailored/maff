import { QuartzConfig } from "@jackyzha0/quartz/cfg"
import * as Plugin from "@jackyzha0/quartz/plugins"

const config: QuartzConfig = {
  configuration: {
    pageTitle: "Maff",
    enableSPA: true,
    enablePopovers: true,
    analytics: null,
    locale: "en-US",
    baseUrl: "localhost",
    ignorePatterns: ["private", "templates", ".obsidian"],
    defaultDateType: "modified",
    theme: {
      typography: { header: "Schibsted Grotesk", body: "Source Sans Pro", code: "IBM Plex Mono" },
      colors: {
        lightMode: { light: "#fafafa", lightgray: "#e5e7eb", gray: "#6b7280", darkgray: "#374151", dark: "#111827", secondary: "#0f766e", tertiary: "#b45309", highlight: "rgba(15, 118, 110, 0.15)" },
        darkMode: { light: "#111827", lightgray: "#1f2937", gray: "#9ca3af", darkgray: "#d1d5db", dark: "#f9fafb", secondary: "#2dd4bf", tertiary: "#fbbf24", highlight: "rgba(45, 212, 191, 0.15)" }
      }
    }
  },
  plugins: {
    transformers: [Plugin.FrontMatter(), Plugin.CreatedModifiedDate({ priority: ["frontmatter", "filesystem"] }), Plugin.SyntaxHighlighting(), Plugin.ObsidianFlavoredMarkdown(), Plugin.GitHubFlavoredMarkdown(), Plugin.TableOfContents(), Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }), Plugin.Latex({ renderEngine: "katex" }), Plugin.Description()],
    filters: [Plugin.RemoveDrafts()],
    emitters: [Plugin.AliasRedirects(), Plugin.ComponentResources(), Plugin.ContentPage(), Plugin.FolderPage(), Plugin.TagPage(), Plugin.ContentIndex({ enableSiteMap: true, enableRSS: false }), Plugin.Assets(), Plugin.Static()]
  }
}

export default config

