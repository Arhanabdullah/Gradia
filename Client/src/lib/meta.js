// SEO / Metadata utilities for dynamic page titles and descriptions

const siteConfig = {
  name: "Gradia",
  tagline: "Student Result Management System",
  url: "https://gradia.app", // Update when deployed
  ogImage: "/og-image.png",
  twitterHandle: "@gradia_app",
}

const routeMeta = {
  "/": {
    title: "Gradia · Student Result Management System",
    description: "Enter marks, compile result sheets, route approvals, and publish results in one clean workflow.",
  },
  "/login": {
    title: "Sign in · Gradia",
    description: "Sign in to access your Gradia dashboard.",
    noIndex: true,
  },
  "/app": {
    title: "Overview · Gradia",
    description: "Your academic dashboard — results, exams, and notifications at a glance.",
    noIndex: true,
  },
  "/app/users": {
    title: "User Management · Gradia",
    description: "Manage user accounts, roles, and access across the institution.",
    noIndex: true,
  },
  "/app/classes": {
    title: "Classes · Gradia",
    description: "Manage classes, sections, and academic structure.",
    noIndex: true,
  },
  "/app/exams": {
    title: "Exams · Gradia",
    description: "Create and manage exam schedules, components, and timetables.",
    noIndex: true,
  },
  "/app/sheets": {
    title: "Result Sheets · Gradia",
    description: "Compile, review, and manage result sheets through the approval workflow.",
    noIndex: true,
  },
  "/app/marks": {
    title: "Marks Entry · Gradia",
    description: "Enter and edit student marks for exams and components.",
    noIndex: true,
  },
  "/app/review": {
    title: "Review Sheets · Gradia",
    description: "Review and approve or reject compiled result sheets.",
    noIndex: true,
  },
  "/app/publish": {
    title: "Publish Results · Gradia",
    description: "Sign off and publish approved result sheets to students.",
    noIndex: true,
  },
  "/app/results": {
    title: "My Results · Gradia",
    description: "View and download your published result sheets.",
    noIndex: true,
  },
  "/app/notifications": {
    title: "Notifications · Gradia",
    description: "Stay updated with result publications and announcements.",
    noIndex: true,
  },
}

export function getPageMeta(pathname) {
  // Exact match first
  if (routeMeta[pathname]) return routeMeta[pathname]

  // Pattern matching for dynamic routes
  const patterns = [
    { pattern: /^\/app\/exams\/[^/]+$/, meta: { title: "Exam Details · Gradia", description: "View and manage exam details.", noIndex: true } },
    { pattern: /^\/app\/sheets\/[^/]+$/, meta: { title: "Result Sheet · Gradia", description: "View result sheet details and status.", noIndex: true } },
    { pattern: /^\/app\/marks\/[^/]+$/, meta: { title: "Marks Entry · Gradia", description: "Enter marks for this exam.", noIndex: true } },
    { pattern: /^\/app\/review\/[^/]+$/, meta: { title: "Review Sheet · Gradia", description: "Review this result sheet.", noIndex: true } },
    { pattern: /^\/app\/publish\/[^/]+$/, meta: { title: "Publish Sheet · Gradia", description: "Publish this result sheet.", noIndex: true } },
  ]

  for (const { pattern, meta } of patterns) {
    if (pattern.test(pathname)) return meta
  }

  // Default fallback
  return {
    title: "Gradia · Student Result Management System",
    description: "Enter marks, compile result sheets, route approvals, and publish results in one clean workflow.",
  }
}

export function updateDocumentMeta(pathname) {
  const meta = getPageMeta(pathname)

  // Update title
  document.title = meta.title

  // Update or create meta tags
  const updateMeta = (name, content, property = false) => {
    const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`
    let tag = document.querySelector(selector)
    if (!tag) {
      tag = document.createElement('meta')
      if (property) tag.setAttribute('property', name)
      else tag.setAttribute('name', name)
      document.head.appendChild(tag)
    }
    tag.setAttribute('content', content)
  }

  // Standard meta
  updateMeta('description', meta.description)

  // Open Graph
  updateMeta('og:title', meta.title, true)
  updateMeta('og:description', meta.description, true)
  updateMeta('og:type', 'website', true)
  updateMeta('og:site_name', siteConfig.name, true)
  updateMeta('og:url', `${siteConfig.url}${pathname}`, true)
  updateMeta('og:image', siteConfig.ogImage, true)

  // Twitter
  updateMeta('twitter:card', 'summary_large_image')
  updateMeta('twitter:title', meta.title)
  updateMeta('twitter:description', meta.description)
  updateMeta('twitter:image', siteConfig.ogImage)
  updateMeta('twitter:site', siteConfig.twitterHandle)

  // Robots
  updateMeta('robots', meta.noIndex ? 'noindex, nofollow' : 'index, follow')
}

export function usePageMeta(pathname) {
  // This hook can be used in components to trigger meta updates
  // Actual update happens via effect in Layout or individual pages
  return getPageMeta(pathname)
}