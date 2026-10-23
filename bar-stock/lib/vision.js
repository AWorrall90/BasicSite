// Reads photos with Claude: invoices/delivery notes, ePOS sales reports, and bottle fill levels.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

const InvoiceSchema = z.object({
  supplier: z.string().nullable(),
  reference: z.string().nullable().describe('Invoice or delivery note number'),
  date: z.string().nullable().describe('ISO date YYYY-MM-DD if visible'),
  lines: z.array(z.object({
    description: z.string(),
    quantity: z.number().describe('Number of packs/cases/items delivered on this line'),
    packSize: z.number().describe('Individual units per pack, e.g. 24 for a case of 24 bottles, 1 for a single bottle or keg'),
    unitSizeMl: z.number().nullable().describe('Volume of one individual unit in ml, e.g. 700, 330, 50000'),
    lineTotal: z.number().nullable().describe('Line total excluding VAT'),
    productId: z.string().nullable().describe('id of the matching product from the catalogue, or null'),
  })),
});

const SalesSchema = z.object({
  from: z.string().nullable().describe('ISO date the report starts'),
  to: z.string().nullable().describe('ISO date the report ends'),
  lines: z.array(z.object({
    itemName: z.string(),
    quantitySold: z.number(),
  })),
});

const BottleSchema = z.object({
  fraction: z.number().describe('Remaining liquid as a fraction of a full bottle, 0 to 1'),
  confidence: z.enum(['low', 'medium', 'high']),
  bottle: z.string().describe('What the bottle appears to be'),
  notes: z.string().describe('Anything that limits accuracy, e.g. opaque glass or angle'),
});

const TASKS = {
  invoice: {
    schema: InvoiceSchema,
    prompt: (ctx) => `This is a photo of a supplier invoice or delivery note for a bar. Extract every stock line.
Only include drinks/stock lines, not delivery charges, deposits or VAT lines.
If a line says something like "6 x 70cl" or "case 24", put the case count in quantity and the bottles per case in packSize.
Match each line to the bar's product catalogue where you are reasonably sure it is the same product and size; otherwise use null.
Catalogue (JSON): ${JSON.stringify(ctx.products || [])}`,
  },
  sales: {
    schema: SalesSchema,
    prompt: () => `This is a photo of a sales report from a bar's ePOS/till system. Extract each item sold and the quantity sold.
Skip totals, subtotals, category headings, refunds summaries and payment-method lines. Use the item names exactly as printed.`,
  },
  bottle: {
    schema: BottleSchema,
    prompt: (ctx) => `This photo shows an opened bottle behind a bar. Estimate how much liquid is left as a fraction of a full bottle (0 = empty, 1 = full).
Account for the bottle's shape: the neck and shoulder hold little volume, so judge by volume rather than height.
${ctx.product ? `The bar says this is: ${ctx.product}.` : ''}`,
  },
};

let client;

export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function readPhoto(task, images, context = {}) {
  const spec = TASKS[task];
  if (!spec) throw Object.assign(new Error(`Unknown task ${task}`), { status: 400 });
  client ??= new Anthropic();

  const content = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType, data: img.data },
  }));
  content.push({ type: 'text', text: spec.prompt(context) });

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: task === 'bottle' ? 'medium' : 'high', format: zodOutputFormat(spec.schema) },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('The photo could not be read. Please enter the details manually.'), { status: 422 });
  }
  if (!response.parsed_output) {
    throw Object.assign(new Error('Could not understand the photo. Try a clearer, flatter shot.'), { status: 422 });
  }
  return response.parsed_output;
}
