import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Translations {
  cli: {
    error_general: string;
  };
  lang: {
    current: string;
    changed: string;
  };
  auth: {
    set_success: string;
    revoke_success: string;
    reload_success: string;
    not_set: string;
  };
  tools: {
    list_header: string;
    install_success: string;
    uninstall_success: string;
  };
  mcp: {
    list_header: string;
    installed_header: string;
    install_success: string;
    uninstall_success: string;
  };
  doctor: {
    header: string;
    config_path: string;
    current_auth: string;
    plan: string;
    api_key: string;
    not_set: string;
    tools_header: string;
    mcp_header: string;
    none: string;
  };
  wizard: {
    welcome: string;
    select_language: string;
    select_plan: string;
    enter_api_key: string;
    select_tools: string;
    installing_tools: string;
    tool_installed: string;
    loading_plan: string;
    manage_mcp: string;
    complete: string;
  };
}

let translations: Record<'zh_CN' | 'en_US', Translations> | null = null;
let currentLang: 'zh_CN' | 'en_US' = 'en_US';

function loadTranslations(): Record<'zh_CN' | 'en_US', Translations> {
  if (translations) return translations;

  // At runtime, this file lives in dist/utils, and locales are copied to dist/locales
  const localesDir = join(__dirname, '..', 'locales');
  const zh_CN = JSON.parse(readFileSync(join(localesDir, 'zh_CN.json'), 'utf-8')) as Translations;
  const en_US = JSON.parse(readFileSync(join(localesDir, 'en_US.json'), 'utf-8')) as Translations;

  translations = { zh_CN, en_US };
  return translations;
}

export function setLang(lang: 'zh_CN' | 'en_US') {
  currentLang = lang;
}

export function t(key: string, params?: Record<string, string>): string {
  const allTranslations = loadTranslations();
  const trans = allTranslations[currentLang];

  const keys = key.split('.');
  let value: any = trans;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      return key; // fallback to key if not found
    }
  }

  if (typeof value !== 'string') return key;

  if (params) {
    return value.replace(/\{(\w+)\}/g, (match, p1) => params[p1] || match);
  }

  return value;
}

export const i18n = { t, setLang };
