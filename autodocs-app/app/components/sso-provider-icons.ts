import {
  IconBrandAuth0, IconBrandAws, IconBrandAzure, IconBrandDiscord, IconBrandGithub, IconBrandGitlab,
  IconBrandGoogle, IconBrandLinkedin, IconKey, IconLock, IconShieldLock, type Icon,
} from '@tabler/icons-react';

const PROVIDER_ICONS: Record<string, Icon> = {
  google: IconBrandGoogle,
  microsoft: IconBrandAzure,
  github: IconBrandGithub,
  gitlab: IconBrandGitlab,
  okta: IconShieldLock,
  auth0: IconBrandAuth0,
  keycloak: IconKey,
  cognito: IconBrandAws,
  linkedin: IconBrandLinkedin,
  discord: IconBrandDiscord,
  'custom-oidc': IconLock,
};

/** The icon of an identity provider; a lock for one without a brand icon. */
export function providerIcon(providerId: string): Icon {
  return PROVIDER_ICONS[providerId] ?? IconLock;
}
