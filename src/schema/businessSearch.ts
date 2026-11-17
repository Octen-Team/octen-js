import type { Infer, InferResponse, ObjectDesc, UnionDesc } from './descriptor';
import {
  contentOptions,
  domainFilterFields,
  languageArray,
  requestId,
  stringArray,
  timeFilterFields,
  webResultFields,
  webResults,
} from './common';

export const BusinessSearchRequestDesc = {
  t: 'object',
  fields: {
    query: { t: 'string', required: true },
    count: { t: 'integer' },
    ...domainFilterFields,
    ...timeFilterFields,
    language: languageArray,
    highlight: contentOptions,
    full_content: contentOptions,
    entities: {
      t: 'object',
      fields: {
        enable: { t: 'boolean' },
        count: { t: 'integer' },
        max_activities: { t: 'integer' },
        max_news: { t: 'integer' },
      },
    },
  },
} as const satisfies ObjectDesc;

// BusinessNewsItem：与网页结果同构但没有 authors
const { authors: _authors, ...newsItemFields } = webResultFields;
const newsItems = {
  t: 'array',
  items: { t: 'object', fields: newsItemFields },
} as const;

const logoOrPhoto = { t: 'object', fields: { url: { t: 'string' } } } as const satisfies ObjectDesc;

const companyEntity = {
  t: 'object',
  fields: {
    type: { t: 'string', enum: ['company'], required: true },
    name: { t: 'string' },
    summary: { t: 'string' },
    aliases: stringArray,
    identifiers: {
      t: 'object',
      fields: {
        website: { t: 'string' },
        linkedin_url: { t: 'string' },
        stock_ticker: { t: 'string' },
        sec_cik: { t: 'string' },
      },
    },
    attributes: {
      t: 'object',
      fields: {
        industry: { t: 'string' },
        hq_location: { t: 'string' },
        founded_year: { t: 'integer' },
        employee_range: { t: 'string' },
      },
    },
    metrics: {
      t: 'object',
      fields: {
        financials: {
          t: 'array',
          items: {
            t: 'object',
            fields: {
              revenue: { t: 'number' },
              net_income: { t: 'number' },
              gross_profit: { t: 'number' },
              period: { t: 'string' },
              currency: { t: 'string' },
            },
          },
        },
        stock: {
          t: 'object',
          fields: {
            price: { t: 'number' },
            todays_change_percent: { t: 'number' },
            week_52_high: { t: 'number' },
            week_52_low: { t: 'number' },
            date: { t: 'string' },
            currency: { t: 'string' },
          },
        },
        funding: {
          t: 'array',
          items: {
            t: 'object',
            fields: {
              round: { t: 'string' },
              amount: { t: 'number' },
              date: { t: 'string' },
              lead_investors: { t: 'string' },
              currency: { t: 'string' },
            },
          },
        },
        web_traffic: {
          t: 'object',
          fields: { visits_monthly: { t: 'integer' }, rank: { t: 'integer' }, period: { t: 'string' } },
        },
      },
    },
    key_people: {
      t: 'array',
      items: { t: 'object', fields: { name: { t: 'string' }, title: { t: 'string' } } },
    },
    logo: logoOrPhoto,
    activities: webResults,
    news: newsItems,
  },
} as const satisfies ObjectDesc;

const personEntity = {
  t: 'object',
  fields: {
    type: { t: 'string', enum: ['person'], required: true },
    name: { t: 'string' },
    summary: { t: 'string' },
    linkedin_url: { t: 'string' },
    current_position: { t: 'string' },
    career: {
      t: 'array',
      items: {
        t: 'object',
        fields: {
          organization: { t: 'string' },
          title: { t: 'string' },
          start: { t: 'string' },
          end: { t: 'string' },
        },
      },
    },
    photo: logoOrPhoto,
    activities: webResults,
    news: newsItems,
  },
} as const satisfies ObjectDesc;

// 运行时遇到未知 type 原样返回；类型只含已知变体（见 descriptor.ts 的 InferUnion）
const businessEntity = {
  t: 'union',
  tag: 'type',
  variants: { company: companyEntity, person: personEntity },
} as const satisfies UnionDesc;

export const BusinessSearchResponseDesc = {
  t: 'object',
  fields: {
    code: { t: 'integer' },
    msg: { t: 'string' },
    request_id: requestId,
    data: {
      t: 'object',
      fields: {
        query: { t: 'string' },
        results: webResults,
        entities: { t: 'array', items: businessEntity },
      },
    },
    meta: {
      t: 'object',
      fields: {
        usage: {
          t: 'object',
          fields: { num_search_queries: { t: 'integer' }, full_content_extra_count: { t: 'integer' } },
        },
        latency: { t: 'number' },
        // 与其他接口不同：BusinessSearchMeta.warning 在规范里不可为 null
        warning: { t: 'string' },
      },
    },
  },
} as const satisfies ObjectDesc;

export type BusinessSearchParams = Infer<typeof BusinessSearchRequestDesc>;
export type BusinessSearchResponse = InferResponse<typeof BusinessSearchResponseDesc>;
