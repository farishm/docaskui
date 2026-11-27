const productionApiOrigin =
  'https://docaskapi20261125234329-cwanhnbufjc7e3gg.westus3-01.azurewebsites.net'

export function apiUrl(path: string): string {
  const apiOrigin =
    import.meta.env.VITE_API_BASE_URL ||
    (import.meta.env.PROD ? productionApiOrigin : '')

  return `${apiOrigin.replace(/\/+$/, '')}${path}`
}
