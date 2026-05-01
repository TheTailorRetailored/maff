import { PageLayout, SharedLayout } from "@jackyzha0/quartz/cfg"
import * as Component from "@jackyzha0/quartz/components"

export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({ links: {} })
}

export const defaultContentPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle(), Component.ContentMeta()],
  left: [Component.PageTitle(), Component.Search(), Component.Darkmode(), Component.Explorer()],
  right: [Component.Graph(), Component.TableOfContents()],
  afterBody: []
}

export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle(), Component.ContentMeta()],
  left: [Component.PageTitle(), Component.Search(), Component.Darkmode(), Component.Explorer()],
  right: [],
  afterBody: []
}
