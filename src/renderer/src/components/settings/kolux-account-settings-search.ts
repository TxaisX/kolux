import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export const getKoluxAccountSettingsSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.koluxAccount.account', 'Kolux account'),
    description: translate(
      'auto.components.settings.koluxAccount.searchDescription',
      'Sign in or out of the account used by Artifacts and Kolux Relay.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.koluxAccount.keywordAccount', 'account'),
      ...translateSearchKeyword('auto.components.settings.koluxAccount.keywordLogin', 'login'),
      ...translateSearchKeyword('auto.components.settings.koluxAccount.keywordLogout', 'logout'),
      ...translateSearchKeyword('auto.components.settings.koluxAccount.keywordSignIn', 'sign in'),
      ...translateSearchKeyword('auto.components.settings.koluxAccount.keywordSignOut', 'sign out'),
      ...translateSearchKeyword('auto.components.settings.koluxAccount.keywordRelay', 'relay'),
      ...translateSearchKeyword('auto.components.settings.koluxAccount.keywordCloud', 'cloud')
    ]
  }
])
