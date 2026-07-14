'use server'
import { getCategories } from '@/lib/api'
import { supportedCurrencyCodes } from '@/lib/currency'
import { env } from '@/lib/env'
import { formatCategoryForAIPrompt } from '@/lib/utils'
import OpenAI from 'openai'
import { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/index.mjs'

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY })

export async function extractExpenseInformationFromImage(imageUrl: string) {
  'use server'
  const categories = await getCategories()

  const body: ChatCompletionCreateParamsNonStreaming = {
    model: 'gpt-5-nano',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `
              This image contains a receipt. Extract its details accurately.
              - amount: the final total charged, as a non-formatted number with no currency symbol or text. Do not use a subtotal, tax, change, or a line-item amount.
              - currencyCode: the receipt's explicitly printed currency as an uppercase three-letter ISO 4217 code. Never infer it from the user's locale or a group default. If the receipt does not explicitly identify a supported currency, return null. Supported codes: ${supportedCurrencyCodes.join(
                ', ',
              )}.
              - categoryId: the most suitable category ID from: ${categories.map(
                (category) => formatCategoryForAIPrompt(category),
              )}.
              - date: the expense date as yyyy-mm-dd.
              - title: a short merchant or expense title.
              Return only a JSON object with exactly these keys: amount, currencyCode, categoryId, date, title.`,
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: imageUrl } }],
      },
    ],
  }
  const completion = await openai.chat.completions.create(body)

  const content = completion.choices.at(0)?.message.content
  const extracted = content
    ? (JSON.parse(content) as Record<string, unknown>)
    : {}
  const currencyCode =
    typeof extracted.currencyCode === 'string' &&
    supportedCurrencyCodes.includes(
      extracted.currencyCode.toUpperCase() as (typeof supportedCurrencyCodes)[number],
    )
      ? extracted.currencyCode.toUpperCase()
      : undefined

  return {
    amount: Number(extracted.amount),
    currencyCode,
    categoryId:
      typeof extracted.categoryId === 'string' ||
      typeof extracted.categoryId === 'number'
        ? String(extracted.categoryId)
        : undefined,
    date: typeof extracted.date === 'string' ? extracted.date : undefined,
    title: typeof extracted.title === 'string' ? extracted.title : undefined,
  }
}

export type ReceiptExtractedInfo = Awaited<
  ReturnType<typeof extractExpenseInformationFromImage>
>
