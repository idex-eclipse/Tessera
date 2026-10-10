import { en as calEn } from './locales/en';
import { ru as calRu } from './locales/ru';
import { en as meshEn } from './locales/bed-mesh/en';
import { ru as meshRu } from './locales/bed-mesh/ru'

export const locales = {
  en: { ...calEn, ...meshEn },
  ru: { ...calRu, ...meshRu },
};