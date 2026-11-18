import Anthropic from '@anthropic-ai/sdk';
import { tasksConfig } from '../config.ts';
import { PLAN_INSTRUCTIONS, PLAN_SCHEMA, type PlanInput, type PlanOutput, type Planner } from './planner.ts';

// The AI planner for the task triage (CONCEPT.md §2.8, §6): one structured-output call per batch.
// Model, effort and limits — registry/tasks.json; the key — ANTHROPIC_API_KEY in /srv/stream/.env.

// baseURL — only for tests against a fake API.
export function anthropicPlanner(apiKey: string, baseURL?: string): Planner {
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const { model, effort, max_tokens } = tasksConfig.ai;
  // Stable part first, so it can be cached: instructions and the task templates.
  const system = `${PLAN_INSTRUCTIONS}\n\nШаблоны задач (name, метка, исполнитель, filed, что сделать):\n${tasksConfig.templates
    .map((template) => `- ${template.name} ${template.tag ?? '(без метки)'} → ${template.assignee}${template.filed ? ', filed: true' : ''}: ${template.title}. ${template.instruction}`).join('\n')}`;

  return async (input: PlanInput): Promise<PlanOutput> => {
    const { templates, ...batch } = input;
    const response = await client.messages.create({
      model,
      max_tokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: effort as 'low' | 'medium' | 'high', format: { type: 'json_schema', schema: PLAN_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content: `Открытые задачи и новые сообщения (JSON):\n${JSON.stringify(batch)}` }],
    });
    if (response.stop_reason === 'refusal') throw new Error('модель отказалась разбирать пачку');
    if (response.stop_reason === 'max_tokens') throw new Error('ответ модели не уместился в max_tokens');
    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') throw new Error('модель не вернула разбор');
    const parsed = JSON.parse(text.text) as Pick<PlanOutput, 'tasks'>;
    return { tasks: parsed.tasks, usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } };
  };
}
