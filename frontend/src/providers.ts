import { ComponentType } from 'react'
import { SiGithub, SiGoogle, SiDiscord, SiApple } from 'react-icons/si'
import { BsMicrosoft } from 'react-icons/bs'

/** Shared metadata for all known OAuth providers. */
export interface ProviderMeta {
  name: string;
  label: string;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
}

export const PROVIDER_META: ProviderMeta[] = [
  { name: 'github',    label: 'GitHub',    icon: SiGithub },
  { name: 'google',    label: 'Google',    icon: SiGoogle },
  { name: 'discord',   label: 'Discord',   icon: SiDiscord },
  { name: 'microsoft', label: 'Microsoft', icon: BsMicrosoft },
  { name: 'apple',     label: 'Apple',     icon: SiApple },
]

/** Map of provider name → metadata for O(1) lookup. */
export const PROVIDER_META_MAP: Record<string, ProviderMeta> = PROVIDER_META.reduce(
  (map, provider) => {
    map[provider.name] = provider
    return map
  },
  {} as Record<string, ProviderMeta>
)
