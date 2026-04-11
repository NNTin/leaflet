import { ComponentType, createElement } from 'react'

type ProviderIconProps = {
  size?: number;
  'aria-hidden'?: boolean | 'true' | 'false';
}

function makeEmojiIcon(emoji: string): ComponentType<ProviderIconProps> {
  return function ProviderEmojiIcon({ size = 18, 'aria-hidden': ariaHidden = true }) {
    return createElement(
      'span',
      {
        'aria-hidden': ariaHidden,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: `${size}px`,
          lineHeight: 1,
        },
      },
      emoji,
    )
  }
}

const GitHubIcon = makeEmojiIcon('🐙')
const GoogleIcon = makeEmojiIcon('🔵')
const DiscordIcon = makeEmojiIcon('💬')
const MicrosoftIcon = makeEmojiIcon('🪟')
const AppleIcon = makeEmojiIcon('🍎')

/** Shared metadata for all known OAuth providers. */
export interface ProviderMeta {
  name: string;
  label: string;
  icon: ComponentType<ProviderIconProps>;
}

export const PROVIDER_META: ProviderMeta[] = [
  { name: 'github',    label: 'GitHub',    icon: GitHubIcon },
  { name: 'google',    label: 'Google',    icon: GoogleIcon },
  { name: 'discord',   label: 'Discord',   icon: DiscordIcon },
  { name: 'microsoft', label: 'Microsoft', icon: MicrosoftIcon },
  { name: 'apple',     label: 'Apple',     icon: AppleIcon },
]

/** Map of provider name → metadata for O(1) lookup. */
export const PROVIDER_META_MAP: Record<string, ProviderMeta> = PROVIDER_META.reduce(
  (map, provider) => {
    map[provider.name] = provider
    return map
  },
  {} as Record<string, ProviderMeta>
)
