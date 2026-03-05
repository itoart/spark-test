import { defineConfig } from 'vite'

function resolveBase() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    return '/'
  }

  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? ''
  if (!repo || repo.endsWith('.github.io')) {
    return '/'
  }

  return `/${repo}/`
}

export default defineConfig({
  base: resolveBase(),
})
