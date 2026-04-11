/** Shared metadata for all known OAuth providers. */
export interface ProviderMeta {
  name: string;
  label: string;
  icon: string;
}

export const PROVIDER_META: ProviderMeta[] = [
  { name: 'github',    label: 'GitHub',    icon: '🐙' },
  { name: 'google',    label: 'Google',    icon: '🔵' },
  { name: 'discord',   label: 'Discord',   icon: '💜' },
  { name: 'microsoft', label: 'Microsoft', icon: '🟦' },
  { name: 'apple',     label: 'Apple',     icon: '🍎' },
]

/** Map of provider name → metadata for O(1) lookup. */
export const PROVIDER_META_MAP: Record<string, ProviderMeta> = Object.fromEntries(
  PROVIDER_META.map((p) => [p.name, p])
)
